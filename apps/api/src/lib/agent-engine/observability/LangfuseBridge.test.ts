import assert from "node:assert/strict";
import test from "node:test";
import { isLangfuseConfigured, readLangfuseConfig } from "./LangfuseBridge.js";

test("isLangfuseConfigured false without env", () => {
  const prevPk = process.env.LANGFUSE_PUBLIC_KEY;
  const prevSk = process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  assert.equal(isLangfuseConfigured(), false);
  assert.equal(readLangfuseConfig(), null);
  if (prevPk) process.env.LANGFUSE_PUBLIC_KEY = prevPk;
  if (prevSk) process.env.LANGFUSE_SECRET_KEY = prevSk;
});
