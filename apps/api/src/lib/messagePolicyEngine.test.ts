import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyMessageCategory } from "./messagePolicyEngine.js";

describe("classifyMessageCategory — purpose-based, never keyword-based (spec §39)", () => {
  it("uses the Meta-approved category of the template", () => {
    for (const category of ["UTILITY", "MARKETING", "AUTHENTICATION", "SERVICE"] as const) {
      assert.equal(
        classifyMessageCategory({
          isTemplate: true,
          templateMetaCategory: category,
          windowStatus: "CLOSED",
        }),
        category,
      );
    }
  });

  it("normalizes template category casing/whitespace", () => {
    assert.equal(
      classifyMessageCategory({ isTemplate: true, templateMetaCategory: " utility ", windowStatus: "OPEN" }),
      "UTILITY",
    );
  });

  it("falls back to UNKNOWN for templates without a recognizable category (never assume billing)", () => {
    assert.equal(
      classifyMessageCategory({ isTemplate: true, templateMetaCategory: null, windowStatus: "OPEN" }),
      "UNKNOWN",
    );
    assert.equal(
      classifyMessageCategory({ isTemplate: true, templateMetaCategory: "PROMO", windowStatus: "OPEN" }),
      "UNKNOWN",
    );
  });

  it("classifies free-form replies inside the 24h window as SERVICE (current Meta rule)", () => {
    assert.equal(
      classifyMessageCategory({ isTemplate: false, windowStatus: "OPEN" }),
      "SERVICE",
    );
    assert.equal(
      classifyMessageCategory({ isTemplate: false, windowStatus: "NOT_APPLICABLE" }),
      "SERVICE",
    );
  });

  it("classifies free-form outside the window as UNKNOWN — the policy engine blocks it separately", () => {
    assert.equal(classifyMessageCategory({ isTemplate: false, windowStatus: "CLOSED" }), "UNKNOWN");
    assert.equal(classifyMessageCategory({ isTemplate: false, windowStatus: "UNKNOWN" }), "UNKNOWN");
  });
});
