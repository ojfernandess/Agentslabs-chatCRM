import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultAnalyticsDateRange,
  parseAnalyticsQuery,
  resolveAnalyticsDateRange,
} from "./broadcastAnalyticsQuery.js";

test("parseAnalyticsQuery applies defaults", () => {
  const q = parseAnalyticsQuery({});
  assert.equal(q.campaignKind, "all");
  assert.equal(q.status, "ALL");
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 50);
});

test("parseAnalyticsQuery accepts filters", () => {
  const q = parseAnalyticsQuery({
    campaignKind: "followup",
    status: "FAILED",
    channel: "WHATSAPP",
    search: "5511",
    page: "2",
    pageSize: "100",
  });
  assert.equal(q.campaignKind, "followup");
  assert.equal(q.status, "FAILED");
  assert.equal(q.channel, "WHATSAPP");
  assert.equal(q.page, 2);
  assert.equal(q.pageSize, 100);
});

test("resolveAnalyticsDateRange uses custom ISO bounds", () => {
  const from = "2026-01-01T00:00:00.000Z";
  const to = "2026-01-31T23:59:59.999Z";
  const range = resolveAnalyticsDateRange(
    parseAnalyticsQuery({ from, to }),
  );
  assert.equal(range.from.toISOString(), from);
  assert.equal(range.to.toISOString(), to);
});

test("defaultAnalyticsDateRange spans about 30 days", () => {
  const { from, to } = defaultAnalyticsDateRange();
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  assert.ok(days >= 28 && days <= 31);
});
