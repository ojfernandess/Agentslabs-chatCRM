import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { recordAuditLog, clientIp } from "../lib/audit.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  encryptThreeCxSecret,
  generateThreeCxCrmApiKey,
  normalizePbxBaseUrl,
  parseMonitoredDns,
  routePointToClientRow,
} from "../lib/threeCxConfig.js";
import { testThreeCxConnection } from "../lib/threeCxCallControl.js";
import { mergeIncomingQueueIntoExternalConfig, parseIncomingQueue } from "../lib/wavoipIncomingQueue.js";
import { threeCxCrmBaseUrl } from "../config.js";

const incomingQueueSchema = z
  .object({
    mode: z.enum(["all", "assignee", "team"]),
    teamId: z.string().uuid().nullable().optional(),
  })
  .optional();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  pbxBaseUrl: z.string().min(8).max(512),
  clientId: z.string().min(1).max(120),
  apiKey: z.string().min(8).max(512),
  routePointDn: z.string().min(1).max(32),
  sourceExtensionDn: z.string().max(32).nullable().optional(),
  inboxId: z.string().uuid().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  monitoredDns: z.array(z.string().max(32)).max(32).optional(),
  incomingQueue: incomingQueueSchema,
});

const updateSchema = createSchema
  .partial()
  .extend({
    apiKey: z.string().min(8).max(512).optional(),
    regenerateCrmApiKey: z.boolean().optional(),
  });

const routeInclude = {
  inbox: { select: { name: true } },
  assignedUser: { select: { name: true } },
} as const;

