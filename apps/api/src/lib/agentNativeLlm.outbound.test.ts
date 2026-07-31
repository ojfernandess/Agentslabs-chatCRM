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

test("sanitizeOutboundAgentReply replaces check-in API JSON with S10 ack", () => {
  const raw =
    '{"message":"Check-in realizado com sucesso","data":{"checkin":{"reservationId":279321,"validatedCheckin":1}}}';
  const out = sanitizeOutboundAgentReply(raw);
  assert.match(out, /check-in foi concluído/i);
  assert.doesNotMatch(out, /reservationId|validatedCheckin/);
});

test("sanitizeOutboundAgentReply truncates long replies", () => {
  const out = sanitizeOutboundAgentReply("a".repeat(5000));
  assert.ok(out.length <= 4001);
});

test("sanitizeOutboundAgentReply deduplicates check-in links", () => {
  const link = "https://pms.audaar.com.br/checkin/vivapp/access";
  const raw = `Check-in online:\n${link}\n\n🔗\n${link}`;
  const out = sanitizeOutboundAgentReply(raw);
  assert.equal((out.match(/pms\.audaar\.com\.br\/checkin/gi) ?? []).length, 1);
});
