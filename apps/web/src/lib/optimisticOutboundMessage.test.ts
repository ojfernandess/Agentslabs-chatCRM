import assert from "node:assert/strict";
import test from "node:test";
import {
  createOptimisticOutboundMessage,
  isOptimisticOutboundMessageId,
  stripOptimisticOutboundMessages,
} from "./optimisticOutboundMessage.js";

test("createOptimisticOutboundMessage uses a stable optimistic prefix", () => {
  const message = createOptimisticOutboundMessage({ body: "Olá", type: "TEXT" });
  assert.equal(isOptimisticOutboundMessageId(message.id), true);
  assert.equal(message.direction, "OUTBOUND");
  assert.equal(message.status, "SENT");
});

test("stripOptimisticOutboundMessages removes only optimistic rows", () => {
  const optimistic = createOptimisticOutboundMessage({ body: "Olá", type: "TEXT" });
  const persisted = {
    id: "real-id",
    direction: "OUTBOUND",
    type: "TEXT",
    body: "Olá",
    status: "SENT",
    sentAt: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T10:00:00.000Z",
  };
  const stripped = stripOptimisticOutboundMessages([persisted, optimistic]);
  assert.deepEqual(stripped.map((m) => m.id), ["real-id"]);
});
