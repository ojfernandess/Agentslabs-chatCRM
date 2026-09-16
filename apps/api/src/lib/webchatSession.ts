import { randomBytes } from "node:crypto";
import type { Prisma, WebchatSession } from "@prisma/client";
import { prisma } from "../db.js";
import { getWebAppPublicOrigin } from "../config.js";
import { appendTimelineEvent } from "./timeline.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";

/**
 * Web Chat externo — continuidade da MESMA conversa (nunca cria uma segunda Conversation).
 *
 * Token seguro: aleatório, não enumerável, vinculado à conversa + organização, expirável e revogável.
 * A URL nunca expõe organization_id / conversation_id / contact_id.
 */

export const WEBCHAT_DEFAULT_EXPIRATION_HOURS = 24;

export function newWebchatToken(): string {
  return randomBytes(32).toString("base64url");
}

export function webchatPublicUrl(token: string): string {
  return `${getWebAppPublicOrigin()}/s/${encodeURIComponent(token)}`;
}

export function isWebchatSessionExpired(session: Pick<WebchatSession, "expiresAt">): boolean {
  return session.expiresAt.getTime() <= Date.now();
}

const DEFAULT_CONTINUITY_MESSAGE =
  "Para continuar seu atendimento pelo navegador, acesse o link abaixo:\n\n{{webchat_url}}";

/** Substitui {{webchat_url}} exclusivamente pelo link seguro gerado pelo sistema. */
export function buildWebchatContinuityBody(templateText: string | null | undefined, url: string): string {
  const base = (templateText ?? "").trim() || DEFAULT_CONTINUITY_MESSAGE;
  if (base.includes("{{webchat_url}}")) {
    return base.split("{{webchat_url}}").join(url);
  }
  return `${base}\n\n${url}`;
}

export type GenerateWebchatLinkResult =
  | {
      ok: true;
      session: WebchatSession;
      url: string;
      reused: boolean;
    }
  | { ok: false; code: "FEATURE_DISABLED" | "CONVERSATION_NOT_FOUND"; message: string };

async function orgWebchatSettings(organizationId: string): Promise<{
  expirationHours: number;
  regeneratePolicy: "revoke" | "keep";
  continuityMessage: string | null;
}> {
  const s = await prisma.settings.findUnique({
    where: { organizationId },
    select: {
      webchatLinkExpirationHours: true,
      webchatContinuityMessage: true,
      webchatRegeneratePolicy: true,
    },
  });
  const hours = s?.webchatLinkExpirationHours ?? WEBCHAT_DEFAULT_EXPIRATION_HOURS;
  return {
    expirationHours: Math.max(1, Math.min(720, hours)),
    regeneratePolicy: s?.webchatRegeneratePolicy === "keep" ? "keep" : "revoke",
    continuityMessage: s?.webchatContinuityMessage ?? null,
  };
}

