import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../../db.js";
import {
  loadAutomationConversationContext,
  mergePendingContinuationAutomationContext,
  parseAutomationContextState,
  clearPendingContinuationAutomationContext,
} from "../../automationConversationContextLib.js";
import {
  activeAgentContinuationRules,
  parseAgentContinuationConfig,
} from "./parseContinuationConfig.js";
import { matchAgentContinuationRules } from "./evaluateContinuationRules.js";
import type { ContinuationTurnContext } from "./types.js";
import {
  enqueueAgentContinuationJob,
  isAgentEngineQueueAvailable,
} from "../queue/agentEngineQueue.js";
import { processDuePendingContinuation } from "./dispatchProactiveContinuation.js";

export async function maybeScheduleAgentContinuation(input: {
  organizationId: string;
  botId: string;
  conversationId: string;
  contactId: string;
  executionId: string;
  behaviorConfig: unknown;
  turnCtx: ContinuationTurnContext;
  log: FastifyBaseLogger;
}): Promise<{ scheduled: boolean; ruleIds: string[] }> {
  const config = parseAgentContinuationConfig(
    input.behaviorConfig && typeof input.behaviorConfig === "object"
      ? (input.behaviorConfig as Record<string, unknown>).agentContinuation
      : null,
  );
  const rules = activeAgentContinuationRules(config);
  if (rules.length === 0) return { scheduled: false, ruleIds: [] };

  const ctxRow = await loadAutomationConversationContext(input.conversationId);
  const matched = matchAgentContinuationRules({
    rules,
    trigger: "after_reply",
    ctx: input.turnCtx,
    continuationCounts: ctxRow.state.continuationCounts ?? {},
    pendingRuleId: ctxRow.state.pendingContinuation?.ruleId,
  });
  if (matched.length === 0) return { scheduled: false, ruleIds: [] };

  const rule = matched[0]!;
  const delayMs = Math.max(0, (rule.delaySeconds ?? 3) * 1000);
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  await mergePendingContinuationAutomationContext({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    botId: input.botId,
    pending: {
      ruleId: rule.id,
      ruleName: rule.name,
      scheduledAt,
      turnHint: rule.turnHint,
      sourceExecutionId: input.executionId,
      attempts: 0,
    },
  });

  if (isAgentEngineQueueAvailable()) {
    const enqueued = await enqueueAgentContinuationJob(
      {
        organizationId: input.organizationId,
        botId: input.botId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        executionId: `continuation:${input.conversationId}:${rule.id}`,
        continuationRuleId: rule.id,
        continuationTurnHint: rule.turnHint,
        continuationRuleName: rule.name,
        sourceExecutionId: input.executionId,
      },
      3,
      delayMs,
    );
    if (enqueued) {
      input.log.info(
        { ruleId: rule.id, delayMs, conversationId: input.conversationId },
        "agent continuation scheduled via BullMQ",
      );
      return { scheduled: true, ruleIds: [rule.id] };
    }
  }

  input.log.info(
    { ruleId: rule.id, delayMs, conversationId: input.conversationId },
    "agent continuation scheduled via context scheduler",
  );
  return { scheduled: true, ruleIds: [rule.id] };
}

export async function runAgentContinuationSchedulerTick(input: {
  log: FastifyBaseLogger;
}): Promise<void> {
  // Fallback sempre activo: se o job BullMQ não for consumido,
  // o claim atómico no dispatch impede execução duplicada.

  const now = Date.now();
  const rows = await prisma.automationConversationContext.findMany({
    take: 80,
    orderBy: { updatedAt: "desc" },
    include: {
      conversation: {
        select: {
          id: true,
          contactId: true,
          status: true,
          assignedToId: true,
          awaitingHumanHandoff: true,
        },
      },
    },
  });

  for (const row of rows) {
    const state = parseAutomationContextState(row.state);
    const pending = state.pendingContinuation;
    if (!pending?.ruleId || !pending.turnHint || !pending.scheduledAt) continue;
    if (new Date(pending.scheduledAt).getTime() > now) continue;

    const conv = row.conversation;
    if (!conv?.contactId) continue;
    if (conv.awaitingHumanHandoff || conv.status !== "PENDING" || conv.assignedToId != null) {
      await clearPendingContinuationAutomationContext({
        organizationId: row.organizationId,
        conversationId: row.conversationId,
        botId: row.botId,
      });
      continue;
    }

    await processDuePendingContinuation({
      organizationId: row.organizationId,
      botId: row.botId,
      conversationId: row.conversationId,
      contactId: conv.contactId,
      pending,
      log: input.log,
    });
  }
}
