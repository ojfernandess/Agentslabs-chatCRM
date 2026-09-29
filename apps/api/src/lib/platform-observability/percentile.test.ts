import assert from "node:assert/strict";
import { test } from "node:test";
import { latencySummary, percentile } from "./percentile.js";

test("percentile returns median and p95", () => {
  const values = [10, 20, 30, 40, 100];
  assert.equal(percentile(values, 50), 30);
  assert.equal(percentile(values, 95), 100);
});

test("latencySummary handles empty input", () => {
  const summary = latencySummary([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.p50Ms, null);
});
