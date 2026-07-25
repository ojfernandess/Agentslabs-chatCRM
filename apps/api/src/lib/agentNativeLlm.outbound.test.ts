import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeOutboundAgentReply } from "./agentNativeLlm.js";

test("sanitizeOutboundAgentReply blocks raw JSON tool payloads", () => {
  const raw = JSON.stringify({
    found: true,
    articles: [{ title: "Hotel", excerpt: "## WiFi" }],
  });
  const out = sanitizeOutboundAgentReply(raw);
  assert.ok(!out.includes('"found"'));
  assert.ok(!out.includes("articles"));
});

test("sanitizeOutboundAgentReply truncates long replies", () => {
  const out = sanitizeOutboundAgentReply("a".repeat(5000));
  assert.ok(out.length <= 4001);
});
