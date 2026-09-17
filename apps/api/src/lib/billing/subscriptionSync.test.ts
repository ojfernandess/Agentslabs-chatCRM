import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addPlanIntervalToDate,
  resolveMercadoPagoBillingPeriod,
} from "./subscriptionSync.js";

describe("resolveMercadoPagoBillingPeriod", () => {
  it("uses next_payment_date when provided by Mercado Pago", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const next = new Date("2026-02-01T00:00:00.000Z");
    assert.deepEqual(
      resolveMercadoPagoBillingPeriod({
        periodStart: start,
        nextPaymentDate: next,
        planInterval: "month",
      }),
      { currentPeriodStart: start, currentPeriodEnd: next },
    );
  });

  it("computes monthly renewal when next_payment_date is missing", () => {
    const start = new Date("2026-03-15T12:00:00.000Z");
    const period = resolveMercadoPagoBillingPeriod({
      periodStart: start,
      planInterval: "month",
    });
    assert.equal(period.currentPeriodStart?.toISOString(), start.toISOString());
    assert.equal(period.currentPeriodEnd?.toISOString(), "2026-04-15T12:00:00.000Z");
  });

  it("computes yearly renewal from plan interval", () => {
    const start = new Date("2026-01-10T00:00:00.000Z");
    const period = resolveMercadoPagoBillingPeriod({
      periodStart: start,
      planInterval: "year",
    });
    assert.equal(period.currentPeriodEnd?.toISOString(), "2027-01-10T00:00:00.000Z");
  });

  it("returns null end when start and interval are unavailable", () => {
    assert.deepEqual(resolveMercadoPagoBillingPeriod({}), {
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
  });
});

describe("addPlanIntervalToDate", () => {
  it("adds one month by default", () => {
    const start = new Date("2026-12-01T00:00:00.000Z");
    assert.equal(addPlanIntervalToDate(start, "month").toISOString(), "2027-01-01T00:00:00.000Z");
  });
});
