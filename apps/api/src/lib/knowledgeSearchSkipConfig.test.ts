import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnowledgeSearchSkipHint,
  DEFAULT_KNOWLEDGE_SEARCH_SKIP_HINT,
  parseKnowledgeSearchSkipFromBehavior,
} from "./knowledgeSearchSkipConfig.js";

test("parseKnowledgeSearchSkipFromBehavior defaults enabled with empty instruction", () => {
  const cfg = parseKnowledgeSearchSkipFromBehavior(null);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.instruction, "");
});

test("parseKnowledgeSearchSkipFromBehavior reads enabled and instruction", () => {
  const cfg = parseKnowledgeSearchSkipFromBehavior({
    knowledgeSearchSkip: { enabled: false, instruction: "  Siga o fluxo.  " },
  });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.instruction, "Siga o fluxo.");
});

test("buildKnowledgeSearchSkipHint uses default when instruction empty", () => {
  const hint = buildKnowledgeSearchSkipHint({ enabled: true, instruction: "" });
  assert.ok(hint.includes(DEFAULT_KNOWLEDGE_SEARCH_SKIP_HINT));
});

test("buildKnowledgeSearchSkipHint uses custom instruction when set", () => {
  const hint = buildKnowledgeSearchSkipHint({ enabled: true, instruction: "Continue o check-in." });
  assert.ok(hint.includes("Continue o check-in."));
  assert.ok(!hint.includes(DEFAULT_KNOWLEDGE_SEARCH_SKIP_HINT));
});
