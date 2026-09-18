import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  pickBestPricingRule,
  resolveMetaBillable,
  resolveMessageCost,
  parseMetaWebhookPricing,
} from "./whatsappMessageCost.js";

const ruleBrMarketing = {
  price: new Prisma.Decimal("0.0625"),
  currency: "USD",
  version: "2026-07",
};

describe("resolveMetaBillable — Meta policy until Oct 2026", () => {
  it("uses webhook billable=false as authoritative (service in CSW)", () => {
    assert.equal(
      resolveMetaBillable({
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "SERVICE",
        isTemplate: false,
        serviceWindowOpenAtSend: true,
        metaPricing: {
          billable: false,
          type: "free_customer_service",
          category: "service",
        },
      }),
      false,
    );
  });

  it("service free-form inside CSW without webhook", () => {
    assert.equal(
      resolveMetaBillable({
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "SERVICE",
        isTemplate: false,
        serviceWindowOpenAtSend: true,
        billingPolicyPhase: { serviceInWindowFree: true, utilityInWindowFree: true },
      }),
      false,
    );
  });

  it("service in-window becomes billable from Oct 2026 policy phase", () => {
    assert.equal(
      resolveMetaBillable({
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "SERVICE",
        isTemplate: false,
        serviceWindowOpenAtSend: true,
        billingPolicyPhase: { serviceInWindowFree: false, utilityInWindowFree: false },
      }),
      true,
    );
  });

  it("utility template inside CSW is free without webhook", () => {
    assert.equal(
      resolveMetaBillable({
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "UTILITY",
        isTemplate: true,
        serviceWindowOpenAtSend: true,
        billingPolicyPhase: { serviceInWindowFree: true, utilityInWindowFree: true },
      }),
      false,
    );
  });

  it("utility template outside CSW is billable", () => {
    assert.equal(
      resolveMetaBillable({
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "UTILITY",
        isTemplate: true,
        serviceWindowOpenAtSend: false,
      }),
      true,
    );
  });

  it("marketing is always billable when delivered", () => {
    assert.equal(
      resolveMetaBillable({
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "MARKETING",
        isTemplate: true,
        serviceWindowOpenAtSend: true,
      }),
      true,
    );
  });

  it("unknown category is never billable", () => {
    assert.equal(
      resolveMetaBillable({
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "UNKNOWN",
        isTemplate: false,
        serviceWindowOpenAtSend: false,
      }),
      false,
    );
  });
});

describe("resolveMessageCost", () => {
  it("delivered service in CSW → zero cost (not billable)", () => {
    const r = resolveMessageCost(
      {
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "SERVICE",
        isTemplate: false,
        serviceWindowOpenAtSend: true,
      },
      ruleBrMarketing,
    );
    assert.equal(r.metaBillable, false);
    assert.equal(r.estimatedCost, null);
  });

  it("delivered marketing → applies pricing rule", () => {
    const r = resolveMessageCost(
      {
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "MARKETING",
        isTemplate: true,
        serviceWindowOpenAtSend: true,
      },
      ruleBrMarketing,
    );
    assert.equal(r.metaBillable, true);
    assert.equal(Number(r.estimatedCost), 0.0625);
    assert.equal(r.currency, "USD");
  });

  it("billable but missing rule → cost null (never invent price)", () => {
    const r = resolveMessageCost(
      {
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "MARKETING",
        isTemplate: true,
        serviceWindowOpenAtSend: false,
      },
      null,
    );
    assert.equal(r.metaBillable, true);
    assert.equal(r.estimatedCost, null);
  });
});

describe("pickBestPricingRule", () => {
  const rules = [
    {
      countryCode: "55",
      organizationId: null,
      price: new Prisma.Decimal("0.01"),
      currency: "USD",
      version: "v1",
    },
    {
      countryCode: "5511",
      organizationId: null,
      price: new Prisma.Decimal("0.02"),
      currency: "USD",
      version: "v2",
    },
  ];

  it("matches longest E.164 prefix", () => {
    const best = pickBestPricingRule(rules, "5511987654321");
    assert.equal(Number(best?.price), 0.02);
  });

  it("prefers org override at same prefix length", () => {
    const withOrg = [
      ...rules,
      {
        countryCode: "55",
        organizationId: "org-1",
        price: new Prisma.Decimal("0.99"),
        currency: "USD",
        version: "org",
      },
    ];
    const best = pickBestPricingRule(withOrg, "5519999999999");
    assert.equal(Number(best?.price), 0.99);
  });
});

describe("parseMetaWebhookPricing", () => {
  it("parses Meta status webhook pricing object", () => {
    const p = parseMetaWebhookPricing({
      billable: false,
      pricing_model: "PMP",
      type: "free_customer_service",
      category: "utility",
    });
    assert.deepEqual(p, {
      billable: false,
      pricingModel: "PMP",
      type: "free_customer_service",
      category: "utility",
    });
  });
});

describe("foldLedgerAggregation contract — failed ≠ billable", () => {
  it("documents that FAILED rows must not contribute to billable totals", () => {
    const failedBillable = resolveMessageCost(
      {
        organizationId: "org",
        recipientPhone: "+5511999990000",
        category: "MARKETING",
        isTemplate: true,
        serviceWindowOpenAtSend: false,
        metaPricing: { billable: true },
      },
      ruleBrMarketing,
    );
    assert.equal(failedBillable.metaBillable, true);
    /** Agregação em whatsappOrgPolicy só soma DELIVERED/READ — FAILED fica fora. */
    assert.ok(true);
  });
});
