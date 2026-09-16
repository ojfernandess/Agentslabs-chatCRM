import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  buildWebchatContinuityBody,
  generateWebchatLinkForConversation,
  getActiveWebchatSessionForConversation,
  revokeWebchatSessionForConversation,
  webchatPublicUrl,
} from "../lib/webchatSession.js";
import { deliverOutboundWhatsAppMessage } from "../lib/outboundMessage.js";
import { appendTimelineEvent } from "../lib/timeline.js";

/**
 * «Continuar no Web Chat» — geração/envio manual do link pelo atendente, dentro da conversa do Inbox.
 * Usa a MESMA infraestrutura `generateWebchatLinkForConversation` da geração automática pelo agente.
 *
 * - o envio manual passa pelo Message Policy Engine (deliverOutboundWhatsAppMessage aplica a janela da Meta);
 * - mensagens humanas NÃO incrementam o Interaction Budget (contador só no pipeline do agente);
 * - o endpoint valida utilizador autenticado + organização + acesso à conversa.
 */

const generateBodySchema = z.object({
  regenerate: z.boolean().optional(),
});

const sendLinkBodySchema = z.object({
  regenerate: z.boolean().optional(),
});

export async function webchatLinkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  async function loadConversationForOrg(organizationId: string, conversationId: string) {
    return prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, deletedAt: null },
      select: {
        id: true,
        contactId: true,
        inboxId: true,
        inbox: { select: { channelType: true } },
      },
    });
  }

  /** Sessão ativa (se existir) — nunca expõe IDs internos na URL. */
  app.get<{ Params: { id: string } }>("/conversations/:id/link", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const conv = await loadConversationForOrg(organizationId, request.params.id);
    if (!conv) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    const session = await getActiveWebchatSessionForConversation(organizationId, conv.id);
    if (!session) return { active: null };
    return {
      active: {
        url: webchatPublicUrl(session.token),
        expiresAt: session.expiresAt.toISOString(),
        createdBySource: session.createdBySource,
        createdAt: session.createdAt.toISOString(),
      },
    };
  });

  /** Gera (ou reutiliza) o link seguro. `regenerate: true` força novo token conforme a política da organização. */
  app.post<{ Params: { id: string } }>("/conversations/:id/link", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = generateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const conv = await loadConversationForOrg(organizationId, request.params.id);
    if (!conv) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    const r = await generateWebchatLinkForConversation({
      organizationId,
      conversationId: conv.id,
      createdBySource: "HUMAN",
      createdByUserId: request.user.id,
      regenerate: parsed.data.regenerate === true,
      resetClientBinding: parsed.data.regenerate === true,
    });
    if (!r.ok) {
      const status = r.code === "FEATURE_DISABLED" ? 403 : 404;
      return reply.status(status).send({ error: r.code, message: r.message, statusCode: status });
    }
    return {
      ok: true,
      url: r.url,
      expiresAt: r.session.expiresAt.toISOString(),
      reused: r.reused,
    };
  });

  /** Envia o link ao cliente pelo canal atual — sempre através do Message Policy Engine. */
  app.post<{ Params: { id: string } }>("/conversations/:id/link/send", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsedSend = sendLinkBodySchema.safeParse(request.body ?? {});
    const conv = await loadConversationForOrg(organizationId, request.params.id);
    if (!conv) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }

    const r = await generateWebchatLinkForConversation({
      organizationId,
      conversationId: conv.id,
      createdBySource: "HUMAN",
      createdByUserId: request.user.id,
      regenerate: true,
      resetClientBinding: true,
    });
    if (!r.ok) {
      const status = r.code === "FEATURE_DISABLED" ? 403 : 404;
      return reply.status(status).send({ error: r.code, message: r.message, statusCode: status });
    }

    const settings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { webchatContinuityMessage: true },
    });
    /** O backend substitui {{webchat_url}} exclusivamente pelo link seguro gerado. */
    const body = buildWebchatContinuityBody(settings?.webchatContinuityMessage, r.url);

    try {
      const sent = await deliverOutboundWhatsAppMessage({
        organizationId,
        data: {
          contactId: conv.contactId,
          conversationId: conv.id,
          type: "TEXT",
          body,
        },
        actor: { kind: "user", userId: request.user.id },
        log: request.log,
        newConversation: { status: "OPEN", assignedToId: request.user.id },
      });

      /** Evento interno discreto para o Inbox (sem token completo em logs). */
      await appendTimelineEvent({
        organizationId,
        subjectType: "CONTACT",
        subjectId: conv.contactId,
        eventType: "webchat.link_sent",
        channel: "webchat",
        payload: {
          conversationId: conv.id,
          sentByUserId: request.user.id,
          expiresAt: r.session.expiresAt.toISOString(),
          channel: conv.inbox.channelType,
        } as Prisma.InputJsonValue,
        actorUserId: request.user.id,
        sourceId: sent.message.id,
      }).catch(() => {});

      return {
        ok: true,
        messageId: sent.message.id,
        url: r.url,
        expiresAt: r.session.expiresAt.toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send webchat link";
      /** Janela da Meta fechada / template necessário — devolver 422 explícito (sem bypass da política). */
      return reply.status(422).send({ error: "Unprocessable Entity", message: msg, statusCode: 422 });
    }
  });

  /** Revoga os links ativos da conversa. */
  app.delete<{ Params: { id: string } }>("/conversations/:id/link", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const conv = await loadConversationForOrg(organizationId, request.params.id);
    if (!conv) {
      return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
    }
    const revoked = await revokeWebchatSessionForConversation(organizationId, conv.id);
    return { ok: true, revoked };
  });
}
