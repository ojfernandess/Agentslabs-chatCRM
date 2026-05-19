import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { buildBroadcastDashboard } from "../lib/broadcastDashboard.js";
import { materializeAndStartCampaign } from "../lib/broadcastCampaignStart.js";
import { syncBroadcastCampaignEngagement } from "../lib/broadcastMetrics.js";
import {
  countBroadcastAudienceAdvanced,
} from "../lib/broadcastSegmentation.js";
import { parseSegmentRules } from "../lib/broadcastTypes.js";
import { BROADCAST_EVENT_TRIGGERS } from "../lib/broadcastTypes.js";

const channelEnum = z.enum([
  "WHATSAPP",
  "EMAIL",
  "SMS",
  "TELEGRAM",
  "INSTAGRAM",
  "MESSENGER",
  "PUSH",
  "WEBHOOK",
  "VOICE",
]);

const scheduleEnum = z.enum(["IMMEDIATE", "SCHEDULED", "RECURRING", "EVENT"]);

const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(200),
    channel: channelEnum.default("WHATSAPP"),
    inboxId: z.string().uuid().optional(),
    messageType: z.enum(["TEXT", "TEMPLATE"]),
    body: z.string().max(4096).optional(),
    templateId: z.string().uuid().optional(),
    subject: z.string().max(500).optional(),
    tagIds: z.array(z.string().uuid()).default([]),
    segmentRules: z.record(z.unknown()).optional(),
    flowDefinition: z.record(z.unknown()).optional(),
    abConfig: z.record(z.unknown()).optional(),
    scheduleType: scheduleEnum.default("IMMEDIATE"),
    scheduledAt: z.string().datetime().optional(),
    cronExpression: z.string().max(120).optional(),
    eventTrigger: z.string().max(64).optional(),
    eventConfig: z.record(z.unknown()).optional(),
    requiresApproval: z.boolean().optional(),
    integrationToolId: z.string().uuid().optional(),
    throttleMs: z.number().int().min(200).max(60_000).optional(),
    useDistributedQueue: z.boolean().optional(),
    revenuePerConversion: z.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    const hasTags = data.tagIds.length > 0;
    const seg = parseSegmentRules(data.segmentRules);
    const hasSegment =
      Boolean(seg?.pipelineStageIds?.length) ||
      Boolean(seg?.lifecycleStages?.length) ||
      Boolean(seg?.cities?.length);
    if (!hasTags && !hasSegment) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tagIds or segment filters required", path: ["tagIds"] });
    }
    if (data.messageType === "TEXT" && !data.body?.trim() && data.channel !== "EMAIL") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "body is required for TEXT" });
    }
    if (data.messageType === "TEMPLATE" && !data.templateId && data.channel === "WHATSAPP") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["templateId"], message: "templateId required" });
    }
    if (data.channel === "EMAIL" && !data.body?.trim() && !data.subject?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "email requires body or subject" });
    }
  });

const patchCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  channel: channelEnum.optional(),
  inboxId: z.string().uuid().optional().nullable(),
  messageType: z.enum(["TEXT", "TEMPLATE"]).optional(),
  body: z.string().max(4096).optional(),
  templateId: z.string().uuid().optional().nullable(),
  subject: z.string().max(500).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  segmentRules: z.record(z.unknown()).optional(),
  flowDefinition: z.record(z.unknown()).optional(),
  abConfig: z.record(z.unknown()).optional(),
  scheduleType: scheduleEnum.optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  cronExpression: z.string().max(120).optional().nullable(),
  eventTrigger: z.string().max(64).optional().nullable(),
  eventConfig: z.record(z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
  integrationToolId: z.string().uuid().optional().nullable(),
  throttleMs: z.number().int().min(200).max(60_000).optional(),
  useDistributedQueue: z.boolean().optional(),
  revenuePerConversion: z.number().min(0).optional().nullable(),
});

const audiencePreviewSchema = z.object({
  tagIds: z.array(z.string().uuid()).default([]),
  segmentRules: z.record(z.unknown()).optional(),
});

const approvalSchema = z.object({
  approve: z.boolean(),
  rejectionReason: z.string().max(2000).optional(),
});

async function broadcastGate(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  await requireAdmin(request, reply);
  if (reply.sent) return false;
  const organizationId = await resolveTenantOrganizationId(request, reply);
  if (!organizationId) return false;
  const enabled = await isOrganizationFeatureEnabled(organizationId, "broadcast_campaigns");
  if (!enabled) {
    reply.status(403).send({
      error: "Forbidden",
      message: "Broadcast campaigns are disabled for this organization",
      statusCode: 403,
    });
    return false;
  }
  return true;
}

function campaignInclude() {
  return {
    tags: { include: { tag: true } },
    createdBy: { select: { id: true, name: true, displayName: true } },
    approvedBy: { select: { id: true, name: true, displayName: true } },
    inbox: { select: { id: true, name: true, channelType: true } },
    integrationTool: { select: { id: true, name: true, toolType: true } },
    _count: { select: { recipients: true } },
  } as const;
}

