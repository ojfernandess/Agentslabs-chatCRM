import assert from "node:assert/strict";
import { test } from "node:test";
import { clampLlmMaxTokens } from "./LlmTurnAdapter.js";

test("clampLlmMaxTokens enforces bounds", () => {
  assert.equal(clampLlmMaxTokens(8), 16);
  assert.equal(clampLlmMaxTokens(4096), 4096);
  assert.equal(clampLlmMaxTokens(99999), 8192);
});
