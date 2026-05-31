import { FastifyInstance } from "fastify";
import { z } from "zod";
import { WavoipConnectionMode } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { recordAuditLog, clientIp } from "../lib/audit.js";
import { wavoipWebhookUrlForDevice } from "../config.js";
import {
  DEFAULT_WAVOIP_WEBHOOK_EVENTS,
  deviceToClientRow,
  decryptWavoipSecret,
  encryptWavoipSecret,
  generateWavoipWebhookSecret,
  prepareDeviceTokenForSave,
  wavoipQrImageUrl,
} from "../lib/wavoipDeviceConfig.js";
import { buildWavoipSipInfo } from "../lib/wavoipSipInfo.js";
import {
  prepareExternalConfigForSave,
  type WavoipExternalConfigFields,
} from "../lib/wavoipExternalConfig.js";
import {
  previewDeviceBridgeFromInbox,
  provisionDeviceEvolutionBridge,
  syncDeviceBridgeFromInbox,
  validateDeviceEvolutionBridge,
  type BridgeProvisionResult,
} from "../lib/wavoipEvolutionBridge.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { getWavoipMetrics } from "../lib/wavoipMetrics.js";
import {
  prepareOutboundIntegrationsForSave,
  type WavoipOutboundIntegrationsFields,
} from "../lib/wavoipOutboundIntegrations.js";

const externalConfigSchema = z
  .object({
    evolutionUrl: z.string().max(512).nullable().optional(),
    evolutionApiKey: z.string().max(512).nullable().optional(),
    evolutionInstance: z.string().max(120).nullable().optional(),
  })
  .optional();

const createDeviceSchema = z.object({
  name: z.string().min(1).max(120),
  deviceToken: z.string().min(8).max(512),
  connectionMode: z.nativeEnum(WavoipConnectionMode).default("QR_NATIVE"),
  inboxId: z.string().uuid().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  sipEnabled: z.boolean().optional(),
  externalConfig: externalConfigSchema,
});

const integrationTargetSchema = z
  .object({
    url: z.string().max(2048).nullable().optional(),
    secret: z.string().max(512).nullable().optional(),
    events: z.array(z.enum(["CALL", "RECORD", "DEVICE"])).optional(),
  })
  .nullable()
  .optional();

const outboundIntegrationsSchema = z
  .object({
    n8n: integrationTargetSchema,
    chatwoot: integrationTargetSchema,
  })
  .optional();

const updateDeviceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  deviceToken: z.string().min(8).max(512).optional(),
  connectionMode: z.nativeEnum(WavoipConnectionMode).optional(),
  inboxId: z.string().uuid().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookEvents: z.array(z.enum(["CALL", "RECORD", "DEVICE"])).optional(),
  sipEnabled: z.boolean().optional(),
  externalConfig: externalConfigSchema,
  outboundIntegrations: outboundIntegrationsSchema,
});

const deviceInclude = {
  inbox: { select: { name: true } },
  assignedUser: { select: { name: true } },
} as const;

