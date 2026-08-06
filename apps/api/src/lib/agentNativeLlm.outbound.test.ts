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
  const link = "https://checkin.audaar.com.br/HHTIDAS";
  const raw = `Check-in online:\n${link}\n\n🔗\n${link}`;
  const out = sanitizeOutboundAgentReply(raw);
  assert.equal((out.match(/checkin\.audaar\.com\.br/gi) ?? []).length, 1);
});

test("sanitizeOutboundAgentReply normalizes broken markdown links to plain URL", () => {
  const raw =
    "Bom dia! 😊 O link oficial para realizar o check-in é [https://checkin.audaar.com.br/]().\n\n" +
    "Se você já tiver o localizador da sua reserva, pode inseri-lo diretamente na página.";
  const out = sanitizeOutboundAgentReply(raw);
  assert.match(out, /https:\/\/checkin\.audaar\.com\.br\//);
  assert.doesNotMatch(out, /\[https?:\/\//);
  assert.doesNotMatch(out, /\]\(\)/);
});
