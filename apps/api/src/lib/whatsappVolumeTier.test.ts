import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  applyVolumeTierDiscount,
  calendarMonthBounds,
  pickVolumeTierForMessageIndex,
  resolveCountryCodeFromPhone,
  resolveMarketFromCountryCode,
} from "./whatsappVolumeTier.js";

const BRAZIL_UTILITY_TIERS = [
  { fromMessage: 1, toMessage: 100000, discountPercent: 0 },
  { fromMessage: 100001, toMessage: 1000000, discountPercent: 5 },
  { fromMessage: 1000001, toMessage: 2000000, discountPercent: 10 },
  { fromMessage: 2000001, toMessage: 5000000, discountPercent: 15 },
  { fromMessage: 5000001, toMessage: null, discountPercent: 20 },
];

describe("pickVolumeTierForMessageIndex", () => {
  it("returns tier 0% for first message", () => {
    const tier = pickVolumeTierForMessageIndex(BRAZIL_UTILITY_TIERS, 1);
    assert.equal(tier?.discountPercent, 0);
  });

  it("returns 5% tier at message 100001", () => {
    const tier = pickVolumeTierForMessageIndex(BRAZIL_UTILITY_TIERS, 100001);
    assert.equal(tier?.discountPercent, 5);
  });

  it("returns highest tier for very large index", () => {
    const tier = pickVolumeTierForMessageIndex(BRAZIL_UTILITY_TIERS, 9_000_000);
    assert.equal(tier?.discountPercent, 20);
  });
});

describe("applyVolumeTierDiscount", () => {
  it("applies 5% discount on list price", () => {
    const result = applyVolumeTierDiscount(new Prisma.Decimal("0.0068"), 5);
    assert.equal(result.toString(), "0.00646");
  });

  it("returns full price at 0% discount", () => {
    const result = applyVolumeTierDiscount(0.035, 0);
    assert.equal(result.toString(), "0.035");
  });
});

describe("calendarMonthBounds", () => {
  it("covers full UTC month", () => {
    const at = new Date("2026-10-15T12:00:00.000Z");
    const { from, to } = calendarMonthBounds(at);
    assert.equal(from.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(to.getUTCMonth(), 9);
    assert.equal(to.getUTCDate(), 31);
  });
});

describe("phone/market helpers", () => {
  it("resolves Brazil country code", () => {
    assert.equal(resolveCountryCodeFromPhone("+5511999887766"), "55");
    assert.equal(resolveMarketFromCountryCode("55"), "Brazil");
  });
});
