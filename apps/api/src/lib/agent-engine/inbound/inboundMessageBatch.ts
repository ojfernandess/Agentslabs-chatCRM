/**
 * Agrupa mensagens inbound rápidas do hóspede antes de executar o agente nativo.
 * Toggle: behaviorConfig.agentEngine.inboundMessageBatchEnabled
 */
import type { Bot, Contact, Conversation, Message } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../../db.js";
import { isShortConfirmationOrFlowReply } from "../../knowledgeQueryEnrichment.js";
import type { AgentEngineConfig } from "../types.js";
import {
  DEFAULT_INBOUND_MESSAGE_BATCH_DEBOUNCE_MS,
  DEFAULT_INBOUND_MESSAGE_BATCH_MAX_MESSAGES,
  DEFAULT_INBOUND_MESSAGE_BATCH_MAX_WAIT_MS,
} from "../types.js";

export type ExecuteNativeAgentTurnInput = {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  contact: Contact;
  message: Message;
  log: FastifyBaseLogger;
  userMessageOverride?: string;
  batchedMessageIds?: string[];
};

export type ExecuteNativeAgentTurnFn = (input: ExecuteNativeAgentTurnInput) => Promise<void>;

export type InboundBatchHandleResult =
  | { action: "deferred" }
  | ({ action: "execute" } & ExecuteNativeAgentTurnInput);

type PendingBatch = {
  organizationId: string;
  botId: string;
  contactId: string;
  messageIds: string[];
  firstMessageAt: number;
  debounceTimer: ReturnType<typeof setTimeout>;
  maxWaitTimer: ReturnType<typeof setTimeout>;
  onFlush: ExecuteNativeAgentTurnFn;
  log: FastifyBaseLogger;
};

const pendingBatches = new Map<string, PendingBatch>();

