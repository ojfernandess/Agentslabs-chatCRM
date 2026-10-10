import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { prisma } from "../db.js";
import { syncNvoipInboundHistoryForAccount } from "../lib/nvoipInboundSync.js";
import { routeNvoipDidsToProfileRamais } from "../lib/nvoipProfileDidRoute.js";
import {
  deleteUserSipCredentials,
  getUserSipCredentialsForClient,
  resolveOrganizationSipEndpoint,
  upsertUserSipCredentials,
} from "../lib/userSipCredentials.js";
import { getOrgSipServer, normalizeOrgSipRingtone, saveOrgSipServer } from "../lib/orgSipServer.js";
import { isUserTenantAdmin } from "../lib/tenantAdmin.js";
import { completeSipCallLog, startSipCallLog } from "../lib/sipCallLog.js";
import { claimSipCallDistribution, completeSipCallDistribution, touchSipAgentPresence } from "../lib/sipCallDistributionService.js";
import { buildSipDistributionBoard } from "../lib/sipDistributionBoard.js";
import { broadcastToOrganization } from "../lib/workspaceHub.js";

const upsertSchema = z.object({
  sipUser: z.string().min(1).max(64),
  sipPassword: z.string().min(1).max(256),
  displayName: z.string().max(200).nullable().optional(),
});

