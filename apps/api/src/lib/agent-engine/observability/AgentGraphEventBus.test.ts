import assert from "node:assert/strict";
import test from "node:test";
import {
  clearGraphEventBusForTests,
  publishGraphEvent,
  subscribeGraphEvents,
} from "./AgentGraphEventBus.js";

test("AgentGraphEventBus publish subscribe", async () => {
  clearGraphEventBusForTests();
  const threadId = "conv-1:msg-1";
  const received: string[] = [];
  const unsub = subscribeGraphEvents(threadId, (e) => {
    received.push(e.kind);
  });
  publishGraphEvent(threadId, {
    kind: "node",
    at: new Date().toISOString(),
    nodeId: "supervisor",
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(received, ["node"]);
  unsub();
  clearGraphEventBusForTests();
});
