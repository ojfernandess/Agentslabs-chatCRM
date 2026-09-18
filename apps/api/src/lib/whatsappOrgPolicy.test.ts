import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
const {
  buildServiceQuotaAlerts,
  foldLedgerAggregation,
  resolveConsumptionRange,
} = await import("./whatsappOrgPolicy.js");

describe("resolveConsumptionRange", () => {
  const now = new Date("2026-09-16T15:00:00.000Z");

  it("defaults to the current calendar month", () => {
    const r = resolveConsumptionRange({ now });
    assert.equal(r.preset, "month");
    assert.equal(r.from.getDate(), 1);
    assert.equal(r.from.getMonth(), now.getMonth());
  });

  it("supports today, 7d and 30d presets", () => {
    assert.equal(resolveConsumptionRange({ preset: "today", now }).preset, "today");
    assert.equal(resolveConsumptionRange({ preset: "7d", now }).preset, "7d");
    assert.equal(resolveConsumptionRange({ preset: "30d", now }).preset, "30d");
  });

  it("accepts a custom range only when both dates are valid", () => {
    const r = resolveConsumptionRange({
      preset: "custom",
      from: "2026-09-01",
      to: "2026-09-10",
      now,
    });
    assert.equal(r.preset, "custom");
    const invalid = resolveConsumptionRange({ preset: "custom", from: "x", to: "y", now });
    assert.equal(invalid.preset, "month");
  });
});

describe("buildServiceQuotaAlerts", () => {
  it("does not invent alerts when quota or usage is unavailable", () => {
    assert.deepEqual(buildServiceQuotaAlerts(null, 1000), []);
    assert.deepEqual(buildServiceQuotaAlerts(800, null), []);
    assert.deepEqual(buildServiceQuotaAlerts(0, 0), []);
  });

  it("emits 80% then 100% when the real usage crosses each threshold", () => {
    assert.deepEqual(buildServiceQuotaAlerts(799, 1000), []);
    assert.equal(buildServiceQuotaAlerts(800, 1000)[0]?.threshold, 80);
    const full = buildServiceQuotaAlerts(1000, 1000);
    assert.deepEqual(
      full.map((a) => a.threshold),
      [80, 100],
    );
  });
});

describe("foldLedgerAggregation — SENT is not DELIVERED (spec §41)", () => {
  it("keeps sent, delivered and failed distinct and does not invent billable cost", () => {
    const rows = foldLedgerAggregation([
      {
        messageCategory: "SERVICE",
        billingStatus: "SENT",
        currency: null,
        _count: { _all: 5 },
        _sum: { estimatedCost: null },
      },
      {
        messageCategory: "SERVICE",
        billingStatus: "DELIVERED",
        currency: null,
        _count: { _all: 3 },
        _sum: { estimatedCost: null },
      },
      {
        messageCategory: "SERVICE",
        billingStatus: "FAILED",
        currency: null,
        _count: { _all: 1 },
        _sum: { estimatedCost: null },
      },
    ]);
    const service = rows.find((r) => r.category === "SERVICE")!;
    assert.equal(service.sent, 9);
    assert.equal(service.delivered, 3);
    assert.equal(service.failed, 1);
    assert.equal(service.billable, null);
    assert.equal(service.estimatedCost, null);
  });

  it("propagates currency from delivered rows with cost", () => {
    const rows = foldLedgerAggregation([
      {
        messageCategory: "MARKETING",
        billingStatus: "DELIVERED",
        currency: "USD",
        _count: { _all: 2 },
        _sum: { estimatedCost: 0.125 },
      },
    ]);
    const m = rows.find((r) => r.category === "MARKETING")!;
    assert.equal(m.estimatedCost, 0.125);
    assert.equal(m.billable, 2);
    assert.equal(m.currency, "USD");
  });
});