export async function sipCredentialsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  async function requireEmbeddedSip(
    organizationId: string,
    reply: import("fastify").FastifyReply,
  ): Promise<boolean> {
    const enabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_embedded_sip");
    if (!enabled) {
      reply.status(403).send({
        error: "Forbidden",
        message: "nvoip_embedded_sip_disabled",
        statusCode: 403,
      });
      return false;
    }
    return true;
  }

  app.get("/server", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const endpoint = await resolveOrganizationSipEndpoint(organizationId);
    const stored = await getOrgSipServer(organizationId);
    return {
      sipProvider: endpoint.sipProvider,
      configurable: true,
      sipDomain: stored?.sipDomain || endpoint.sipDomain,
      wssUrl: stored?.wssUrl || endpoint.wssUrl,
      ringTone: stored?.ringTone ?? endpoint.ringTone,
      callDistribution: stored?.callDistribution === true,
    };
  });

  app.put("/server", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    if (!(await isUserTenantAdmin(request.user))) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required",
        statusCode: 403,
      });
    }
    const parsed = z
      .object({
        sipDomain: z.string().min(1).max(253),
        wssUrl: z.string().min(8).max(300),
        ringTone: z.string().max(32).optional(),
        callDistribution: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_server_invalid",
        statusCode: 400,
      });
    }
    try {
      const saved = await saveOrgSipServer(organizationId, {
        ...parsed.data,
        ringTone: parsed.data.ringTone ? normalizeOrgSipRingtone(parsed.data.ringTone) : undefined,
        callDistribution: parsed.data.callDistribution,
      });
      return { ok: true, ...saved, sipProvider: "sip" as const, configurable: true };
    } catch {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_server_invalid",
        statusCode: 400,
      });
    }
  });

  app.get("/credentials", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;

    const creds = await getUserSipCredentialsForClient(request.user.id, organizationId);
    if (!creds) {
      return reply.status(404).send({
        error: "Not Found",
        message: "sip_credentials_not_configured",
        statusCode: 404,
      });
    }
    return creds;
  });

  app.put("/credentials", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;

    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    try {
      await upsertUserSipCredentials({
        userId: request.user.id,
        organizationId,
        sipUser: parsed.data.sipUser,
        sipPassword: parsed.data.sipPassword,
        displayName: parsed.data.displayName ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "sip_credentials_invalid";
      return reply.status(400).send({ error: "Bad Request", message, statusCode: 400 });
    }

    return { ok: true };
  });

  app.delete("/credentials", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    await deleteUserSipCredentials({ userId: request.user.id, organizationId });
    broadcastToOrganization(organizationId, { type: "sip.distribution.updated", reason: "resync" });
    return { ok: true };
  });

  app.post("/inbound-route", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;

    const body = z.object({ syncOnly: z.boolean().optional() }).safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: body.error.message,
        statusCode: 400,
      });
    }

    const routed = body.data.syncOnly
      ? { ramais: [] as string[], updated: [] as string[], warning: null as string | null, webphoneReleased: false }
      : await routeNvoipDidsToProfileRamais(organizationId);
    const account = await prisma.nvoipAccount.findFirst({
      where: { organizationId, status: "CONNECTED" },
    });
    if (account) {
      void syncNvoipInboundHistoryForAccount(account).catch(() => {});
    }
    return { ok: true, ...routed };
  });

  app.post("/calls", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const parsed = z
      .object({
        clientCallId: z.string().uuid(),
        direction: z.enum(["INCOMING", "OUTGOING"]),
        phone: z.string().min(1).max(32),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_call_invalid",
        statusCode: 400,
      });
    }
    await startSipCallLog({
      organizationId,
      userId: request.user.id,
      ...parsed.data,
    });
    return { ok: true };
  });

  app.post("/presence", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const parsed = z
      .object({ state: z.enum(["registered", "busy", "offline"]) })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_presence_invalid",
        statusCode: 400,
      });
    }
    await touchSipAgentPresence({
      userId: request.user.id,
      organizationId,
      state: parsed.data.state,
    });
    return { ok: true };
  });

  app.get("/distribution/board", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    if (!(await isUserTenantAdmin(request.user))) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required",
        statusCode: 403,
      });
    }
    return buildSipDistributionBoard(organizationId);
  });

  app.post("/distribution/claim", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const parsed = z
      .object({
        sipCallId: z.string().min(8).max(256),
        caller: z.string().max(32).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_call_invalid",
        statusCode: 400,
      });
    }
    return claimSipCallDistribution({
      organizationId,
      userId: request.user.id,
      sipCallId: parsed.data.sipCallId,
      caller: parsed.data.caller ?? "",
    });
  });

  app.post("/distribution/result", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const parsed = z
      .object({
        distributionId: z.string().uuid(),
        status: z.enum(["ANSWERED", "REJECTED", "MISSED", "ENDED"]),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_call_invalid",
        statusCode: 400,
      });
    }
    await completeSipCallDistribution({
      organizationId,
      userId: request.user.id,
      distributionId: parsed.data.distributionId,
      status: parsed.data.status,
    });
    return { ok: true };
  });

  app.post("/calls/answered", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const parsed = z
      .object({
        sipCallId: z.string().min(8).max(256),
        caller: z.string().max(32).optional(),
        startedAt: z.number().int().min(0).max(10_000_000_000_000).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_call_invalid",
        statusCode: 400,
      });
    }
    broadcastToOrganization(organizationId, {
      type: "sip.call.answered",
      sipCallId: parsed.data.sipCallId,
      caller: parsed.data.caller ?? "",
      startedAt: parsed.data.startedAt ?? null,
      userId: request.user.id,
    });
    return { ok: true };
  });

  app.post("/calls/complete", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const parsed = z
      .object({
        clientCallId: z.string().uuid(),
        status: z.string().min(1).max(64),
        durationSec: z.number().int().min(0).max(86_400).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "sip_call_invalid",
        statusCode: 400,
      });
    }
    await completeSipCallLog({
      organizationId,
      userId: request.user.id,
      clientCallId: parsed.data.clientCallId,
      status: parsed.data.status,
      durationSec: parsed.data.durationSec ?? null,
    });
    return { ok: true };
  });

  app.get("/calls/my-recent", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;
    const logs = await prisma.sipCallLog.findMany({
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
        externalCallId: log.clientCallId,
        direction: log.direction,
        status: log.status,
        durationSec: log.durationSec,
        caller: log.caller,
        receiver: log.receiver,
        recordUrl: null,
        createdAt: log.createdAt.toISOString(),
        endedAt: log.endedAt?.toISOString() ?? null,
        contact: log.contact,
        conversationId: log.conversationId,
        agent: log.initiatedByUser,
      })),
    };
  });
}