export async function getActiveWebchatSessionForConversation(
  organizationId: string,
  conversationId: string,
): Promise<WebchatSession | null> {
  const session = await prisma.webchatSession.findFirst({
    where: { organizationId, conversationId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return null;
  if (isWebchatSessionExpired(session)) {
    await prisma.webchatSession
      .update({ where: { id: session.id }, data: { status: "EXPIRED", updatedAt: new Date() } })
      .catch(() => {});
    return null;
  }
  return session;
}

/**
 * Gera (ou reutiliza) o link seguro do Web Chat para a conversa.
 * Reutiliza sessão ACTIVE válida por padrão — evita múltiplos tokens desnecessários a cada clique.
 */
export async function generateWebchatLinkForConversation(params: {
  organizationId: string;
  conversationId: string;
  createdBySource: "AGENT" | "HUMAN" | "SYSTEM";
  createdByUserId?: string | null;
  /** true força novo token; a política da organização decide se o anterior é revogado ou mantido. */
  regenerate?: boolean;
}): Promise<GenerateWebchatLinkResult> {
  const { organizationId, conversationId } = params;

  if (!(await isOrganizationFeatureEnabled(organizationId, "webchat"))) {
    return { ok: false, code: "FEATURE_DISABLED", message: "Web Chat is not enabled for this organization" };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { id: true, contactId: true, inbox: { select: { channelType: true } } },
  });
  if (!conversation) {
    return { ok: false, code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" };
  }

  const settings = await orgWebchatSettings(organizationId);

  const existing = await getActiveWebchatSessionForConversation(organizationId, conversationId);
  if (existing && !params.regenerate) {
    return { ok: true, session: existing, url: webchatPublicUrl(existing.token), reused: true };
  }
  if (existing && params.regenerate && settings.regeneratePolicy === "revoke") {
    await prisma.webchatSession
      .update({
        where: { id: existing.id },
        data: { status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() },
      })
      .catch(() => {});
  }

  const expiresAt = new Date(Date.now() + settings.expirationHours * 60 * 60 * 1000);
  const session = await prisma.webchatSession.create({
    data: {
      organizationId,
      conversationId,
      contactId: conversation.contactId,
      token: newWebchatToken(),
      status: "ACTIVE",
      expiresAt,
      createdBySource: params.createdBySource,
      createdByUserId: params.createdByUserId ?? null,
    },
  });

  /** Evento interno discreto — sem o token completo (risco de reutilização do link). */
  await appendTimelineEvent({
    organizationId,
    subjectType: "CONTACT",
    subjectId: conversation.contactId,
    eventType: "webchat.link_generated",
    channel: "webchat",
    payload: {
      conversationId,
      generatedBy: params.createdBySource,
      generatedByUserId: params.createdByUserId ?? null,
      expiresAt: expiresAt.toISOString(),
      channel: conversation.inbox.channelType,
      organizationId,
    } as Prisma.InputJsonValue,
    actorUserId: params.createdByUserId ?? undefined,
    sourceId: session.id,
  }).catch(() => {});

  return { ok: true, session, url: webchatPublicUrl(session.token), reused: false };
}

export async function revokeWebchatSessionForConversation(
  organizationId: string,
  conversationId: string,
): Promise<number> {
  const r = await prisma.webchatSession.updateMany({
    where: { organizationId, conversationId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() },
  });
  return r.count;
}

export type ResolveWebchatSessionResult =
  | { ok: false; code: "NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_REVOKED" }
  | {
      ok: true;
      session: WebchatSession;
      conversation: { id: string; organizationId: string; contactId: string; inboxId: string };
      organizationName: string;
      agentBotName: string | null;
    };

/**
 * Resolve o token público. Um token nunca pode aceder a outra conversa/organização:
 * a conversa devolvida é exclusivamente a vinculada à sessão.
 */
export async function resolveWebchatSessionByToken(token: string): Promise<ResolveWebchatSessionResult> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 16 || trimmed.length > 96) return { ok: false, code: "NOT_FOUND" };

  const session = await prisma.webchatSession.findUnique({ where: { token: trimmed } });
  if (!session) return { ok: false, code: "NOT_FOUND" };
  if (session.status === "REVOKED") return { ok: false, code: "SESSION_REVOKED" };
  if (session.status === "EXPIRED" || isWebchatSessionExpired(session)) {
    if (session.status !== "EXPIRED") {
      await prisma.webchatSession
        .update({ where: { id: session.id }, data: { status: "EXPIRED", updatedAt: new Date() } })
        .catch(() => {});
    }
    return { ok: false, code: "SESSION_EXPIRED" };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: session.conversationId, organizationId: session.organizationId, deletedAt: null },
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      inboxId: true,
      organization: { select: { name: true, isActive: true } },
    },
  });
  if (!conversation || !conversation.organization.isActive) return { ok: false, code: "NOT_FOUND" };

  const settings = await prisma.settings.findUnique({
    where: { organizationId: session.organizationId },
    select: { agentBot: { select: { name: true } } },
  });

  await prisma.webchatSession
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    session,
    conversation: {
      id: conversation.id,
      organizationId: conversation.organizationId,
      contactId: conversation.contactId,
      inboxId: conversation.inboxId,
    },
    organizationName: conversation.organization.name,
    agentBotName: settings?.agentBot?.name ?? null,
  };
}
