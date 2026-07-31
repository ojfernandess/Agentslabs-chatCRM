import assert from "node:assert/strict";
import test from "node:test";
import {
  userMessageLooksLikeCheckoutProcedureQuestion,
  userMessageLooksLikeReceiptOrInvoiceRequest,
  resolveEstablishmentInConversation,
  unitKbTurnNeedsEstablishmentCollection,
  messageIsStandaloneReservationLocator,
  assistantRequestedReservationLocator,
  shouldRequireReservationLookupThisTurn,
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

test("standalone locator after NF request requires reservation lookup", () => {
  assert.equal(messageIsStandaloneReservationLocator("DE4KRMDP"), true);
  assert.equal(messageIsStandaloneReservationLocator("fazer check-in DE4KRMDP"), false);
  assert.equal(
    assistantRequestedReservationLocator(
      "Para a nota fiscal, informe o localizador da reserva para preencher período e valor.",
    ),
    true,
  );
  assert.equal(
    shouldRequireReservationLookupThisTurn({
      userMessage: "DE4KRMDP",
      lastAssistantMessage:
        "Para emitir a NF, preciso do localizador da reserva para preencher período, valor, unidade, hóspede e quarto.",
    }),
    true,
  );
  assert.equal(
    shouldRequireReservationLookupThisTurn({
      userMessage: "DE4KRMDP",
      lastAssistantMessage: "Olá! Como posso ajudar?",
    }),
    false,
  );
});
