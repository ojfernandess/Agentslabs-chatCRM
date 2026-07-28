import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeOutboundAgentReply, scrubLiteralUndefinedArtifacts } from "./agentNativeLlm.js";

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

test("scrubLiteralUndefinedArtifacts removes JS mirror artefacts", () => {
  const raw =
    "Confirme os dados:\nNome: Odair\nRG: undefined\nCelular: null\nCPF: 41026299802";
  const out = scrubLiteralUndefinedArtifacts(raw);
  assert.doesNotMatch(out, /\bundefined\b/i);
  assert.doesNotMatch(out, /\bnull\b/i);
  assert.match(out, /Odair/);
  assert.match(out, /41026299802/);
  assert.doesNotMatch(out, /^RG:\s*$/m);
});

test("sanitizeOutboundAgentReply strips undefined literals", () => {
  const out = sanitizeOutboundAgentReply("Nome: Ana\nProfissão: undefined\nOK?");
  assert.doesNotMatch(out, /\bundefined\b/i);
  assert.match(out, /Ana/);
});