export async function threecxIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);
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

  app.get("/route-points", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const rows = await prisma.threeCxRoutePoint.findMany({
      where: { organizationId },
      include: routeInclude,
      orderBy: { name: "asc" },
    });

    const data = await Promise.all(
      rows.map(async (row) => {
        const queue = parseIncomingQueue(row.externalConfig);
        let teamName: string | null = null;
        if (queue.teamId) {
          const team = await prisma.team.findFirst({
            where: { id: queue.teamId, organizationId },
            select: { name: true },
          });
          teamName = team?.name ?? null;
        }
        return routePointToClientRow(row, organizationId, teamName);
      }),
    );
    return { data };
  });

  app.post("/route-points", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const crmKey = generateThreeCxCrmApiKey();
    const externalConfig = parsed.data.incomingQueue
      ? mergeIncomingQueueIntoExternalConfig({}, {
          mode: parsed.data.incomingQueue.mode,
          teamId: parsed.data.incomingQueue.teamId ?? null,
        })
      : undefined;

    const row = await prisma.threeCxRoutePoint.create({
      data: {
        organizationId,
        name: parsed.data.name.trim(),
        pbxBaseUrl: normalizePbxBaseUrl(parsed.data.pbxBaseUrl),
        clientId: parsed.data.clientId.trim(),
        apiKeyEnc: encryptThreeCxSecret(parsed.data.apiKey),
        routePointDn: parsed.data.routePointDn.trim(),
        sourceExtensionDn: parsed.data.sourceExtensionDn?.trim() ?? null,
        crmApiKeyEnc: encryptThreeCxSecret(crmKey),
        inboxId: parsed.data.inboxId ?? null,
        assignedUserId: parsed.data.assignedUserId ?? null,
        monitoredDns: parsed.data.monitoredDns ?? [],
        externalConfig: externalConfig as Prisma.InputJsonValue | undefined,
        status: "DISCONNECTED",
      },
      include: routeInclude,
    });

    const test = await testThreeCxConnection({
      pbxBaseUrl: row.pbxBaseUrl,
      clientId: row.clientId,
      apiKeyEnc: row.apiKeyEnc,
      routePointDn: row.routePointDn,
    });
    const updated = await prisma.threeCxRoutePoint.update({
      where: { id: row.id },
      data: {
        status: test.ok ? "CONNECTED" : "ERROR",
        lastStatusAt: new Date(),
        lastError: test.ok ? null : test.message,
      },
      include: routeInclude,
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "threecx.route_point.create",
      resourceType: "threecx_route_point",
      resourceId: row.id,
      metadata: { name: row.name },
      ip: clientIp(request),
    });

    return {
      ...routePointToClientRow(updated, organizationId),
      crmApiKey: crmKey,
      crmEndpoints: {
        lookupNumber: `${threeCxCrmBaseUrl(organizationId, row.id)}/lookup/number`,
        lookupEmail: `${threeCxCrmBaseUrl(organizationId, row.id)}/lookup/email`,
        search: `${threeCxCrmBaseUrl(organizationId, row.id)}/search`,
        journalCall: `${threeCxCrmBaseUrl(organizationId, row.id)}/journal/call`,
      },
    };
  });

  app.patch<{ Params: { id: string } }>("/route-points/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.threeCxRoutePoint.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Route point not found", statusCode: 404 });
    }

    let externalConfig = existing.externalConfig;
    if (parsed.data.incomingQueue) {
      externalConfig = mergeIncomingQueueIntoExternalConfig(
        (existing.externalConfig as Record<string, unknown> | null) ?? {},
        {
          mode: parsed.data.incomingQueue.mode,
          teamId: parsed.data.incomingQueue.teamId ?? null,
        },
      ) as Prisma.JsonValue;
    }

    let crmApiKey: string | undefined;
    let crmApiKeyEnc = existing.crmApiKeyEnc;
    if (parsed.data.regenerateCrmApiKey) {
      crmApiKey = generateThreeCxCrmApiKey();
      crmApiKeyEnc = encryptThreeCxSecret(crmApiKey);
    }

    const row = await prisma.threeCxRoutePoint.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name?.trim(),
        pbxBaseUrl: parsed.data.pbxBaseUrl ? normalizePbxBaseUrl(parsed.data.pbxBaseUrl) : undefined,
        clientId: parsed.data.clientId?.trim(),
        apiKeyEnc: parsed.data.apiKey ? encryptThreeCxSecret(parsed.data.apiKey) : undefined,
        routePointDn: parsed.data.routePointDn?.trim(),
        sourceExtensionDn:
          parsed.data.sourceExtensionDn !== undefined ? parsed.data.sourceExtensionDn?.trim() ?? null : undefined,
        inboxId: parsed.data.inboxId,
        assignedUserId: parsed.data.assignedUserId,
        monitoredDns:
          parsed.data.monitoredDns !== undefined ? parsed.data.monitoredDns : undefined,
        externalConfig: externalConfig as Prisma.InputJsonValue | undefined,
        crmApiKeyEnc,
      },
      include: routeInclude,
    });

    const test = await testThreeCxConnection({
      pbxBaseUrl: row.pbxBaseUrl,
      clientId: row.clientId,
      apiKeyEnc: row.apiKeyEnc,
      routePointDn: row.routePointDn,
    });
    const updated = await prisma.threeCxRoutePoint.update({
      where: { id: row.id },
      data: {
        status: test.ok ? "CONNECTED" : "ERROR",
        lastStatusAt: new Date(),
        lastError: test.ok ? null : test.message,
      },
      include: routeInclude,
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "threecx.route_point.update",
      resourceType: "threecx_route_point",
      resourceId: row.id,
      ip: clientIp(request),
    });

    const queue = parseIncomingQueue(updated.externalConfig);
    let teamName: string | null = null;
    if (queue.teamId) {
      const team = await prisma.team.findFirst({
        where: { id: queue.teamId, organizationId },
        select: { name: true },
      });
      teamName = team?.name ?? null;
    }

    return {
      ...routePointToClientRow(updated, organizationId, teamName),
      ...(crmApiKey ? { crmApiKey } : {}),
    };
  });

  app.delete<{ Params: { id: string } }>("/route-points/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const existing = await prisma.threeCxRoutePoint.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Route point not found", statusCode: 404 });
    }

    await prisma.threeCxRoutePoint.delete({ where: { id: existing.id } });
    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "threecx.route_point.delete",
      resourceType: "threecx_route_point",
      resourceId: existing.id,
      ip: clientIp(request),
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/route-points/:id/test", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const row = await prisma.threeCxRoutePoint.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Route point not found", statusCode: 404 });
    }

    const test = await testThreeCxConnection({
      pbxBaseUrl: row.pbxBaseUrl,
      clientId: row.clientId,
      apiKeyEnc: row.apiKeyEnc,
      routePointDn: row.routePointDn,
    });

    await prisma.threeCxRoutePoint.update({
      where: { id: row.id },
      data: {
        status: test.ok ? "CONNECTED" : "ERROR",
        lastStatusAt: new Date(),
        lastError: test.ok ? null : test.message,
      },
    });

    return test.ok ? { ok: true } : reply.status(400).send({ ok: false, message: test.message });
  });

  app.get<{ Params: { id: string } }>("/route-points/:id/logs", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const logs = await prisma.threeCxIntegrationLog.findMany({
      where: { organizationId, threeCxRoutePointId: request.params.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { data: logs };
  });

  app.get("/inboxes", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inboxes = await prisma.inbox.findMany({
      where: { organizationId },
      select: { id: true, name: true, isDefault: true, channelType: true },
      orderBy: { name: "asc" },
    });
    return inboxes;
  });
}
