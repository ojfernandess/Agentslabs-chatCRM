import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getStripeKeyMode,
  isStripeModeMismatchError,
  isStripeResourceMissingError,
} from "./stripeErrors.js";

describe("stripeErrors", () => {
  it("getStripeKeyMode detects test and live prefixes", () => {
    assert.equal(getStripeKeyMode("sk_test_abc"), "test");
    assert.equal(getStripeKeyMode("sk_live_abc"), "live");
    assert.equal(getStripeKeyMode("rk_live_abc"), "unknown");
  });

  it("isStripeModeMismatchError detects cross-mode resource_missing", () => {
    const err = {
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      message:
        "No such customer: 'cus_x'; a similar object exists in test mode, but a live mode key was used to make this request.",
    };
    assert.equal(isStripeResourceMissingError(err), true);
    assert.equal(isStripeModeMismatchError(err), true);
  });
});
