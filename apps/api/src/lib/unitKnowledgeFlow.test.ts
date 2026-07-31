import assert from "node:assert/strict";
import test from "node:test";
import {
  userMessageLooksLikeCheckoutProcedureQuestion,
  userMessageLooksLikeReceiptOrInvoiceRequest,
  resolveEstablishmentInConversation,
  unitKbTurnNeedsEstablishmentCollection,
  messageIsStandaloneReservationLocator,
  assistantRequestedReservationLocator,
  assistantMentionedReservationLocator,
  assistantSentNfDataForm,
  userMessageLooksLikeNfFormSubmission,
  assistantSentNfConfirmationMirror,
  assistantRequestedEstablishmentForUnitKb,
  shouldRequireReservationLookupThisTurn,
  shouldRequireNfGuestLookupWithReservation,
  shouldRequireCallHumanAfterNfConfirmation,
  shouldRequireUnitKnowledgeLookupThisTurn,
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

test("establishment-only reply after NF unit collection requires KB lookup", () => {
  const lastAssistant = `Para emitir a nota fiscal, preciso saber em qual unidade você está hospedado:

1️⃣ Audaar Tech Suites
7️⃣ Hotel Brooklin

Qual delas?`;

  assert.equal(assistantRequestedEstablishmentForUnitKb(lastAssistant), true);
  assert.equal(
    shouldRequireUnitKnowledgeLookupThisTurn({
      userMessage: "Hotel brooklin",
      lastAssistantMessage: lastAssistant,
    }),
    true,
  );
  assert.equal(
    shouldRequireUnitKnowledgeLookupThisTurn({
      userMessage: "7",
      lastAssistantMessage: lastAssistant,
    }),
    true,
  );
});

test("NF form submission is detected", () => {
  const msg = `- Nome completo Maxmiliano Luan da Silva
- CPF ou CNPJ 095.124.574-07
- Endereço Rua 10
- CEP 04421210
- Telefone 5584994647139`;
  assert.equal(userMessageLooksLikeNfFormSubmission(msg), true);
});

test("locator after NF form partial completion requires reservation lookup", () => {
  const lastAssistant =
    "Obrigado! Para completar Nome do hóspede e Quarto, informe o localizador da reserva.";
  assert.equal(assistantMentionedReservationLocator(lastAssistant), true);
  assert.equal(
    shouldRequireReservationLookupThisTurn({
      userMessage: "DE4KRMDP",
      lastAssistantMessage: lastAssistant,
    }),
    true,
  );
  assert.equal(
    shouldRequireNfGuestLookupWithReservation({
      userMessage: "DE4KRMDP",
      lastAssistantMessage:
        "Para a nota fiscal, informe o localizador para preencher hóspede e quarto.",
    }),
    true,
  );
});

test("sim after NF confirmation mirror requires call_human path", () => {
  const mirror = `Confira os dados para emissão da nota fiscal:

- Nome completo: Max
- CPF ou CNPJ: 095.124.574-07
- CEP: 04421-210
- Telefone: 5584994647139

Está tudo correto? Responda sim para encaminhar.`;
  assert.equal(assistantSentNfConfirmationMirror(mirror), true);
  assert.equal(
    shouldRequireCallHumanAfterNfConfirmation({
      userMessage: "sim",
      lastAssistantMessage: mirror,
    }),
    true,
  );
});

test("assistantSentNfDataForm detects C19 form model", () => {
  const form = `Para emitir sua nota fiscal:

- Nome completo
- CPF ou CNPJ
- CEP
- Telefone
- Período
- Valor
- Quarto`;
  assert.equal(assistantSentNfDataForm(form), true);
});
