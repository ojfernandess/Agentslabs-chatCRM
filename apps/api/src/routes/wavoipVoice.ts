import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { decryptWavoipSecret } from "../lib/wavoipDeviceConfig.js";
import { buildWavoipSipInfo } from "../lib/wavoipSipInfo.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";

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

    const devices = await prisma.wavoipDevice.findMany({
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
      },
      orderBy: { name: "asc" },
    });

    return { data: devices };
  });

  /** Tokens for @wavoip/wavoip-api — only OPEN devices the agent may use. */
  app.get("/session", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const devices = await prisma.wavoipDevice.findMany({
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
      },
      orderBy: { name: "asc" },
    });

    const sessionDevices = devices
      .map((d) => {
        const token = decryptWavoipSecret(d.deviceTokenEnc);
        if (!token) return null;
        return {
          id: d.id,
          name: d.name,
          linkedPhone: d.linkedPhone,
          inboxId: d.inboxId,
          token,
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
}
