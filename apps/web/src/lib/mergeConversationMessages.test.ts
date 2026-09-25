import assert from "node:assert/strict";
import test from "node:test";
import {
  isRemoteMessagesSnapshotStale,
  localMessagesMissingFromRemote,
  mergeConversationWithRemote,
  mergeMessagesById,
} from "./mergeConversationMessages.js";

test("mergeMessagesById keeps local-only messages from realtime", () => {
  const local = [
    { id: "a", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    { id: "b", sentAt: "2026-01-01T10:01:00.000Z", createdAt: "2026-01-01T10:01:00.000Z", status: "DELIVERED" },
  ];
  const remote = [
    { id: "a", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
  ];
  const merged = mergeMessagesById(local, remote);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((m) => m.id), ["a", "b"]);
});

test("mergeMessagesById prefers remote fields for the same id", () => {
  const local = [
    { id: "a", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "SENT" },
  ];
  const remote = [
    { id: "a", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
  ];
  const merged = mergeMessagesById(local, remote);
  assert.equal(merged[0]?.status, "DELIVERED");
});

test("mergeConversationWithRemote preserves local tail when HTTP snapshot is stale", () => {
  const local = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      { id: "2", sentAt: "2026-01-01T10:01:00.000Z", createdAt: "2026-01-01T10:01:00.000Z", status: "DELIVERED" },
    ],
    messagesOlderCursor: "older-cursor",
    messagesNewerCursor: "newer-cursor",
  };
  const remote = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    ],
    messagesOlderCursor: null as string | null,
    messagesNewerCursor: null as string | null,
  };
  const merged = mergeConversationWithRemote(local, remote);
  assert.equal(merged.messages?.length, 2);
  assert.equal(merged.messages?.[1]?.id, "2");
  assert.equal(merged.messagesOlderCursor, "older-cursor");
});

test("isRemoteMessagesSnapshotStale detects older HTTP windows", () => {
  const stale = isRemoteMessagesSnapshotStale(
    [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      { id: "2", sentAt: "2026-01-01T10:02:00.000Z", createdAt: "2026-01-01T10:02:00.000Z", status: "DELIVERED" },
    ],
    [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    ],
  );
  assert.equal(stale, true);
});

test("localMessagesMissingFromRemote detects ws-only rows", () => {
  const missing = localMessagesMissingFromRemote(
    [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      { id: "2", sentAt: "2026-01-01T10:01:00.000Z", createdAt: "2026-01-01T10:01:00.000Z", status: "DELIVERED" },
    ],
    [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    ],
  );
  assert.deepEqual(missing.map((m) => m.id), ["2"]);
});
