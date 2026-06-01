import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { decryptWavoipSecret } from "../lib/wavoipDeviceConfig.js";
import { buildWavoipSipInfo } from "../lib/wavoipSipInfo.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  claimWavoipCallAgent,
  completeAgentOutboundCall,
  startAgentOutboundCall,
} from "../lib/wavoipAgentCall.js";
import { resolveWavoipCallContext } from "../lib/wavoipCallContext.js";
import {
  filterWavoipDevicesForOutbound,
  parseIncomingQueue,
} from "../lib/wavoipIncomingQueue.js";
import { runWavoipInboundScreenPop } from "../lib/wavoipInboundScreenPop.js";
import { z } from "zod";

function deviceAccessFilter(userId: string) {
  return {
    OR: [{ assignedUserId: null }, { assignedUserId: userId }],
  };
}

export async function wavoipVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const enabled = await isOrganizationFeatureEnabled(organizationId, "wavoip_voice");
    if (!enabled) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "wavoip_voice_disabled",
        statusCode: 403,
      });
    }
  });

  app.get("/devices/available", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const allDevices = await prisma.wavoipDevice.findMany({
      where: {
        organizationId,
        status: "OPEN",
        ...deviceAccessFilter(request.user.id),
      },
      select: {
        id: true,
        name: true,
        status: true,
        linkedPhone: true,
        inboxId: true,
        connectionMode: true,
        sipEnabled: true,
        assignedUserId: true,
        externalConfig: true,
      },
      orderBy: { name: "asc" },
    });
    const devices = await filterWavoipDevicesForOutbound(request.user.id, allDevices);

    return { data: devices.map(({ assignedUserId: _a, externalConfig: _e, ...d }) => d) };
  });

  /** Tokens for @wavoip/wavoip-api — only OPEN devices the agent may use. */
  app.get("/session", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const allDevices = await prisma.wavoipDevice.findMany({
      where: {
        organizationId,
        status: "OPEN",
        ...deviceAccessFilter(request.user.id),
      },
      select: {
        id: true,
        name: true,
        linkedPhone: true,
        inboxId: true,
        deviceTokenEnc: true,
        assignedUserId: true,
        externalConfig: true,
      },
      orderBy: { name: "asc" },
    });
    const devices = await filterWavoipDevicesForOutbound(request.user.id, allDevices);

    const sessionDevices = devices
      .map((d) => {
        const token = decryptWavoipSecret(d.deviceTokenEnc);
        if (!token) return null;
        const queue = parseIncomingQueue(d.externalConfig);
        return {
          id: d.id,
          name: d.name,
          linkedPhone: d.linkedPhone,
          inboxId: d.inboxId,
          token,
          incomingQueueMode: queue.mode,
          incomingQueueTeamId: queue.teamId,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d != null);

    return {
      platform: "openconduit",
      devices: sessionDevices,
    };
  });

  app.get<{ Params: { deviceId: string } }>("/devices/:deviceId/sip", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: {
        id: request.params.deviceId,
        organizationId,
        ...deviceAccessFilter(request.user.id),
      },
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    const token = decryptWavoipSecret(device.deviceTokenEnc);
    if (!token) {
      return reply.status(400).send({ error: "Bad Request", message: "Device token missing", statusCode: 400 });
    }

    return buildWavoipSipInfo(device, token);
  });

  /** Screen pop ao receber offer no browser (SDK) — não depende só do webhook Wavoip. */
  app.post("/calls/incoming/screen-pop", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      wavoipDeviceId: z.string().uuid(),
      phone: z.string().min(3).max(64),
      clientCallId: z.string().min(1).max(128).optional(),
      displayName: z.string().max(255).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const device = await prisma.wavoipDevice.findFirst({
      where: {
        id: parsed.data.wavoipDeviceId,
        organizationId,
        status: "OPEN",
        ...deviceAccessFilter(request.user.id),
      },
      select: { id: true },
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    const result = await runWavoipInboundScreenPop({
      organizationId,
      wavoipDeviceId: device.id,
      callerPhone: parsed.data.phone,
      clientCallId: parsed.data.clientCallId ?? null,
      displayName: parsed.data.displayName ?? null,
      broadcastWs: true,
    });
    if (!result) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "screen_pop_failed",
        statusCode: 400,
      });
    }

    return { ok: true, ...result };
  });

  app.post("/calls/outbound/start", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      clientCallId: z.string().min(1).max(128),
      wavoipDeviceId: z.string().uuid(),
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
      wavoipDeviceId: parsed.data.wavoipDeviceId,
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

  app.get("/calls/resolve-context", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      phone: z.string().min(3).max(64),
      wavoipDeviceId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    let deviceId = parsed.data.wavoipDeviceId;
    if (!deviceId) {
      const device = await prisma.wavoipDevice.findFirst({
        where: { organizationId, status: "OPEN", ...deviceAccessFilter(request.user.id) },
        select: { id: true },
        orderBy: { name: "asc" },
      });
      if (!device) {
        return reply.status(400).send({ error: "Bad Request", message: "no_devices", statusCode: 400 });
      }
      deviceId = device.id;
    } else {
      const device = await prisma.wavoipDevice.findFirst({
        where: { id: deviceId, organizationId, ...deviceAccessFilter(request.user.id) },
        select: { id: true },
      });
      if (!device) {
        return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
      }
    }

    const ctx = await resolveWavoipCallContext({
      organizationId,
      wavoipDeviceId: deviceId,
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

    await claimWavoipCallAgent({
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
      status: z.string().min(1).max(64),
      durationSec: z.number().int().min(0).nullable().optional(),
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

    await completeAgentOutboundCall({
      organizationId,
      userId: request.user.id,
      userName,
      clientCallId: parsed.data.clientCallId,
      status: parsed.data.status,
      durationSec: parsed.data.durationSec ?? null,
    });
    return { ok: true };
  });

  app.get("/calls/my-recent", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const logs = await prisma.wavoipCallLog.findMany({
      where: {
        organizationId,
        initiatedByUserId: request.user.id,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        conversation: { select: { id: true } },
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