export async function wavoipIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);
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

  app.get("/metrics", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = request.query as { from?: string; to?: string; deviceId?: string };
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid from date", statusCode: 400 });
    }
    if (to && Number.isNaN(to.getTime())) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid to date", statusCode: 400 });
    }

    return getWavoipMetrics({
      organizationId,
      from,
      to,
      deviceId: query.deviceId,
    });
  });

  app.get("/devices", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const rows = await prisma.wavoipDevice.findMany({
      where: { organizationId },
      include: deviceInclude,
      orderBy: { createdAt: "desc" },
    });

    return rows.map((d) =>
      deviceToClientRow(d, wavoipWebhookUrlForDevice(organizationId, d.id), false),
    );
  });

  app.post("/devices", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    if (parsed.data.inboxId) {
      const inbox = await prisma.inbox.findFirst({
        where: { id: parsed.data.inboxId, organizationId },
      });
      if (!inbox) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid inboxId", statusCode: 400 });
      }
    }

    if (parsed.data.assignedUserId) {
      const user = await prisma.user.findFirst({
        where: { id: parsed.data.assignedUserId, organizationId },
      });
      if (!user) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid assignedUserId", statusCode: 400 });
      }
    }

    const webhookSecret = generateWavoipWebhookSecret();
    const device = await prisma.wavoipDevice.create({
      data: {
        organizationId,
        name: parsed.data.name.trim(),
        deviceTokenEnc: encryptWavoipSecret(parsed.data.deviceToken),
        connectionMode: parsed.data.connectionMode,
        inboxId: parsed.data.inboxId ?? null,
        assignedUserId: parsed.data.assignedUserId ?? null,
        webhookEnabled: parsed.data.webhookEnabled ?? true,
        webhookSecretEnc: encryptWavoipSecret(webhookSecret),
        webhookEvents: [...DEFAULT_WAVOIP_WEBHOOK_EVENTS],
        sipEnabled: parsed.data.sipEnabled ?? false,
        ...(prepareExternalConfigForSave(
          parsed.data.externalConfig as WavoipExternalConfigFields | undefined,
          null,
        )
          ? {
              externalConfig: prepareExternalConfigForSave(
                parsed.data.externalConfig as WavoipExternalConfigFields | undefined,
                null,
              ),
            }
          : {}),
      },
      include: deviceInclude,
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "wavoip.device.create",
      resourceType: "wavoip_device",
      resourceId: device.id,
      metadata: { name: device.name, connectionMode: device.connectionMode },
      ip: clientIp(request),
    });

    return reply.status(201).send({
      ...deviceToClientRow(device, wavoipWebhookUrlForDevice(organizationId, device.id), true),
      webhookSecret,
    });
  });

  app.get<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
      include: deviceInclude,
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    return deviceToClientRow(device, wavoipWebhookUrlForDevice(organizationId, device.id), true);
  });

  app.patch<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const current = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!current) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    if (parsed.data.inboxId) {
      const inbox = await prisma.inbox.findFirst({
        where: { id: parsed.data.inboxId, organizationId },
      });
      if (!inbox) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid inboxId", statusCode: 400 });
      }
    }

    let deviceTokenEnc = current.deviceTokenEnc;
    if (parsed.data.deviceToken !== undefined) {
      try {
        const prep = prepareDeviceTokenForSave(parsed.data.deviceToken, current.deviceTokenEnc);
        deviceTokenEnc = prep.tokenEnc;
      } catch {
        return reply.status(400).send({ error: "Bad Request", message: "Device token required", statusCode: 400 });
      }
    }

    const device = await prisma.wavoipDevice.update({
      where: { id: current.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        deviceTokenEnc,
        ...(parsed.data.connectionMode !== undefined ? { connectionMode: parsed.data.connectionMode } : {}),
        ...(parsed.data.inboxId !== undefined ? { inboxId: parsed.data.inboxId } : {}),
        ...(parsed.data.assignedUserId !== undefined ? { assignedUserId: parsed.data.assignedUserId } : {}),
        ...(parsed.data.webhookEnabled !== undefined ? { webhookEnabled: parsed.data.webhookEnabled } : {}),
        ...(parsed.data.webhookEvents !== undefined ? { webhookEvents: parsed.data.webhookEvents } : {}),
        ...(parsed.data.sipEnabled !== undefined ? { sipEnabled: parsed.data.sipEnabled } : {}),
        ...(prepareExternalConfigForSave(
          parsed.data.externalConfig as WavoipExternalConfigFields | undefined,
          current.externalConfig,
        ) !== undefined
          ? {
              externalConfig: prepareExternalConfigForSave(
                parsed.data.externalConfig as WavoipExternalConfigFields | undefined,
                current.externalConfig,
              ),
            }
          : {}),
        ...(prepareOutboundIntegrationsForSave(
          parsed.data.outboundIntegrations as WavoipOutboundIntegrationsFields | undefined,
          current.outboundIntegrations,
        ) !== undefined
          ? {
              outboundIntegrations: prepareOutboundIntegrationsForSave(
                parsed.data.outboundIntegrations as WavoipOutboundIntegrationsFields | undefined,
                current.outboundIntegrations,
              ),
            }
          : {}),
      },
      include: deviceInclude,
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "wavoip.device.update",
      resourceType: "wavoip_device",
      resourceId: device.id,
      ip: clientIp(request),
    });

    return deviceToClientRow(device, wavoipWebhookUrlForDevice(organizationId, device.id), true);
  });

  app.delete<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    await prisma.wavoipDevice.delete({ where: { id: device.id } });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "wavoip.device.delete",
      resourceType: "wavoip_device",
      resourceId: device.id,
      metadata: { name: device.name },
      ip: clientIp(request),
    });

    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/devices/:id/status", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
      select: {
        id: true,
        status: true,
        linkedPhone: true,
        lastStatusAt: true,
        lastError: true,
      },
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    return {
      id: device.id,
      status: device.status,
      linkedPhone: device.linkedPhone,
      lastStatusAt: device.lastStatusAt?.toISOString() ?? null,
      lastError: device.lastError,
    };
  });

  app.get<{ Params: { id: string } }>("/devices/:id/qr", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    const token = decryptWavoipSecret(device.deviceTokenEnc);
    if (!token) {
      return reply.status(400).send({ error: "Bad Request", message: "Device token missing", statusCode: 400 });
    }

    return {
      status: device.status,
      linkedPhone: device.linkedPhone,
      qrImageUrl: wavoipQrImageUrl(token),
      webhookUrl: wavoipWebhookUrlForDevice(organizationId, device.id),
    };
  });

  app.get<{ Params: { id: string } }>("/devices/:id/logs", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    const limit = Math.min(Number((request.query as { limit?: string }).limit) || 50, 200);
    const logs = await prisma.wavoipIntegrationLog.findMany({
      where: { organizationId, wavoipDeviceId: device.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return {
      data: logs.map((l) => ({
        id: l.id,
        level: l.level,
        eventType: l.eventType,
        message: l.message,
        payload: l.payload,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/devices/:id/calls", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!device) {
      return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
    }

    const limit = Math.min(Number((request.query as { limit?: string }).limit) || 30, 100);
    const calls = await prisma.wavoipCallLog.findMany({
      where: { wavoipDeviceId: device.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        conversation: { select: { id: true } },
      },
    });

    return {
      data: calls.map((c) => ({
        id: c.id,
        whatsappCallId: c.whatsappCallId,
        direction: c.direction,
        caller: c.caller,
        receiver: c.receiver,
        status: c.status,
        durationSec: c.durationSec,
        recordUrl: c.recordUrl,
        contact: c.contact,
        conversationId: c.conversationId,
        messageId: c.messageId,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  });

  app.get("/inboxes", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inboxes = await prisma.inbox.findMany({
      where: { organizationId, channelType: "WHATSAPP" },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return inboxes;
  });

  app.get<{ Params: { id: string } }>("/devices/:id/sip", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const device = await prisma.wavoipDevice.findFirst({
      where: { id: request.params.id, organizationId },
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

  app.get<{ Params: { id: string } }>("/devices/:id/bridge/preview", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const result = await previewDeviceBridgeFromInbox(request.params.id, organizationId);
    if (!result.ok) {
      const status = result.error === "device_not_found" ? 404 : 400;
      return reply.status(status).send({ error: "Bad Request", message: result.error, statusCode: status });
    }
    return result;
  });

  app.post<{ Params: { id: string } }>("/devices/:id/bridge/sync-from-inbox", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const result = await syncDeviceBridgeFromInbox(request.params.id, organizationId);
    if (!result.ok) {
      const status = result.error === "device_not_found" ? 404 : 400;
      return reply.status(status).send({
        error: "Bad Request",
        message: result.error,
        conflictDeviceName: result.conflictDeviceName,
        statusCode: status,
      });
    }

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "wavoip.bridge.sync",
      resourceType: "wavoip_device",
      resourceId: request.params.id,
      metadata: { inboxId: result.credentials.inboxId },
      ip: clientIp(request),
    });

    return result;
  });

  app.post<{ Params: { id: string } }>("/devices/:id/bridge/validate", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const result = await validateDeviceEvolutionBridge(request.params.id, organizationId);
    if ("error" in result && !result.validation) {
      const status = result.error === "device_not_found" ? 404 : 400;
      return reply.status(status).send({ error: "Bad Request", message: result.error, statusCode: status });
    }
    return result;
  });

  app.post<{ Params: { id: string } }>("/devices/:id/bridge/provision", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const body = (request.body ?? {}) as { syncFromInbox?: boolean; skipEvolutionToken?: boolean };
    const result = await provisionDeviceEvolutionBridge(request.params.id, organizationId, {
      syncFromInbox: body.syncFromInbox !== false,
      skipEvolutionToken: body.skipEvolutionToken === true,
    });

    if ("error" in result && !("steps" in result)) {
      const status = result.error === "device_not_found" ? 404 : 400;
      return reply.status(status).send({
        error: "Bad Request",
        message: result.error,
        conflictDeviceName: result.conflictDeviceName,
        statusCode: status,
      });
    }

    const provision = result as BridgeProvisionResult;

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "wavoip.bridge.provision",
      resourceType: "wavoip_device",
      resourceId: request.params.id,
      metadata: { ok: provision.ok, steps: provision.steps.map((s) => s.id) },
      ip: clientIp(request),
    });

    return provision;
  });
}
