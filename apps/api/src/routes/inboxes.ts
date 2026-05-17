import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { InboxChannelType, Prisma } from "@prisma/client";
import { newIngestToken } from "../lib/channelInboxIngest.js";
import {
  assertUniqueWhatsappProviderInOrg,
  maskInboxRowChannelConfig,
  prepareWhatsappChannelConfigForSave,
  parseInboxWhatsappFromChannelConfig,
  whatsappWebhookMetaFromConfig,
} from "../lib/inboxWhatsappConfig.js";

const agentBotIdField = z.union([z.string().uuid(), z.null()]).optional();

const createInboxSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional().nullable(),
  isDefault: z.boolean().optional(),
  channelType: z.nativeEnum(InboxChannelType).optional(),
  /** Credenciais e opções por canal (Telegram token, Meta verify_token, Twilio, etc.). */
  channelConfig: z.any().nullable().optional(),
  /** Bot de triagem só para esta caixa; se omitido, usa só o default da organização (`Settings.agentBotId`). */
  agentBotId: z.string().uuid().optional(),
});

const patchInboxSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).nullable().optional(),
  isDefault: z.boolean().optional(),
  channelType: z.nativeEnum(InboxChannelType).optional(),
  /** JSON: ex. `{ "outboundWebhookUrl": "https://..." }` para canais não-WhatsApp. */
  channelConfig: z.any().nullable().optional(),
  /** `null` remove o vínculo e volta ao bot default da organização. */
  agentBotId: agentBotIdField,
});

const inboxAgentBotSelect = {
  id: true,
  name: true,
  type: true,
  isActive: true,
} as const;

function normalizeWhatsappInboxChannelConfig(
  existingConfig: unknown,
  incoming: unknown,
  ensureMetaVerifyToken: boolean,
): Record<string, unknown> | undefined {
  if (incoming == null || typeof incoming !== "object" || Array.isArray(incoming)) {
    return undefined;
  }
  return prepareWhatsappChannelConfigForSave({
    existingConfig,
    incoming: incoming as Record<string, unknown>,
    ensureMetaVerifyToken,
  });
}

function enrichWhatsappInboxResponse<T extends { id: string; channelType: string; channelConfig?: unknown }>(
  organizationId: string,
  inbox: T,
): T & { whatsappWebhookUrl?: string; whatsappWebhookVerifyToken?: string | null } {
  if (inbox.channelType !== InboxChannelType.WHATSAPP) return inbox;
  const meta = whatsappWebhookMetaFromConfig(inbox.channelConfig, organizationId, inbox.id);
  return {
    ...maskInboxRowChannelConfig(inbox),
    whatsappWebhookUrl: meta.webhookUrl,
    whatsappWebhookVerifyToken: meta.verifyToken,
  };
}

async function assertAgentBotBelongsToOrg(
  organizationId: string,
  botId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const bot = await prisma.bot.findFirst({
    where: { id: botId, organizationId },
    select: { id: true },
  });
  if (!bot) {
    await reply.status(400).send({ error: "Bad Request", message: "Invalid agentBotId", statusCode: 400 });
    return false;
  }
  return true;
}

