import assert from "node:assert/strict";
import test from "node:test";
import { createOptimisticOutboundMessage } from "./optimisticOutboundMessage.js";
import { mergeIncrementalConversationSnapshot } from "./conversationIncrementalLoad.js";

test("mergeIncrementalConversationSnapshot ignores prevMessages when prev conversation differs", () => {
  const merged = mergeIncrementalConversationSnapshot({
    meta: {
      id: "conv-b",
      messages: [],
    },
    prev: null,
    prevMessages: [
      { id: "stale", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    ],
    tailMessages: [],
    newestCursor: null,
  });

  assert.deepEqual(merged.messages, []);
});

test("mergeIncrementalConversationSnapshot appends only unseen tail messages", () => {
  const merged = mergeIncrementalConversationSnapshot({
    meta: {
      id: "conv-1",
      messages: [],
      messagesHasMore: false,
      messagesOlderCursor: null,
      messagesNewerCursor: "cursor-2",
    },
    prev: {
      id: "conv-1",
      messages: [
        { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      ],
      messagesHasMore: true,
      messagesOlderCursor: "older",
      messagesNewerCursor: "cursor-1",
    },
    prevMessages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    ],
    tailMessages: [
      { id: "2", sentAt: "2026-01-01T10:01:00.000Z", createdAt: "2026-01-01T10:01:00.000Z", status: "DELIVERED" },
    ],
    newestCursor: "cursor-2",
  });

  assert.deepEqual(merged.messages?.map((m) => m.id), ["1", "2"]);
  assert.equal(merged.messagesOlderCursor, "older");
  assert.equal(merged.messagesNewerCursor, "cursor-2");
});

test("mergeIncrementalConversationSnapshot keeps realtime rows from prev.messages when prevMessages snapshot is stale", () => {
  const merged = mergeIncrementalConversationSnapshot({
    meta: { id: "conv-1", messages: [] },
    prev: {
      id: "conv-1",
      messages: [
        { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
        { id: "2", sentAt: "2026-01-01T10:02:00.000Z", createdAt: "2026-01-01T10:02:00.000Z", status: "DELIVERED" },
      ],
    },
    prevMessages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    ],
    tailMessages: [],
    newestCursor: null,
  });

  assert.deepEqual(merged.messages?.map((m) => m.id), ["1", "2"]);
});

test("mergeIncrementalConversationSnapshot drops optimistic rows when tail adds persisted message", () => {
  const optimistic = createOptimisticOutboundMessage({ body: "Olá", type: "TEXT" });
  const merged = mergeIncrementalConversationSnapshot({
    meta: {
      id: "conv-1",
      messages: [],
    },
    prev: {
      id: "conv-1",
      messages: [
        { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      ],
    },
    prevMessages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      { ...optimistic, sentAt: optimistic.sentAt, createdAt: optimistic.createdAt },
    ],
    tailMessages: [
      { id: "real-2", sentAt: "2026-01-01T10:02:00.000Z", createdAt: "2026-01-01T10:02:00.000Z", status: "SENT" },
    ],
    newestCursor: "cursor-2",
  });

  assert.deepEqual(merged.messages?.map((m) => m.id), ["1", "real-2"]);
});
