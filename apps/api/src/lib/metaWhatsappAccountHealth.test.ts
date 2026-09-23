import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  businessVerifiedOk,
  nameStatusOk,
  paymentOk,
} from "./metaWhatsappAccountHealth.js";

describe("metaWhatsappAccountHealth status helpers", () => {
  it("nameStatusOk accepts Meta display name statuses", () => {
    assert.equal(nameStatusOk("APPROVED"), true);
    assert.equal(nameStatusOk("available_without_review"), true);
    assert.equal(nameStatusOk("PENDING_REVIEW"), false);
  });

  it("nameStatusOk falls back to verified_name when name_status is omitted", () => {
    assert.equal(
      nameStatusOk(undefined, { verifiedName: "Minha Loja", phoneConnected: true }),
      true,
    );
    assert.equal(
      nameStatusOk(undefined, { verifiedName: "Minha Loja", phoneConnected: false }),
      false,
    );
  });

  it("businessVerifiedOk accepts verified in any casing", () => {
    assert.equal(businessVerifiedOk("verified"), true);
    assert.equal(businessVerifiedOk("VERIFIED"), true);
    assert.equal(businessVerifiedOk("not_verified"), false);
  });

  it("businessVerifiedOk can infer verification from health_status", () => {
    assert.equal(
      businessVerifiedOk(undefined, {
        entities: [{ entity_type: "BUSINESS", can_send_message: "AVAILABLE" }],
      }),
      true,
    );
    assert.equal(
      businessVerifiedOk(undefined, {
        entities: [
          {
            entity_type: "BUSINESS",
            can_send_message: "LIMITED",
            errors: [{ error_code: 141010 }],
          },
        ],
      }),
      false,
    );
  });

  it("paymentOk detects funding, review approval and active billing profile", () => {
    assert.equal(paymentOk({ primaryFundingId: "12345" }), true);
    assert.equal(paymentOk({ accountReviewStatus: "APPROVED" }), true);
    assert.equal(paymentOk({ wabaStatus: "ACTIVE", currency: "BRL" }), true);
  });

  it("paymentOk rejects explicit Meta payment health errors", () => {
    assert.equal(
      paymentOk({
        accountReviewStatus: "APPROVED",
        healthStatus: {
          entities: [
            {
              entity_type: "WABA",
              can_send_message: "BLOCKED",
              errors: [{ error_code: 141006 }],
            },
          ],
        },
      }),
      false,
    );
  });
});
