import assert from "node:assert/strict";
import test from "node:test";
import { summarizeHttpToolAuth } from "./httpToolTest.js";

test("summarizeHttpToolAuth detects missing api key value", () => {
  const summary = summarizeHttpToolAuth({ authType: "api_key", apiKeyHeader: "Authorization" });
  assert.equal(summary.applied, false);
  assert.equal(summary.reason, "missing_api_key_value");
  assert.equal(summary.headerName, "Authorization");
});

test("summarizeHttpToolAuth detects applied api key with default header", () => {
  const summary = summarizeHttpToolAuth({ authType: "api_key", apiKeyValue: "secret-token" });
  assert.equal(summary.applied, true);
  assert.equal(summary.headerName, "X-Api-Key");
});

test("summarizeHttpToolAuth detects applied bearer token", () => {
  const summary = summarizeHttpToolAuth({ authType: "bearer", bearerToken: "abc" });
  assert.equal(summary.applied, true);
  assert.equal(summary.headerName, "Authorization");
});
