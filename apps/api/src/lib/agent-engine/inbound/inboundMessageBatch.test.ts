import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { Bot, Contact, Conversation, Message } from "@prisma/client";
import {
  clearAllInboundMessageBatches,
  getPendingInboundBatchMessageCount,
  handleInboundMessageBatch,
  mergeInboundMessageBodies,
  shouldFlushInboundMessageImmediately,
} from "./inboundMessageBatch.js";

const log = {
  info: () => {},
  warn: () => {},
} as never;

function stubMessage(partial: Partial<Message> & Pick<Message, "id" | "body">): Message {
  return {
    id: partial.id,
    body: partial.body,
    type: partial.type ?? "TEXT",
    conversationId: partial.conversationId ?? "conv-1",
    organizationId: partial.organizationId ?? "org-1",
    direction: "INBOUND",
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
    contactId: partial.contactId ?? "contact-1",
    botId: partial.botId ?? "bot-1",
    status: "RECEIVED",
    externalId: null,
    metadata: null,
    mediaUrl: null,
    mimeType: null,
    isPrivate: false,
    senderUserId: null,
    replyToMessageId: null,
    channelMessageId: null,
  } as Message;
}

const bot = { id: "bot-1" } as Bot;
const conversation = { id: "conv-1", awaitingHumanHandoff: false } as Conversation;
const contact = { id: "contact-1" } as Contact;

afterEach(() => {
  clearAllInboundMessageBatches();
});

test("mergeInboundMessageBodies joins non-empty lines", () => {
  assert.equal(
    mergeInboundMessageBodies([
      { body: "Olá" },
      { body: "  " },
      { body: "Preciso cotação" },
    ]),
    "Olá\nPreciso cotação",
  );
});

test("shouldFlushInboundMessageImmediately for short confirmations and non-text", () => {
  assert.equal(shouldFlushInboundMessageImmediately(stubMessage({ id: "m1", body: "sim" })), true);
  assert.equal(shouldFlushInboundMessageImmediately(stubMessage({ id: "m2", body: "não" })), true);
  assert.equal(
    shouldFlushInboundMessageImmediately(stubMessage({ id: "m3", body: "Preciso cotação" })),
    false,
  );
  assert.equal(
    shouldFlushInboundMessageImmediately(
      stubMessage({ id: "m4", body: "foto", type: "IMAGE" as Message["type"] }),
    ),
    true,
  );
});

test("handleInboundMessageBatch defers and accumulates rapid messages", async () => {
  const onFlush = async () => {};
  const engineConfig = {
    inboundMessageBatchDebounceMs: 2500,
    inboundMessageBatchMaxWaitMs: 8000,
    inboundMessageBatchMaxMessages: 8,
  };

  const first = await handleInboundMessageBatch({
    organizationId: "org-1",
    bot,
    conversation,
    contact,
    message: stubMessage({ id: "m1", body: "Olá, boa tarde" }),
    log,
    engineConfig,
    onFlush,
  });
  assert.equal(first.action, "deferred");
  assert.equal(getPendingInboundBatchMessageCount("conv-1"), 1);

  const second = await handleInboundMessageBatch({
    organizationId: "org-1",
    bot,
    conversation,
    contact,
    message: stubMessage({ id: "m2", body: "Preciso fazer uma cotação" }),
    log,
    engineConfig,
    onFlush,
  });
  assert.equal(second.action, "deferred");
  assert.equal(getPendingInboundBatchMessageCount("conv-1"), 2);
});

test("handleInboundMessageBatch executes immediately for short confirmation", async () => {
  const result = await handleInboundMessageBatch({
    organizationId: "org-1",
    bot,
    conversation,
    contact,
    message: stubMessage({ id: "m-sim", body: "sim" }),
    log,
    engineConfig: {},
    onFlush: async () => {},
  });
  assert.equal(result.action, "execute");
  assert.equal(getPendingInboundBatchMessageCount("conv-1"), 0);
});

test("parseAgentEngineConfig reads inbound message batch fields", async () => {
  const { parseAgentEngineConfig } = await import("../config/parseAgentEngineConfig.js");
  const cfg = parseAgentEngineConfig({
    agentEngine: {
      inboundMessageBatchEnabled: true,
      inboundMessageBatchDebounceMs: 3000,
      inboundMessageBatchMaxWaitMs: 9000,
      inboundMessageBatchMaxMessages: 5,
    },
  });
  assert.equal(cfg.inboundMessageBatchEnabled, true);
  assert.equal(cfg.inboundMessageBatchDebounceMs, 3000);
  assert.equal(cfg.inboundMessageBatchMaxWaitMs, 9000);
  assert.equal(cfg.inboundMessageBatchMaxMessages, 5);
});
