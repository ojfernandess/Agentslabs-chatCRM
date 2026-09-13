import assert from "node:assert/strict";
import test from "node:test";
import { buildFactStoreFromInputs, evaluatePolicies, evaluatePredicateDetailed } from "./policyEval.js";

test("evaluatePredicateDetailed returns unknown when fact missing for gt", () => {
  const r = evaluatePredicateDetailed({}, { fact: "guestsQuantity", op: "gt", value: 1 });
  assert.equal(r.result, "unknown");
});

test("evaluatePredicateDetailed returns false for 1 > 1", () => {
  const store = buildFactStoreFromInputs({ guestsQuantity: "1" });
  const r = evaluatePredicateDetailed(store, { fact: "guestsQuantity", op: "gt", value: 1 });
  assert.equal(r.result, "false");
});

test("evaluatePolicies blocks request_additional_party when guestsQuantity is 1", () => {
  const store = buildFactStoreFromInputs({ guestsQuantity: "1" });
  const violations = evaluatePolicies({
    policies: [
      {
        id: "party_requires_n_gt_1",
        action: "request_additional_party",
        requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
      },
    ],
    facts: store,
    replyActions: ["request_additional_party"],
  });
  assert.equal(violations.length, 1);
});

test("evaluatePolicies skips inactive policies", () => {
  const store = buildFactStoreFromInputs({ guestsQuantity: "1" });
  const violations = evaluatePolicies({
    policies: [
      {
        id: "party_requires_n_gt_1",
        action: "request_additional_party",
        requires: [{ fact: "guestsQuantity", op: "gt", value: 1 }],
        active: false,
      },
    ],
    facts: store,
    replyActions: ["request_additional_party"],
  });
  assert.equal(violations.length, 0);
});
