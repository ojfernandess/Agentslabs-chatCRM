import assert from "node:assert/strict";
import test from "node:test";
import {
  userMessageLooksLikeCheckoutProcedureQuestion,
  userMessageLooksLikeReceiptOrInvoiceRequest,
  resolveEstablishmentInConversation,
  unitKbTurnNeedsEstablishmentCollection,
} from "./unitKnowledgeFlow.js";

test("checkout procedure question is detected", () => {
  assert.equal(userMessageLooksLikeCheckoutProcedureQuestion("gostaria de realizar o check-out"), true);
  assert.equal(userMessageLooksLikeCheckoutProcedureQuestion("como funciona o checkout?"), true);
  assert.equal(userMessageLooksLikeCheckoutProcedureQuestion("fazer check-in na reserva ABC123"), false);
});

test("checkout without establishment needs collection", () => {
  assert.equal(
    unitKbTurnNeedsEstablishmentCollection({ userMessage: "gostaria de realizar o check-out" }),
    true,
  );
});

test("checkout with establishment in message skips collection", () => {
  assert.equal(
    unitKbTurnNeedsEstablishmentCollection({
      userMessage: "como funciona o checkout no Hotel Brooklin?",
    }),
    false,
  );
  assert.equal(
    resolveEstablishmentInConversation({
      userMessage: "como funciona o checkout no Hotel Brooklin?",
    }),
    "Hotel Brooklin",
  );
});

test("receipt request is detected", () => {
  assert.equal(userMessageLooksLikeReceiptOrInvoiceRequest("preciso de nota fiscal"), true);
});
