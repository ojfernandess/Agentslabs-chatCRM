import assert from "node:assert/strict";
import test from "node:test";
import { createOptimisticOutboundMessage } from "./optimisticOutboundMessage.js";
import {
  finalizeConversationMessages,
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

test("mergeMessagesById keeps local body when remote row has empty body", () => {
  type Row = {
    id: string;
    sentAt: string;
    createdAt: string;
    status: string;
    body?: string | null;
  };
  const local: Row[] = [
    {
      id: "a",
      sentAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T10:00:00.000Z",
      status: "SENT",
      body: "teste",
    },
  ];
  const remote: Row[] = [
    {
      id: "a",
      sentAt: "2026-01-01T10:00:00.000Z",
      createdAt: "2026-01-01T10:00:00.000Z",
      status: "DELIVERED",
      body: null,
    },
  ];
  const merged = mergeMessagesById(local, remote);
  assert.equal(merged[0]?.status, "DELIVERED");
  assert.equal(merged[0]?.body, "teste");
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

test("finalizeConversationMessages removes optimistic when persisted twin is already listed", () => {
  const optimistic = createOptimisticOutboundMessage({ body: "Olá", type: "TEXT" });
  const optimisticRow = {
    ...optimistic,
    body: "Olá",
    sentAt: "2026-01-01T10:01:30.000Z",
    createdAt: "2026-01-01T10:01:30.000Z",
  };
  const finalized = finalizeConversationMessages([
    { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
    optimisticRow,
    {
      id: "real-2",
      direction: "OUTBOUND",
      body: "Olá",
      sentAt: "2026-01-01T10:02:00.000Z",
      createdAt: "2026-01-01T10:02:00.000Z",
      status: "SENT",
    },
  ]);
  assert.deepEqual(finalized.map((m) => m.id), ["1", "real-2"]);
});

test("mergeConversationWithRemote drops optimistic rows when HTTP returns the persisted message", () => {
  const optimistic = createOptimisticOutboundMessage({ body: "Olá", type: "TEXT" });
  const optimisticRow = {
    ...optimistic,
    body: "Olá",
    sentAt: "2026-01-01T10:01:30.000Z",
    createdAt: "2026-01-01T10:01:30.000Z",
  };
  const local = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      optimisticRow,
    ],
  };
  const remote = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      {
        id: "real-2",
        direction: "OUTBOUND",
        body: "Olá",
        sentAt: "2026-01-01T10:02:00.000Z",
        createdAt: "2026-01-01T10:02:00.000Z",
        status: "SENT",
      },
    ],
  };
  const merged = mergeConversationWithRemote(local, remote);
  assert.deepEqual(merged.messages?.map((m) => m.id), ["1", "real-2"]);
});

test("mergeConversationWithRemote keeps optimistic when HTTP adds unrelated bot outbound", () => {
  const optimistic = createOptimisticOutboundMessage({ body: "Resposta do atendente", type: "TEXT" });
  const local = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      { ...optimistic, body: "Resposta do atendente", sentAt: optimistic.sentAt, createdAt: optimistic.createdAt },
    ],
  };
  const remote = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      {
        id: "bot-2",
        direction: "OUTBOUND",
        body: "Mensagem automática do bot",
        sentAt: "2026-01-01T10:02:00.000Z",
        createdAt: "2026-01-01T10:02:00.000Z",
        status: "SENT",
      },
    ],
  };
  const merged = mergeConversationWithRemote(local, remote);
  assert.equal(merged.messages?.length, 3);
  assert.ok(merged.messages?.some((m) => m.id === optimistic.id));
});

test("mergeConversationWithRemote keeps optimistic row when HTTP only adds inbound message", () => {
  const optimistic = createOptimisticOutboundMessage({ body: "Olá", type: "TEXT" });
  const local = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      { ...optimistic, sentAt: optimistic.sentAt, createdAt: optimistic.createdAt },
    ],
  };
  const remote = {
    id: "conv-1",
    messages: [
      { id: "1", sentAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z", status: "DELIVERED" },
      {
        id: "bot-2",
        direction: "INBOUND",
        sentAt: "2026-01-01T10:02:00.000Z",
        createdAt: "2026-01-01T10:02:00.000Z",
        status: "DELIVERED",
      },
    ],
  };
  const merged = mergeConversationWithRemote(local, remote);
  assert.equal(merged.messages?.length, 3);
  assert.ok(merged.messages?.some((m) => m.id === optimistic.id));
  assert.ok(merged.messages?.some((m) => m.id === "bot-2"));
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
