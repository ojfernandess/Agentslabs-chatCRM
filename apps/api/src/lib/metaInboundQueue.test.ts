import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMetaInboundJobId } from "./metaInboundDedupe.js";
import { shouldQueueMetaInboundWebhook } from "./metaInboundQueue.js";

test("shouldQueueMetaInboundWebhook only for meta cloud with messages or contact sync", () => {
  assert.equal(
    shouldQueueMetaInboundWebhook({
      whatsappProvider: "meta",
      messages: [
        { from: "5511999999999", waMessageId: "wamid.1", type: "TEXT", body: "hi", timestamp: new Date() },
      ],
    }),
    true,
  );
  assert.equal(
    shouldQueueMetaInboundWebhook({
      whatsappProvider: "360dialog",
      messages: [],
      contactSync: [{ phone: "+5511888888888" }],
    }),
    true,
  );
  assert.equal(
    shouldQueueMetaInboundWebhook({
      whatsappProvider: "evolution",
      messages: [
        { from: "5511999999999", waMessageId: "wamid.1", type: "TEXT", body: "hi", timestamp: new Date() },
      ],
    }),
    false,
  );
  assert.equal(
    shouldQueueMetaInboundWebhook({
      whatsappProvider: "meta",
      messages: [],
      contactSync: [],
    }),
    false,
  );
});

test("buildMetaInboundJobId is stable and bounded", () => {
  const id = buildMetaInboundJobId("org-1", "inbox-1", ["wamid.b", "wamid.a"]);
  assert.match(id, /^meta-inbound:org-1:inbox-1:/);
  assert.ok(id.includes("wamid.a"));
  assert.ok(id.length <= 220);
});