export async function broadcastRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    const ok = await broadcastGate(request, reply);
    if (!ok) return;
  });

  app.get("/meta", async () => ({
    channels: channelEnum.options,
    scheduleTypes: scheduleEnum.options,
    eventTriggers: BROADCAST_EVENT_TRIGGERS,
  }));

  app.post("/audience-preview", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = audiencePreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    try {
      const audienceCount = await countBroadcastAudienceAdvanced(
        organizationId,
        parsed.data.tagIds,
        parseSegmentRules(parsed.data.segmentRules),
      );
      return { audienceCount };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bad request";
      return reply.status(400).send({ error: "Bad Request", message: msg, statusCode: 400 });
    }
  });

  app.get("/dashboard", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    await syncBroadcastEngagementForOrg(organizationId);
    return buildBroadcastDashboard(organizationId);
  });

  app.get("/integration-tools", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.automationCustomTool.findMany({
      where: { organizationId, isActive: true, toolType: { in: ["HTTP_API", "WEBHOOK", "MCP"] } },
      select: { id: true, name: true, toolType: true, description: true },
      orderBy: { name: "asc" },
    });
  });

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    return prisma.broadcastCampaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: campaignInclude(),
    });
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply.status(400).send({
        error: "Bad Request",
        message: first?.message ?? parsed.error.message,
        statusCode: 400,
      });
    }

    const d = parsed.data;

    if (d.templateId) {
      const tpl = await prisma.messageTemplate.findFirst({
        where: { id: d.templateId, organizationId },
      });
      if (!tpl) {
        return reply.status(400).send({ error: "Bad Request", message: "Template not found", statusCode: 400 });
      }
      if (d.messageType === "TEMPLATE" && tpl.bodyVariableCount > 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Campaigns only support templates without body variables",
          statusCode: 400,
        });
      }
    }

    const segmentRules = parseSegmentRules(d.segmentRules);
    const audienceCount = await countBroadcastAudienceAdvanced(organizationId, d.tagIds, segmentRules);

    const requiresApproval = d.requiresApproval === true;
    const approvalStatus = requiresApproval ? "PENDING" : "NONE";

    const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
    const nextRunAt =
      d.scheduleType === "SCHEDULED" && scheduledAt
        ? scheduledAt
        : d.scheduleType === "RECURRING"
          ? scheduledAt ?? new Date(Date.now() + 60_000)
          : null;

    const campaign = await prisma.broadcastCampaign.create({
      data: {
        name: d.name,
        channel: d.channel,
        inboxId: d.inboxId,
        messageType: d.messageType,
        body: d.messageType === "TEXT" || d.channel === "EMAIL" ? (d.body ?? "").trim() || null : null,
        templateId: d.messageType === "TEMPLATE" ? d.templateId : null,
        subject: d.subject?.trim() || null,
        organizationId,
        createdById: request.user.id,
        segmentRules: (d.segmentRules ?? undefined) as Prisma.InputJsonValue | undefined,
        flowDefinition: (d.flowDefinition ?? undefined) as Prisma.InputJsonValue | undefined,
        abConfig: (d.abConfig ?? undefined) as Prisma.InputJsonValue | undefined,
        scheduleType: d.scheduleType,
        scheduledAt,
        cronExpression: d.cronExpression,
        nextRunAt,
        eventTrigger: d.eventTrigger,
        eventConfig: (d.eventConfig ?? undefined) as Prisma.InputJsonValue | undefined,
        requiresApproval,
        approvalStatus,
        integrationToolId: d.integrationToolId,
        throttleMs: d.throttleMs ?? 750,
        useDistributedQueue: d.useDistributedQueue ?? true,
        revenuePerConversion: d.revenuePerConversion,
        tags: { create: d.tagIds.map((tagId) => ({ tagId })) },
      },
      include: campaignInclude(),
    });

    return reply.status(201).send({ ...campaign, audienceCount });
  });

  app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const existing = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
    }
    if (existing.status !== "DRAFT") {
      return reply.status(409).send({ error: "Conflict", message: "Only draft campaigns can be edited", statusCode: 409 });
    }

    const parsed = patchCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const d = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      if (d.tagIds) {
        await tx.broadcastCampaignTag.deleteMany({ where: { campaignId: existing.id } });
        if (d.tagIds.length) {
          await tx.broadcastCampaignTag.createMany({
            data: d.tagIds.map((tagId: string) => ({ campaignId: existing.id, tagId })),
          });
        }
      }

      return tx.broadcastCampaign.update({
        where: { id: existing.id },
        data: {
          ...(d.name != null ? { name: d.name } : {}),
          ...(d.channel != null ? { channel: d.channel } : {}),
          ...(d.inboxId !== undefined ? { inboxId: d.inboxId } : {}),
          ...(d.messageType != null ? { messageType: d.messageType } : {}),
          ...(d.body !== undefined ? { body: d.body } : {}),
          ...(d.templateId !== undefined ? { templateId: d.templateId } : {}),
          ...(d.subject !== undefined ? { subject: d.subject } : {}),
          ...(d.segmentRules !== undefined
            ? { segmentRules: d.segmentRules as Prisma.InputJsonValue }
            : {}),
          ...(d.flowDefinition !== undefined
            ? { flowDefinition: d.flowDefinition as Prisma.InputJsonValue }
            : {}),
          ...(d.abConfig !== undefined ? { abConfig: d.abConfig as Prisma.InputJsonValue } : {}),
          ...(d.scheduleType != null ? { scheduleType: d.scheduleType } : {}),
          ...(d.scheduledAt !== undefined
            ? { scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : null }
            : {}),
          ...(d.cronExpression !== undefined ? { cronExpression: d.cronExpression } : {}),
          ...(d.eventTrigger !== undefined ? { eventTrigger: d.eventTrigger } : {}),
          ...(d.eventConfig !== undefined ? { eventConfig: d.eventConfig as Prisma.InputJsonValue } : {}),
          ...(d.requiresApproval != null
            ? {
                requiresApproval: d.requiresApproval,
                approvalStatus: d.requiresApproval ? "PENDING" : "NONE",
              }
            : {}),
          ...(d.integrationToolId !== undefined ? { integrationToolId: d.integrationToolId } : {}),
          ...(d.throttleMs != null ? { throttleMs: d.throttleMs } : {}),
          ...(d.useDistributedQueue != null ? { useDistributedQueue: d.useDistributedQueue } : {}),
          ...(d.revenuePerConversion != null ? { revenuePerConversion: d.revenuePerConversion } : {}),
        },
        include: campaignInclude(),
      });
    });

    return updated;
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const campaign = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId },
      include: campaignInclude(),
    });

    if (!campaign) {
      return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
    }

    let audienceCount: number | null = null;
    if (campaign.status === "DRAFT" && campaign._count.recipients === 0) {
      audienceCount = await countBroadcastAudienceAdvanced(
        organizationId,
        campaign.tags.map((x) => x.tagId),
        parseSegmentRules(campaign.segmentRules),
      );
    }

    return { ...campaign, audienceCount };
  });

  app.get<{ Params: { id: string } }>("/:id/recipients", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const campaign = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!campaign) {
      return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
    }

    return prisma.broadcastCampaignRecipient.findMany({
      where: { campaignId: campaign.id },
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const existing = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId },
      select: { status: true },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
    }
    if (existing.status !== "DRAFT") {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only draft campaigns can be deleted",
        statusCode: 409,
      });
    }

    await prisma.broadcastCampaign.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/approve", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = approvalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const campaign = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!campaign) {
      return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
    }
    if (!campaign.requiresApproval) {
      return reply.status(400).send({ error: "Bad Request", message: "Campaign does not require approval", statusCode: 400 });
    }

    if (parsed.data.approve) {
      const updated = await prisma.broadcastCampaign.update({
        where: { id: campaign.id },
        data: {
          approvalStatus: "APPROVED",
          approvedById: request.user.id,
          approvedAt: new Date(),
          rejectionReason: null,
        },
        include: campaignInclude(),
      });
      return updated;
    }

    const updated = await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: {
        approvalStatus: "REJECTED",
        rejectionReason: parsed.data.rejectionReason?.trim() || "Rejected",
        approvedById: request.user.id,
        approvedAt: new Date(),
      },
      include: campaignInclude(),
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/:id/cancel", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const campaign = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId, status: "RUNNING" },
    });
    if (!campaign) {
      return reply.status(404).send({ error: "Not Found", message: "Running campaign not found", statusCode: 404 });
    }

    const updated = await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: { status: "CANCELLED", completedAt: new Date() },
      include: campaignInclude(),
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/:id/start", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    try {
      const started = await materializeAndStartCampaign(app, organizationId, request.params.id);
      return reply.status(202).send(started);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "not_found") {
        return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
      }
      if (code === "invalid_status") {
        return reply.status(409).send({ error: "Conflict", message: "Campaign already started", statusCode: 409 });
      }
      if (code === "approval_required") {
        return reply.status(403).send({ error: "Forbidden", message: "Campaign pending approval", statusCode: 403 });
      }
      if (code === "no_recipients") {
        return reply.status(400).send({ error: "Bad Request", message: "No contacts in segment", statusCode: 400 });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/:id/sync-metrics", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const campaign = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!campaign) {
      return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
    }

    await syncBroadcastCampaignEngagement(campaign.id);
    return prisma.broadcastCampaign.findFirst({
      where: { id: campaign.id },
      include: campaignInclude(),
    });
  });
}

async function syncBroadcastEngagementForOrg(organizationId: string): Promise<void> {
  const recent = await prisma.broadcastCampaign.findMany({
    where: {
      organizationId,
      status: { in: ["RUNNING", "COMPLETED"] },
      startedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
    take: 15,
  });
  for (const c of recent) {
    await syncBroadcastCampaignEngagement(c.id);
  }
}
