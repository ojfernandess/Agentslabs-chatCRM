import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  completeAgentOutboundCall,
  startAgentOutboundCall,
} from "../lib/threeCxAgentCall.js";
import { resolveThreeCxCallContext } from "../lib/threeCxCallContext.js";
import { filterWavoipDevicesForAgent } from "../lib/wavoipIncomingQueue.js";

function routeAccessFilter(userId: string) {
  return {
    OR: [{ assignedUserId: null }, { assignedUserId: userId }],
  };
}

export async function threecxVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const enabled = await isOrganizationFeatureEnabled(organizationId, "threecx_voice");
    if (!enabled) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "threecx_voice_disabled",
        statusCode: 403,
      });
    }
  });

  app.get("/route-points/available", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const all = await prisma.threeCxRoutePoint.findMany({
      where: {
        organizationId,
        status: "CONNECTED",
        ...routeAccessFilter(request.user.id),
      },
      select: {
        id: true,
        name: true,
        status: true,
        routePointDn: true,
        sourceExtensionDn: true,
        inboxId: true,
        assignedUserId: true,
        externalConfig: true,
      },
      orderBy: { name: "asc" },
    });

    const points = await filterWavoipDevicesForAgent(request.user.id, all);
    return {
      data: points.map(({ assignedUserId: _a, externalConfig: _e, ...p }) => p),
    };
  });

  app.post("/calls/outbound/start", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      clientCallId: z.string().min(1).max(128),
      threeCxRoutePointId: z.string().uuid(),
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
      threeCxRoutePointId: parsed.data.threeCxRoutePointId,
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
      dialPhone: result.dialPhone,
      contactId: result.contactId,
      conversationId: result.conversationId,
    };
  });

  app.post("/calls/outbound/complete", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      clientCallId: z.string().min(1).max(128),
      threeCxRoutePointId: z.string().uuid(),
      status: z.string().min(1).max(64),
      durationSec: z.number().int().min(0).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const result = await completeAgentOutboundCall({
      organizationId,
      threeCxRoutePointId: parsed.data.threeCxRoutePointId,
      clientCallId: parsed.data.clientCallId,
      status: parsed.data.status,
      durationSec: parsed.data.durationSec ?? null,
    });
    if (!result.ok) {
      return reply.status(400).send({ error: "Bad Request", message: result.message, statusCode: 400 });
    }
    return { ok: true };
  });

  app.get("/calls/resolve-context", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      phone: z.string().min(3).max(64),
      threeCxRoutePointId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    let routePointId = parsed.data.threeCxRoutePointId;
    if (!routePointId) {
      const rp = await prisma.threeCxRoutePoint.findFirst({
        where: { organizationId, status: "CONNECTED", ...routeAccessFilter(request.user.id) },
        select: { id: true },
        orderBy: { name: "asc" },
      });
      if (!rp) {
        return reply.status(400).send({ error: "Bad Request", message: "no_route_points", statusCode: 400 });
      }
      routePointId = rp.id;
    }

    const ctx = await resolveThreeCxCallContext({
      organizationId,
      threeCxRoutePointId: routePointId,
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

    const logs = await prisma.threeCxCallLog.findMany({
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
        direction: log.direction,
        status: log.status,
        durationSec: log.durationSec,
        caller: log.caller,
        receiver: log.receiver,
        createdAt: log.createdAt.toISOString(),
        endedAt: log.endedAt?.toISOString() ?? null,
        contact: log.contact,
        conversationId: log.conversationId,
        agent: log.initiatedByUser,
      })),
    };
  });
}
