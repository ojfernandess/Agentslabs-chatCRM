import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { assignTagsToConversationContact } from "../lib/assignContactTags.js";
import { getAssistOpenAiCredentialsForOrganization } from "../lib/agentAssistLlm.js";
import {
  loadIntelligentTaggingConfig,
  runIntelligentTagging,
} from "../lib/intelligent-tagging/service.js";
import { parseIntelligentTaggingTrigger } from "../lib/intelligent-tagging/types.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { storeTaggingFeedbackInMem0 } from "../lib/intelligent-tagging/mem0Feedback.js";

const reviewBodySchema = z.object({
  note: z.string().max(500).optional(),
});

export async function intelligentTaggingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/config", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const [config, openAiConfigured, settings, featureFlagEnabled] = await Promise.all([
      loadIntelligentTaggingConfig(organizationId),
      getAssistOpenAiCredentialsForOrganization(organizationId),
      prisma.settings.findUnique({
        where: { organizationId },
        select: {
          intelligentTaggingEnabled: true,
          intelligentTaggingMinConfidence: true,
          intelligentTaggingMaxTags: true,
          intelligentTaggingTrigger: true,
        },
      }),
      isOrganizationFeatureEnabled(organizationId, "intelligent_tagging"),
    ]);

    return {
      enabled: config.enabled,
      organizationEnabled: settings?.intelligentTaggingEnabled ?? false,
      featureFlagEnabled,
      minConfidence: settings?.intelligentTaggingMinConfidence ?? config.minConfidence,
      maxTags: settings?.intelligentTaggingMaxTags ?? config.maxTags,
      trigger: parseIntelligentTaggingTrigger(settings?.intelligentTaggingTrigger),
      openAiConfigured: Boolean(openAiConfigured),
    };
  });

  app.post<{ Params: { id: string } }>(
    "/conversations/:id/classify",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const config = await loadIntelligentTaggingConfig(organizationId);
      if (!config.enabled) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "Intelligent tagging is disabled for this organization",
          code: "intelligent_tagging_disabled",
          statusCode: 403,
        });
      }

      const creds = await getAssistOpenAiCredentialsForOrganization(organizationId);
      if (!creds) {
        return reply.status(503).send({
          error: "Service Unavailable",
          message: "OpenAI credentials required for intelligent tagging",
          code: "missing_openai_key",
          statusCode: 503,
        });
      }

      const exists = await prisma.conversation.findFirst({
        where: { id: request.params.id, organizationId },
        select: { id: true },
      });
      if (!exists) {
        return reply.status(404).send({ error: "Not Found", message: "Conversation not found", statusCode: 404 });
      }

      const lang = (request.headers["accept-language"]?.split(",")[0]?.split("-")[0] || "pt") as string;
      const result = await runIntelligentTagging({
        organizationId,
        conversationId: request.params.id,
        trigger: "manual",
        initiatedByUserId: request.user.id,
        language: lang,
      });

      if (!result.ok) {
        if (result.skipped) {
          return reply.status(403).send({
            error: "Forbidden",
            message: result.error,
            statusCode: 403,
          });
        }
        return reply.status(400).send({
          error: "Bad Request",
          message: result.error,
          statusCode: 400,
        });
      }

      return {
        runId: result.runId,
        autoAppliedTagIds: result.autoAppliedTagIds,
        pendingReviewCount: result.pendingReviewCount,
        pipelineError: result.error ?? null,
      };
    },
  );

  app.get("/suggestions", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = z
      .object({
        status: z.enum(["PENDING", "APPROVED", "REJECTED", "AUTO_APPLIED"]).optional(),
        conversationId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({ error: "Bad Request", message: query.error.message, statusCode: 400 });
    }

    const rows = await prisma.intelligentTagSuggestion.findMany({
      where: {
        organizationId,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.conversationId ? { conversationId: query.data.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.data.limit,
      include: {
        tag: { select: { id: true, name: true, color: true } },
        conversation: { select: { id: true, contact: { select: { name: true } } } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      contactName: row.conversation.contact.name,
      tagId: row.tagId,
      tagName: row.tagName,
      tag: row.tag,
      suggestedNewTag: row.suggestedNewTag,
      confidence: row.confidence,
      rationale: row.rationale,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    }));
  });

  async function reviewSuggestion(
    request: { params: { id: string }; user: { id: string }; body: unknown },
    reply: import("fastify").FastifyReply,
    approved: boolean,
  ) {
    const organizationId = await resolveTenantOrganizationId(request as never, reply);
    if (!organizationId) return;

    const parsed = reviewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const suggestion = await prisma.intelligentTagSuggestion.findFirst({
      where: { id: request.params.id, organizationId, status: "PENDING" },
      include: {
        conversation: { select: { contactId: true } },
      },
    });
    if (!suggestion) {
      return reply.status(404).send({ error: "Not Found", message: "Suggestion not found", statusCode: 404 });
    }

    let appliedTagId: string | null = null;
    if (approved && suggestion.tagId) {
      const applied = await assignTagsToConversationContact(prisma, {
        organizationId,
        conversationId: suggestion.conversationId,
        tagIds: [suggestion.tagId],
        mode: "add",
      });
      if (applied.ok) appliedTagId = suggestion.tagId;
    }

    const updated = await prisma.intelligentTagSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: approved ? "APPROVED" : "REJECTED",
        reviewedById: request.user.id,
        reviewedAt: new Date(),
      },
    });

    await storeTaggingFeedbackInMem0({
      organizationId,
      contactId: suggestion.conversation.contactId,
      summary: `${suggestion.tagName} (${suggestion.confidence.toFixed(2)}) — ${approved ? "aprovada" : "rejeitada"}${parsed.data.note ? `: ${parsed.data.note}` : ""}`,
      approved,
    });

    return {
      id: updated.id,
      status: updated.status,
      appliedTagId,
    };
  }

  app.post<{ Params: { id: string } }>("/suggestions/:id/approve", async (request, reply) => {
    return reviewSuggestion(request, reply, true);
  });

  app.post<{ Params: { id: string } }>("/suggestions/:id/reject", async (request, reply) => {
    return reviewSuggestion(request, reply, false);
  });

  app.get("/metrics", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = z
      .object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      })
      .safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({ error: "Bad Request", message: query.error.message, statusCode: 400 });
    }

    const from = query.data.from ? new Date(query.data.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.data.to ? new Date(query.data.to) : new Date();

    const [runs, reviewStats] = await Promise.all([
      prisma.intelligentTaggingRun.findMany({
        where: { organizationId, createdAt: { gte: from, lte: to } },
        select: {
          latencyMs: true,
          autoAppliedCount: true,
          pendingReviewCount: true,
          metadata: true,
        },
      }),
      prisma.intelligentTagSuggestion.groupBy({
        by: ["status"],
        where: {
          organizationId,
          createdAt: { gte: from, lte: to },
          status: { in: ["APPROVED", "REJECTED", "PENDING"] },
        },
        _count: { _all: true },
      }),
    ]);

    const totalRuns = runs.length;
    const autoAppliedTotal = runs.reduce((s, r) => s + r.autoAppliedCount, 0);
    const pendingReviewTotal = runs.reduce((s, r) => s + r.pendingReviewCount, 0);
    const errorRuns = runs.filter((r) => {
      const meta = r.metadata as { error?: string | null } | null;
      return Boolean(meta?.error);
    }).length;
    const latencies = runs.map((r) => r.latencyMs).filter((n): n is number => n != null);
    const avgLatencyMs =
      latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

    const approved = reviewStats.find((s) => s.status === "APPROVED")?._count._all ?? 0;
    const rejected = reviewStats.find((s) => s.status === "REJECTED")?._count._all ?? 0;
    const pending = reviewStats.find((s) => s.status === "PENDING")?._count._all ?? 0;
    const reviewed = approved + rejected;
    const humanApprovalRate = reviewed > 0 ? approved / reviewed : null;

    const autoApplyRate = totalRuns > 0 ? autoAppliedTotal / Math.max(autoAppliedTotal + pendingReviewTotal, 1) : null;

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      totalRuns,
      autoAppliedTotal,
      pendingReviewTotal,
      errorRuns,
      avgLatencyMs,
      humanApprovalRate,
      autoApplyRate,
      pendingSuggestions: pending,
      approvedSuggestions: approved,
      rejectedSuggestions: rejected,
    };
  });
}