export function mergeInboundMessageBodies(messages: Pick<Message, "body">[]): string {
  return messages
    .map((m) => (m.body ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/** Respostas curtas (sim/não/menu) processam imediatamente — não entram no batch. */
export function shouldFlushInboundMessageImmediately(message: Pick<Message, "body" | "type">): boolean {
  const body = (message.body ?? "").trim();
  if (message.type !== "TEXT") return true;
  if (!body) return true;
  return isShortConfirmationOrFlowReply(body);
}

function resolveBatchTiming(config: AgentEngineConfig): {
  debounceMs: number;
  maxWaitMs: number;
  maxMessages: number;
} {
  return {
    debounceMs:
      typeof config.inboundMessageBatchDebounceMs === "number"
        ? Math.min(10_000, Math.max(500, Math.round(config.inboundMessageBatchDebounceMs)))
        : DEFAULT_INBOUND_MESSAGE_BATCH_DEBOUNCE_MS,
    maxWaitMs:
      typeof config.inboundMessageBatchMaxWaitMs === "number"
        ? Math.min(30_000, Math.max(1000, Math.round(config.inboundMessageBatchMaxWaitMs)))
        : DEFAULT_INBOUND_MESSAGE_BATCH_MAX_WAIT_MS,
    maxMessages:
      typeof config.inboundMessageBatchMaxMessages === "number"
        ? Math.min(20, Math.max(2, Math.round(config.inboundMessageBatchMaxMessages)))
        : DEFAULT_INBOUND_MESSAGE_BATCH_MAX_MESSAGES,
  };
}

function clearBatchTimers(batch: PendingBatch): void {
  clearTimeout(batch.debounceTimer);
  clearTimeout(batch.maxWaitTimer);
}

/** Test helper — limpa estado in-process. */
export function clearAllInboundMessageBatches(): void {
  for (const batch of pendingBatches.values()) {
    clearBatchTimers(batch);
  }
  pendingBatches.clear();
}

export function getPendingInboundBatchMessageCount(conversationId: string): number {
  return pendingBatches.get(conversationId)?.messageIds.length ?? 0;
}

async function buildExecuteInputFromBatch(
  batch: PendingBatch,
  conversationId: string,
  reason: string,
): Promise<ExecuteNativeAgentTurnInput | null> {
  const [bot, conversation, contact, messages] = await Promise.all([
    prisma.bot.findFirst({ where: { id: batch.botId } }),
    prisma.conversation.findFirst({
      where: { id: conversationId, organizationId: batch.organizationId },
    }),
    prisma.contact.findFirst({
      where: { id: batch.contactId, organizationId: batch.organizationId },
    }),
    prisma.message.findMany({
      where: { id: { in: batch.messageIds } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!bot || !conversation || !contact || messages.length === 0) {
    batch.log.warn(
      { conversationId, reason, messageIds: batch.messageIds },
      "inbound message batch flush skipped — missing entities",
    );
    return null;
  }
  if (conversation.awaitingHumanHandoff) {
    batch.log.info({ conversationId, reason }, "inbound message batch discarded — awaiting handoff");
    return null;
  }

  const ordered = batch.messageIds
    .map((id) => messages.find((m) => m.id === id))
    .filter((m): m is Message => Boolean(m));
  const trigger = ordered[ordered.length - 1]!;
  const mergedBody = mergeInboundMessageBodies(ordered);

  batch.log.info(
    {
      conversationId,
      reason,
      batchedCount: ordered.length,
      triggerMessageId: trigger.id,
    },
    "inbound message batch flushed",
  );

  return {
    organizationId: batch.organizationId,
    bot,
    conversation,
    contact,
    message: trigger,
    log: batch.log,
    userMessageOverride: ordered.length > 1 ? mergedBody : undefined,
    batchedMessageIds: ordered.length > 1 ? ordered.map((m) => m.id) : undefined,
  };
}

async function flushPendingBatch(
  conversationId: string,
  reason: string,
  opts?: { returnToCaller?: boolean },
): Promise<InboundBatchHandleResult | null> {
  const batch = pendingBatches.get(conversationId);
  if (!batch) return null;
  pendingBatches.delete(conversationId);
  clearBatchTimers(batch);

  const executeInput = await buildExecuteInputFromBatch(batch, conversationId, reason);
  if (!executeInput) return null;

  if (opts?.returnToCaller) {
    return { action: "execute", ...executeInput };
  }

  void batch.onFlush(executeInput).catch((err) => {
    batch.log.warn({ err, conversationId }, "inbound message batch execute failed");
  });
  return null;
}

function armDebounceTimer(conversationId: string, debounceMs: number): void {
  const batch = pendingBatches.get(conversationId);
  if (!batch) return;
  clearTimeout(batch.debounceTimer);
  batch.debounceTimer = setTimeout(() => {
    void flushPendingBatch(conversationId, "debounce");
  }, debounceMs);
}

/**
 * Enfileira mensagem no batch ou indica execução imediata.
 * Quando `deferred`, o caller não deve executar o agente neste turno.
 */
export async function handleInboundMessageBatch(input: {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  contact: Contact;
  message: Message;
  log: FastifyBaseLogger;
  engineConfig: AgentEngineConfig;
  onFlush: ExecuteNativeAgentTurnFn;
}): Promise<InboundBatchHandleResult> {
  const { organizationId, bot, conversation, contact, message, log, engineConfig, onFlush } = input;
  const { debounceMs, maxWaitMs, maxMessages } = resolveBatchTiming(engineConfig);
  const conversationId = conversation.id;

  if (shouldFlushInboundMessageImmediately(message)) {
    await flushPendingBatch(conversationId, "immediate_preempt");
    return {
      action: "execute",
      organizationId,
      bot,
      conversation,
      contact,
      message,
      log,
    };
  }

  const existing = pendingBatches.get(conversationId);
  if (existing) {
    existing.messageIds.push(message.id);
    armDebounceTimer(conversationId, debounceMs);
    if (existing.messageIds.length >= maxMessages) {
      const flushed = await flushPendingBatch(conversationId, "max_messages", { returnToCaller: true });
      if (flushed?.action === "execute") return flushed;
    }
    return { action: "deferred" };
  }

  const debounceTimer = setTimeout(() => {
    void flushPendingBatch(conversationId, "debounce");
  }, debounceMs);
  const maxWaitTimer = setTimeout(() => {
    void flushPendingBatch(conversationId, "max_wait");
  }, maxWaitMs);

  pendingBatches.set(conversationId, {
    organizationId,
    botId: bot.id,
    contactId: contact.id,
    messageIds: [message.id],
    firstMessageAt: Date.now(),
    debounceTimer,
    maxWaitTimer,
    onFlush,
    log,
  });

  return { action: "deferred" };
}
