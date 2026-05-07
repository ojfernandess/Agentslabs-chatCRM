import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  assertTagsBelongToOrganization,
  countBroadcastAudience,
  listBroadcastAudienceContactIds,
} from "../lib/broadcastAudience.js";
import { scheduleBroadcastCampaignRun } from "../lib/broadcastRunner.js";

const createCampaignSchema = z
  .object({
    name: z.string().min(1).max(200),
    messageType: z.enum(["TEXT", "TEMPLATE"]),
    body: z.string().max(4096).optional(),
    templateId: z.string().uuid().optional(),
    tagIds: z.array(z.string().uuid()).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.messageType === "TEXT") {
      if (!data.body?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["body"],
          message: "body is required for TEXT campaigns",
        });
      }
    } else if (!data.templateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["templateId"],
        message: "templateId is required for TEMPLATE campaigns",
      });
    }
  });

const audiencePreviewSchema = z.object({
  tagIds: z.array(z.string().uuid()).min(1),
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

export async function broadcastRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    const ok = await broadcastGate(request, reply);
    if (!ok) return;
  });

  app.post("/audience-preview", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = audiencePreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply.status(400).send({
        error: "Bad Request",
        message: first?.message ?? parsed.error.message,
        statusCode: 400,
      });
    }

    try {
      await assertTagsBelongToOrganization(organizationId, parsed.data.tagIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bad request";
      return reply.status(400).send({ error: "Bad Request", message: msg, statusCode: 400 });
    }

    const audienceCount = await countBroadcastAudience(organizationId, parsed.data.tagIds);
    return { audienceCount };
  });

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    return prisma.broadcastCampaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        tags: { include: { tag: true } },
        _count: { select: { recipients: true } },
      },
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

    const { name, messageType, body, templateId, tagIds } = parsed.data;

    try {
      await assertTagsBelongToOrganization(organizationId, tagIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bad request";
      return reply.status(400).send({ error: "Bad Request", message: msg, statusCode: 400 });
    }

    if (templateId) {
      const tpl = await prisma.messageTemplate.findFirst({
        where: { id: templateId, organizationId },
      });
      if (!tpl) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Template not found",
          statusCode: 400,
        });
      }
    }

    const audienceCount = await countBroadcastAudience(organizationId, tagIds);

    const campaign = await prisma.broadcastCampaign.create({
      data: {
        name,
        messageType,
        body: messageType === "TEXT" ? (body ?? "").trim() : null,
        templateId: messageType === "TEMPLATE" ? templateId : null,
        organizationId,
        createdById: request.user.id,
        tags: { create: tagIds.map((x) => ({ tagId: x })) },
      },
      include: {
        tags: { include: { tag: true } },
      },
    });

    return reply.status(201).send({ ...campaign, audienceCount });
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const campaign = await prisma.broadcastCampaign.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        tags: { include: { tag: true } },
        _count: { select: { recipients: true } },
      },
    });

    if (!campaign) {
      return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
    }

    let audienceCount: number | null = null;
    if (campaign.status === "DRAFT" && campaign._count.recipients === 0) {
      audienceCount = await countBroadcastAudience(
        organizationId,
        campaign.tags.map((x) => x.tagId),
      );
    }

    return { ...campaign, audienceCount };
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

  app.post<{ Params: { id: string } }>("/:id/start", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const campaignId = request.params.id;

    let started:
      | Awaited<ReturnType<typeof prisma.broadcastCampaign.update>>
      | undefined;

    try {
      await prisma.$transaction(async (tx) => {
        const campaign = await tx.broadcastCampaign.findFirst({
          where: { id: campaignId, organizationId },
          include: { tags: true },
        });
        if (!campaign) {
          throw new Error("not_found");
        }
        if (campaign.status !== "DRAFT") {
          throw new Error("invalid_status");
        }

        const tagIds = campaign.tags.map((t) => t.tagId);
        const contactIds = await listBroadcastAudienceContactIds(organizationId, tagIds);
        if (contactIds.length === 0) {
          throw new Error("no_recipients");
        }

        await tx.broadcastCampaignRecipient.createMany({
          data: contactIds.map((contactId) => ({ campaignId, contactId })),
        });

        started = await tx.broadcastCampaign.update({
          where: { id: campaignId },
          data: {
            status: "RUNNING",
            totalRecipients: contactIds.length,
            sentCount: 0,
            failedCount: 0,
            startedAt: new Date(),
            lastError: null,
          },
        });
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "not_found") {
        return reply.status(404).send({ error: "Not Found", message: "Campaign not found", statusCode: 404 });
      }
      if (code === "invalid_status") {
        return reply.status(409).send({
          error: "Conflict",
          message: "Campaign has already been started or finished",
          statusCode: 409,
        });
      }
      if (code === "no_recipients") {
        return reply.status(400).send({
          error: "Bad Request",
          message: "No contacts match the selected tags",
          statusCode: 400,
        });
      }
      throw err;
    }

    if (started) scheduleBroadcastCampaignRun(app, campaignId);
    return reply.status(202).send(started);
  });
}
