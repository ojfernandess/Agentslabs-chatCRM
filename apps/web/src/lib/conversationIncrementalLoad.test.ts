import assert from "node:assert/strict";
import test from "node:test";
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
