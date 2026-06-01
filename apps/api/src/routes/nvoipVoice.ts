import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { resolveCallerForUser } from "../lib/nvoipCallContext.js";
import {
  completeAgentOutboundCall,
  startAgentOutboundCall,
  syncNvoipCallFromApi,
} from "../lib/nvoipAgentCall.js";
import { resolveNvoipCallContext } from "../lib/nvoipCallContext.js";
import { nvoipEndCall } from "../lib/nvoipClient.js";

export async function nvoipVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const enabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_voice");
    if (!enabled) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "nvoip_voice_disabled",
        statusCode: 403,
      });
    }
  });

  app.get("/session", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const account = await prisma.nvoipAccount.findUnique({
      where: { organizationId },
      select: {
        id: true,
        status: true,
        defaultCaller: true,
        lastBalance: true,
      },
    });
    if (!account || account.status !== "CONNECTED") {
      return { ready: true, canPlaceCalls: false, caller: null, balance: null };
    }

    const caller = await resolveCallerForUser(
      organizationId,
      account.id,
      request.user.id,
      account.defaultCaller,
    );

    return {
      ready: true,
      canPlaceCalls: Boolean(caller?.trim()),
      caller: caller || null,
      balance: account.lastBalance,
      accountId: account.id,
    };
  });

  app.post("/calls/outbound/start", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      clientCallId: z.string().min(1).max(128),
      phone: z.string().min(3).max(64),
      contactId: z.string().uuid().nullable().optional(),
      conversationId: z.string().uuid().nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const agent = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { name: true },
    });
    const userName = agent?.name?.trim() || request.user.email.split("@")[0] || "Agent";

    const result = await startAgentOutboundCall({
      organizationId,
      userId: request.user.id,
      userName,
      clientCallId: parsed.data.clientCallId,
      phone: parsed.data.phone,
      contactId: parsed.data.contactId ?? null,
      conversationId: parsed.data.conversationId ?? null,
    });
    if (!result.ok) {
      return reply.status(400).send({ error: "Bad Request", message: result.message, statusCode: 400 });
    }
    return {
      ok: true,
      callId: result.callId,
      dialPhone: result.dialPhone,
      contactId: result.contactId,
      conversationId: result.conversationId,
    };
  });

  app.get("/calls/status", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      callId: z.string().min(1).max(128),
      clientCallId: z.string().max(128).optional(),
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const sync = await syncNvoipCallFromApi({
      organizationId,
      externalCallId: parsed.data.callId,
      clientCallId: parsed.data.clientCallId,
    });
    return { ok: true, ...sync };
  });

  app.post("/calls/outbound/complete", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      clientCallId: z.string().min(1).max(128),
      callId: z.string().min(1).max(128).optional(),
      status: z.string().min(1).max(64),
      durationSec: z.number().int().min(0).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const result = await completeAgentOutboundCall({
      organizationId,
      clientCallId: parsed.data.clientCallId,
      externalCallId: parsed.data.callId ?? null,
      status: parsed.data.status,
      durationSec: parsed.data.durationSec ?? null,
    });
    if (!result.ok) {
      return reply.status(400).send({ error: "Bad Request", message: result.message, statusCode: 400 });
    }
    return { ok: true };
  });

  app.post("/calls/end", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({ callId: z.string().min(1).max(128) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const row = await prisma.nvoipCallLog.findFirst({
      where: { organizationId, externalCallId: parsed.data.callId },
      include: { nvoipAccount: true },
    });
    if (!row?.nvoipAccount) {
      return reply.status(404).send({ error: "Not Found", message: "call_not_found", statusCode: 404 });
    }

    try {
      await nvoipEndCall(row.nvoipAccount, parsed.data.callId);
    } catch {
      /* best-effort */
    }
    const sync = await syncNvoipCallFromApi({
      organizationId,
      externalCallId: parsed.data.callId,
      clientCallId: row.clientCallId,
    });
    return { ok: true, ...sync };
  });

  app.get("/calls/resolve-context", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      phone: z.string().min(3).max(64),
      contactId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({
      where: { organizationId, status: "CONNECTED" },
      select: { id: true },
    });
    if (!account) {
      return reply.status(400).send({ error: "Bad Request", message: "nvoip_not_configured", statusCode: 400 });
    }

    const ctx = await resolveNvoipCallContext({
      organizationId,
      nvoipAccountId: account.id,
      phone: parsed.data.phone,
      contactId: parsed.data.contactId ?? null,
      conversationId: parsed.data.conversationId ?? null,
    });

    return {
      dialPhone: ctx.dialPhone,
      contact: ctx.contact,
      conversationId: ctx.conversationId,
    };
  });

  app.get("/calls/my-recent", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const logs = await prisma.nvoipCallLog.findMany({
      where: { organizationId, initiatedByUserId: request.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        initiatedByUser: { select: { id: true, name: true } },
      },
    });

    return {
      data: logs.map((log) => ({
        id: log.id,
        externalCallId: log.externalCallId,
        direction: log.direction,
        status: log.status,
        durationSec: log.durationSec,
        caller: log.caller,
        receiver: log.receiver,
        recordUrl: log.recordUrl,
        createdAt: log.createdAt.toISOString(),
        endedAt: log.endedAt?.toISOString() ?? null,
        contact: log.contact,
        conversationId: log.conversationId,
        agent: log.initiatedByUser,
      })),
    };
  });
}