const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (request.user.role === "AGENT") {
      const rows = await prisma.inbox.findMany({
        where: {
          organizationId,
          members: { some: { userId: request.user.id } },
        },
        select: {
          id: true,
          name: true,
          description: true,
          channelType: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
          agentBotId: true,
          agentBot: { select: inboxAgentBotSelect },
          _count: { select: { members: true, conversations: true } },
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
      return { data: rows };
    }

    const rows = await prisma.inbox.findMany({
      where: { organizationId },
        select: {
          id: true,
          name: true,
          description: true,
          channelType: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
          ingestToken: true,
          channelConfig: true,
          agentBotId: true,
          agentBot: { select: inboxAgentBotSelect },
          members: {
            include: { user: { select: { id: true, name: true, email: true, role: true } } },
          },
          _count: { select: { members: true, conversations: true } },
        },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return {
      data: rows.map((row) => enrichWhatsappInboxResponse(organizationId, row)),
    };
  });

  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createInboxSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const body = parsed.data;
    let inbox;

    if (body.agentBotId) {
      const ok = await assertAgentBotBelongsToOrg(organizationId, body.agentBotId, reply);
      if (!ok) return;
    }

    const channelType = body.channelType ?? InboxChannelType.WHATSAPP;
    let channelConfig: Prisma.InputJsonValue | undefined;
    if (channelType === InboxChannelType.WHATSAPP && body.channelConfig != null) {
      const prepared = normalizeWhatsappInboxChannelConfig(null, body.channelConfig, true);
      const provider = prepared
        ? parseInboxWhatsappFromChannelConfig(prepared).whatsappProvider
        : undefined;
      if (provider) {
        const unique = await assertUniqueWhatsappProviderInOrg(organizationId, provider);
        if (unique.conflict) {
          return reply.status(409).send({
            error: "Conflict",
            message: `A WhatsApp inbox for provider "${provider}" already exists (${unique.existingInboxName}).`,
            statusCode: 409,
          });
        }
      }
      channelConfig = prepared as Prisma.InputJsonValue;
    } else if (body.channelConfig != null && typeof body.channelConfig === "object") {
      channelConfig = body.channelConfig as Prisma.InputJsonValue;
    }

    if (body.isDefault) {
      inbox = await prisma.$transaction(async (tx) => {
        await tx.inbox.updateMany({ where: { organizationId }, data: { isDefault: false } });
        const created = await tx.inbox.create({
          data: {
            organizationId,
            name: body.name.trim(),
            description: body.description ?? undefined,
            channelType,
            isDefault: true,
            ingestToken: newIngestToken(),
            channelConfig,
            agentBotId: body.agentBotId,
          },
        });
        if (body.agentBotId) {
          await tx.settings.upsert({
            where: { organizationId },
            create: { organizationId, agentBotId: body.agentBotId },
            update: { agentBotId: body.agentBotId },
          });
        }
        return created;
      });
    } else {
      inbox = await prisma.$transaction(async (tx) => {
        const created = await tx.inbox.create({
          data: {
            organizationId,
            name: body.name.trim(),
            description: body.description ?? undefined,
            channelType,
            isDefault: false,
            ingestToken: newIngestToken(),
            channelConfig,
            agentBotId: body.agentBotId,
          },
        });
        if (body.agentBotId) {
          await tx.settings.upsert({
            where: { organizationId },
            create: { organizationId, agentBotId: body.agentBotId },
            update: { agentBotId: body.agentBotId },
          });
        }
        return created;
      });
    }

    return reply.status(201).send(enrichWhatsappInboxResponse(organizationId, inbox));
  });

  app.get<{ Params: { id: string } }>("/:id/members", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT") {
      const m = await prisma.inboxMember.findFirst({
        where: { inboxId: inbox.id, userId: request.user.id },
      });
      if (!m) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    const rows = await prisma.inboxMember.findMany({
      where: { inboxId: inbox.id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { data: rows };
  });

  app.post<{ Params: { id: string } }>("/:id/members", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const parsed = addMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId },
      select: { id: true },
    });
    if (!user) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid userId", statusCode: 400 });
    }

    const r = await prisma.inboxMember.createMany({
      data: [{ inboxId: inbox.id, userId: user.id }],
      skipDuplicates: true,
    });
    return reply.status(r.count > 0 ? 201 : 200).send({ ok: true });
  });

  app.delete<{ Params: { id: string; userId: string } }>(
    "/:id/members/:userId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const inbox = await prisma.inbox.findFirst({
        where: { id: request.params.id, organizationId },
        select: { id: true, isDefault: true },
      });
      if (!inbox) {
        return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
      }

      const deleted = await prisma.inboxMember.deleteMany({
        where: { inboxId: inbox.id, userId: request.params.userId },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Member not found", statusCode: 404 });
      }

      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/rotate-ingest-token",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const inbox = await prisma.inbox.findFirst({
        where: { id: request.params.id, organizationId },
        select: { id: true },
      });
      if (!inbox) {
        return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
      }

      const next = newIngestToken();
      const updated = await prisma.inbox.update({
        where: { id: inbox.id },
        data: { ingestToken: next },
        select: { id: true, ingestToken: true },
      });
      return updated;
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        agentBot: { select: inboxAgentBotSelect },
        _count: { select: { members: true, conversations: true } },
      },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT") {
      const m = inbox.members.find((x) => x.userId === request.user.id);
      if (!m) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
      // Agente: omitir segredos e lista de membros.
      const { members: _m, ingestToken: _t, channelConfig: _cfg, ...rest } = inbox;
      return rest;
    }

    return enrichWhatsappInboxResponse(organizationId, inbox);
  });

  app.patch<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = patchInboxSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const p = parsed.data;
    if (Object.keys(p).length === 0) {
      return reply.status(400).send({ error: "Bad Request", message: "No fields to update", statusCode: 400 });
    }

    const data: Prisma.InboxUpdateInput = {};
    if (p.name !== undefined) data.name = p.name.trim();
    if (p.description !== undefined) data.description = p.description;
    if (p.channelType !== undefined) data.channelType = p.channelType;
    if (p.channelConfig !== undefined) {
      data.channelConfig =
        p.channelConfig === null ? Prisma.JsonNull : (p.channelConfig as Prisma.InputJsonValue);
    }
    if (p.agentBotId !== undefined) {
      if (p.agentBotId === null) {
        data.agentBot = { disconnect: true };
      } else {
        const ok = await assertAgentBotBelongsToOrg(organizationId, p.agentBotId, reply);
        if (!ok) return;
        data.agentBot = { connect: { id: p.agentBotId } };
      }
    }
    if (p.isDefault === true) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.inbox.updateMany({ where: { organizationId }, data: { isDefault: false } });
        const next = await tx.inbox.update({ where: { id: inbox.id }, data: { ...data, isDefault: true } });
        if (p.agentBotId && p.agentBotId !== null) {
          await tx.settings.upsert({
            where: { organizationId },
            create: { organizationId, agentBotId: p.agentBotId },
            update: { agentBotId: p.agentBotId },
          });
        }
        return next;
      });
      return enrichWhatsappInboxResponse(organizationId, updated);
    }
    if (p.isDefault === false && inbox.isDefault) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Cannot unset default; set another inbox as default first",
        statusCode: 400,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.inbox.update({ where: { id: inbox.id }, data });
      if (p.agentBotId && p.agentBotId !== null) {
        await tx.settings.upsert({
          where: { organizationId },
          create: { organizationId, agentBotId: p.agentBotId },
          update: { agentBotId: p.agentBotId },
        });
      }
      return next;
    });
    return enrichWhatsappInboxResponse(organizationId, updated);
  });

  app.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const id = request.params.id;

    const inbox = await prisma.inbox.findFirst({
      where: { id, organizationId },
      select: { id: true, isDefault: true },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const allInboxes = await prisma.inbox.findMany({
      where: { organizationId },
      select: { id: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });

    if (allInboxes.length <= 1) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Cannot delete the only inbox in the organization",
        statusCode: 400,
      });
    }

    const fallback = allInboxes.find((x) => x.id !== id);
    if (!fallback) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "No target inbox to reassign conversations",
        statusCode: 400,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { organizationId, inboxId: id },
        data: { inboxId: fallback.id },
      });

      if (inbox.isDefault) {
        await tx.inbox.updateMany({
          where: { organizationId },
          data: { isDefault: false },
        });
        await tx.inbox.update({
          where: { id: fallback.id },
          data: { isDefault: true },
        });
      }

      await tx.inbox.delete({ where: { id } });
    });

    return reply.status(204).send();
  });
}
