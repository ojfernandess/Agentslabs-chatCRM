import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../../db.js";
import { startAutomationExecution } from "../../automationExecutionLog.js";
import { runNativeAgentReplyAndDeliver } from "../../agentBotNativeReplyPipeline.js";
import { parseAgentEngineConfig } from "../config/parseAgentEngineConfig.js";
import type { AgentEngineQueueJobData } from "../queue/agentEngineQueue.js";
import {
  enqueueAgentEngineReplyJob,
  isAgentEngineQueueAvailable,
  resolveAgentEngineQueuePriority,
} from "../queue/agentEngineQueue.js";
import { buildContinuationSyntheticBody } from "./constants.js";
import type { PendingAgentContinuation } from "./types.js";
import {
  clearPendingContinuationAutomationContext,
  loadAutomationConversationContext,
  tryClaimPendingContinuationAutomationContext,
} from "../../automationConversationContextLib.js";

async function runContinuationTurn(input: {
  organizationId: string;
  bot: NonNullable<Awaited<ReturnType<typeof prisma.bot.findFirst>>>;
  conversation: NonNullable<Awaited<ReturnType<typeof prisma.conversation.findFirst>>>;
  contact: NonNullable<Awaited<ReturnType<typeof prisma.contact.findFirst>>>;
  pending: PendingAgentContinuation;
  log: FastifyBaseLogger;
  existingExecutionId?: string;
}): Promise<void> {
  const { organizationId, bot, conversation, contact, pending, log, existingExecutionId } = input;

  const syntheticBody = buildContinuationSyntheticBody(pending.ruleId, pending.turnHint);
  const syntheticMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      type: "TEXT",
      body: syntheticBody,
      status: "SENT",
    },
  });

  const exLog = existingExecutionId
    ? await import("../../automationExecutionLog.js").then(({ attachAutomationExecutionLog }) =>
        attachAutomationExecutionLog({
          executionId: existingExecutionId,
          organizationId,
          log,
        }),
      )
    : await startAutomationExecution({
        organizationId,
        botId: bot.id,
        conversationId: conversation.id,
        triggerMessageId: syntheticMessage.id,
        workflowKey: "proactive_continuation",
        workflowName: pending.ruleName?.slice(0, 200) || `Continuação: ${pending.ruleId}`,
        log,
      });

  if (!exLog) {
    throw new Error("continuation_execution_log_missing");
  }

  exLog.info(
    { id: "continuation", name: "Turno proactivo" },
    "Continuação proactiva iniciada — turno sem mensagem do hóspede",
    {
      input: {
        ruleId: pending.ruleId,
        sourceExecutionId: pending.sourceExecutionId,
        scheduledAt: pending.scheduledAt,
      },
    },
  );

  const profile = await prisma.automationAgentProfile.findUnique({
    where: { botId: bot.id },
    select: { behaviorConfig: true },
  });
  const engineConfig = parseAgentEngineConfig(profile?.behaviorConfig);

  if (engineConfig.executionQueueEnabled && isAgentEngineQueueAvailable() && !existingExecutionId) {
    const enqueued = await enqueueAgentEngineReplyJob(
      {
        organizationId,
        botId: bot.id,
        conversationId: conversation.id,
        messageId: syntheticMessage.id,
        contactId: contact.id,
        executionId: exLog.getExecutionId(),
      },
      resolveAgentEngineQueuePriority(conversation.priority),
    );
    if (enqueued) {
      return;
    }
  }

  await runNativeAgentReplyAndDeliver({
    organizationId,
    bot,
    conversation,
    contact,
    message: syntheticMessage,
    log,
    exLog,
    skipContinuationSchedule: true,
  });
}

export async function dispatchProactiveAgentContinuation(input: {
  organizationId: string;
  botId: string;
  conversationId: string;
  contactId: string;
  pending: PendingAgentContinuation;
  log: FastifyBaseLogger;
  /** Máximo de disparos por conversa (default 1). */
  maxPerConversation?: number;
  /** Origem BullMQ — dedup mesmo sem pending no contexto. */
  forceFromQueue?: boolean;
}): Promise<void> {
  const {
    organizationId,
    botId,
    conversationId,
    contactId,
    pending,
    log,
    maxPerConversation,
    forceFromQueue,
  } = input;

  const claimed = await tryClaimPendingContinuationAutomationContext({
    organizationId,
    conversationId,
    botId,
    ruleId: pending.ruleId,
    maxPerConversation,
    forceFromQueue,
  });
  if (!claimed) {
    log.debug(
      { conversationId, ruleId: pending.ruleId },
      "continuation already claimed or not due — skipping dispatch",
    );
    return;
  }

  const effectivePending: PendingAgentContinuation = {
    ...claimed,
    turnHint: pending.turnHint || claimed.turnHint,
    ruleName: pending.ruleName ?? claimed.ruleName,
    sourceExecutionId: pending.sourceExecutionId ?? claimed.sourceExecutionId,
  };

  const [bot, conversation, contact] = await Promise.all([
    prisma.bot.findFirst({ where: { id: botId, organizationId } }),
    prisma.conversation.findFirst({ where: { id: conversationId, organizationId } }),
    prisma.contact.findFirst({ where: { id: contactId, organizationId } }),
  ]);

  if (!bot?.isActive || !conversation || !contact) {
    await clearPendingContinuationAutomationContext({ organizationId, conversationId, botId });
    return;
  }
  if (conversation.awaitingHumanHandoff) {
    await clearPendingContinuationAutomationContext({ organizationId, conversationId, botId });
    return;
  }
  if (conversation.status !== "PENDING" || conversation.assignedToId != null) {
    await clearPendingContinuationAutomationContext({ organizationId, conversationId, botId });
    return;
  }

  await runContinuationTurn({
    organizationId,
    bot,
    conversation,
    contact,
    pending: effectivePending,
    log,
  });
}

export async function runProactiveContinuationFromQueue(
  data: AgentEngineQueueJobData,
  log: FastifyBaseLogger,
): Promise<void> {
  const ruleId = data.continuationRuleId;
  const turnHint = data.continuationTurnHint;
  if (!ruleId || !turnHint) {
    const ctx = await loadAutomationConversationContext(data.conversationId);
    const pending = ctx.state.pendingContinuation;
    if (!pending) {
      log.warn({ conversationId: data.conversationId }, "continuation job without pending state");
      return;
    }
    await dispatchProactiveAgentContinuation({
      organizationId: data.organizationId,
      botId: data.botId,
      conversationId: data.conversationId,
      contactId: data.contactId,
      pending,
      log,
    });
    return;
  }

  await dispatchProactiveAgentContinuation({
    organizationId: data.organizationId,
    botId: data.botId,
    conversationId: data.conversationId,
    contactId: data.contactId,
    pending: {
      ruleId,
      ruleName: data.continuationRuleName,
      scheduledAt: new Date(0).toISOString(),
      turnHint,
      sourceExecutionId: data.sourceExecutionId,
      attempts: 0,
    },
    log,
    forceFromQueue: true,
  });
}

export async function processDuePendingContinuation(input: {
  organizationId: string;
  botId: string;
  conversationId: string;
  contactId: string;
  pending: PendingAgentContinuation;
  log: FastifyBaseLogger;
}): Promise<void> {
  await dispatchProactiveAgentContinuation(input);
}
