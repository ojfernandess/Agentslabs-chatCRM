import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { parseAgentEngineConfig, validateAgentPrompt, isMem0Configured } from "../lib/agent-engine/index.js";
import { buildExecutionInspectorView } from "../lib/agent-engine/observability/buildExecutionInspector.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

const promptValidateSchema = z.object({
  userCore: z.string().optional(),
  blocks: z.record(z.string()).optional(),
  connectedToolCount: z.number().int().min(0).optional(),
  hasMemoryConfig: z.boolean().optional(),
  hasFallbacks: z.boolean().optional(),
});

export async function registerAgentEngineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/agent-profiles/:botId/validate-prompt", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { botId } = request.params as { botId: string };
    const body = promptValidateSchema.parse(request.body ?? {});

    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId, organizationId },
      select: { behaviorConfig: true },
    });
    if (!profile) {
      return reply.status(404).send({ error: "Not Found", message: "Agent profile not found", statusCode: 404 });
    }

    const beh =
      profile.behaviorConfig && typeof profile.behaviorConfig === "object"
        ? (profile.behaviorConfig as Record<string, unknown>)
        : {};
    const pb =
      beh.promptBuilder && typeof beh.promptBuilder === "object"
        ? (beh.promptBuilder as Record<string, unknown>)
        : {};

    const result = validateAgentPrompt({
      userCore: body.userCore ?? (typeof pb.userCore === "string" ? pb.userCore : ""),
      blocks: (body.blocks ?? pb.blocks) as Record<string, string | undefined> | undefined,
      connectedToolCount:
        body.connectedToolCount ??
        (Array.isArray(beh.connectedTools)
          ? beh.connectedTools.filter(
              (x) => x && typeof x === "object" && (x as Record<string, unknown>).enabled,
            ).length
          : 0),
      hasMemoryConfig: body.hasMemoryConfig ?? parseAgentEngineConfig(beh).memory !== "openconduit",
      hasFallbacks:
        body.hasFallbacks ??
        (Array.isArray(pb.instructionFallbacks) && pb.instructionFallbacks.length > 0),
    });

    return { data: result };
  });

  app.get("/execution-logs/:id/inspector", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    const { id } = request.params as { id: string };

    const execution = await prisma.automationExecution.findFirst({
      where: { id, organizationId },
      include: {
        logEntries: { orderBy: { sequence: "asc" } },
        bot: { select: { id: true, name: true } },
        conversation: { select: { id: true } },
      },
    });
    if (!execution) {
      return reply.status(404).send({ error: "Not Found", message: "Execution not found", statusCode: 404 });
    }

    let triggerMessageBody: string | null = null;
    if (execution.triggerMessageId) {
      const msg = await prisma.message.findUnique({
        where: { id: execution.triggerMessageId },
        select: { body: true },
      });
      triggerMessageBody = msg?.body ?? null;
    }

    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId: execution.botId },
      select: { behaviorConfig: true, llmConfig: true },
    });
    const engine = parseAgentEngineConfig(profile?.behaviorConfig);
    const llm =
      profile?.llmConfig && typeof profile.llmConfig === "object"
        ? (profile.llmConfig as Record<string, unknown>)
        : {};

    const inspector = buildExecutionInspectorView({
      executionId: execution.id,
      workflowKey: execution.workflowKey,
      status: execution.status,
      botName: execution.bot.name,
      conversationId: execution.conversationId,
      engine,
      model: typeof llm.model === "string" ? llm.model : null,
      provider: typeof llm.provider === "string" ? llm.provider : null,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      triggerMessageBody,
      logEntries: execution.logEntries.map((e) => ({
        nodeId: e.nodeId,
        nodeName: e.nodeName,
        level: e.level,
        message: e.message,
        sequence: e.sequence,
        createdAt: e.createdAt.toISOString(),
        inputContext: e.inputContext,
        outputContext: e.outputContext,
        nodePath: e.nodePath,
      })),
    });

    return { data: inspector };
  });

  app.get("/mem0/status", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!isTenantAdminLike(request.user!)) {
      return reply.status(403).send({ error: "Forbidden", message: "Admin access required", statusCode: 403 });
    }
    return {
      data: {
        configured: isMem0Configured(),
        provider: "mem0",
      },
    };
  });
}
