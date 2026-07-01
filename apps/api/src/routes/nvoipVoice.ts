import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { listNvoipTrunks, listNvoipWebphoneUsers, resolveNvoipOutboundCallerDetailed } from "../lib/nvoipTrunks.js";
import { parseNvoipPabxMode } from "../lib/nvoipPabxConfig.js";
import {
  claimNvoipCallAgent,
  completeAgentOutboundCall,
  forceEndNvoipConversationCall,
  startAgentOutboundCall,
  syncNvoipCallFromApi,
} from "../lib/nvoipAgentCall.js";
import { resolveNvoipCallContext } from "../lib/nvoipCallContext.js";
import { nvoipEndCall } from "../lib/nvoipClient.js";
import { writeNvoipIntegrationLog } from "../lib/nvoipIntegrationLog.js";
import { getUserSipCredentialsForClient } from "../lib/userSipCredentials.js";

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
        numbersip: true,
        externalConfig: true,
      },
    });
    if (!account || account.status !== "CONNECTED") {
      return { ready: true, canPlaceCalls: false, caller: null, balance: null };
    }

    const resolution = await resolveNvoipOutboundCallerDetailed({
      organizationId,
      accountId: account.id,
      userId: request.user.id,
      accountDefaultCaller: account.defaultCaller,
    });
    const caller = resolution?.caller ?? "";
    const webphoneUsers = await listNvoipWebphoneUsers(account.id);
    const trunks = await listNvoipTrunks(organizationId);
    const embeddedSipEnabled = await isOrganizationFeatureEnabled(
      organizationId,
      "nvoip_embedded_sip",
    );
    const userSipCreds = embeddedSipEnabled
      ? await getUserSipCredentialsForClient(request.user.id)
      : null;
    const pabxMode = parseNvoipPabxMode(
      account.externalConfig != null &&
        typeof account.externalConfig === "object" &&
        !Array.isArray(account.externalConfig)
        ? (account.externalConfig as Record<string, unknown>).pabxMode
        : undefined,
    );
    const voiceMode =
      embeddedSipEnabled &&
      pabxMode !== "external_pabx_trunk" &&
      pabxMode !== "platform_webphone" &&
      userSipCreds &&
      resolution?.source === "embedded_sip"
        ? ("embedded_sip" as const)
        : ("click_to_call" as const);

    return {
      ready: true,
      canPlaceCalls: Boolean(caller?.trim()),
      caller: caller || null,
      balance: account.lastBalance,
      accountId: account.id,
      accountNumbersip: account.numbersip,
      trunks,
      voiceMode,
      pabxMode,
      embeddedSipEnabled,
      hasUserSipCredentials: Boolean(userSipCreds),
      callerSource: resolution?.source ?? null,
      callerHasWebphone: resolution?.hasWebphone ?? false,
      callerWarning: resolution?.warning ?? null,
      webphoneUsers: webphoneUsers.map((u) => ({
        numbersip: u.numbersip,
        caller: u.caller,
        name: u.name,
      })),
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
      trunkId: z.string().uuid().nullable().optional(),
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
      trunkId: parsed.data.trunkId ?? null,
    });
    if (!result.ok) {
      return reply.status(400).send({ error: "Bad Request", message: result.message, statusCode: 400 });
    }
    return {
      ok: true,
      callId: result.callId,
      dialPhone: result.dialPhone,
      caller: result.caller,
      contactId: result.contactId,
      conversationId: result.conversationId,
      initialStatus: result.initialStatus,
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

  app.post("/calls/claim-agent", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      clientCallId: z.string().min(1).max(128).optional(),
      conversationId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    if (!parsed.data.clientCallId && !parsed.data.conversationId) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "clientCallId_or_conversationId_required",
        statusCode: 400,
      });
    }

    await claimNvoipCallAgent({
      organizationId,
      userId: request.user.id,
      clientCallId: parsed.data.clientCallId ?? null,
      conversationId: parsed.data.conversationId ?? null,
    });
    return { ok: true };
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

    const endResult = await nvoipEndCall(row.nvoipAccount, parsed.data.callId, {
      caller: row.caller,
    });

    if (!endResult.ok) {
      const syncAfterFail = await syncNvoipCallFromApi({
        organizationId,
        externalCallId: parsed.data.callId,
        clientCallId: row.clientCallId,
      });
      if (syncAfterFail.terminal) {
        return { ok: true, recovered: true, ...syncAfterFail };
      }
      const message = endResult.error ?? "end_call_failed";
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: row.nvoipAccount.id,
        level: "error",
        eventType: "outbound_call_end_failed",
        message: `GET/POST /endcall callId=${parsed.data.callId}: ${message}`,
        payload: { callId: parsed.data.callId, clientCallId: row.clientCallId },
      });
      return reply.status(502).send({
        error: "Bad Gateway",
        message,
        statusCode: 502,
      });
    }

    if (!endResult.verified) {
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: row.nvoipAccount.id,
        level: "warn",
        eventType: "outbound_call_end_unverified",
        message: `endcall acknowledged but GET /calls still live callId=${parsed.data.callId}`,
        payload: { callId: parsed.data.callId, clientCallId: row.clientCallId },
      });
    }

    let sync = await syncNvoipCallFromApi({
      organizationId,
      externalCallId: parsed.data.callId,
      clientCallId: row.clientCallId,
    });

    if (!sync.terminal && row.clientCallId) {
      await completeAgentOutboundCall({
        organizationId,
        clientCallId: row.clientCallId,
        externalCallId: parsed.data.callId,
        status: "ENDED",
        durationSec: sync.durationSec ?? row.durationSec,
      });
      sync = {
        ...sync,
        status: "ENDED",
        terminal: true,
      };
    }

    return { ok: true, hungUp: endResult.verified, ...sync };
  });

  app.post("/calls/force-end-conversation", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({ conversationId: z.string().uuid() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const result = await forceEndNvoipConversationCall({
      organizationId,
      conversationId: parsed.data.conversationId,
    });
    if (!result.ok) {
      return reply.status(404).send({ error: "Not Found", message: result.message, statusCode: 404 });
    }
    return { ok: true };
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
