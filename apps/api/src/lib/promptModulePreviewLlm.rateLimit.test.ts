import assert from "node:assert/strict";
import test from "node:test";
import { parseLlmRetryAfterMs } from "./promptModulePreviewLlm.js";

test("parseLlmRetryAfterMs reads Retry-After seconds", () => {
  const res = new Response("", { status: 429, headers: { "retry-after": "12" } });
  assert.equal(parseLlmRetryAfterMs(res, ""), 12_000);
});

test("parseLlmRetryAfterMs reads OpenAI try again in Xs body", () => {
  const res = new Response("", { status: 429 });
  const body =
    'Rate limit reached for gpt-4.1 ... Please try again in 9.756s. Visit https://platform.openai.com';
  assert.equal(parseLlmRetryAfterMs(res, body), Math.ceil(9.756 * 1000) + 300);
});
