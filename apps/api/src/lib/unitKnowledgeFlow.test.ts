import assert from "node:assert/strict";
import test from "node:test";
import {
  userMessageLooksLikeCheckoutProcedureQuestion,
  userMessageLooksLikeReceiptOrInvoiceRequest,
  resolveEstablishmentInConversation,
  unitKbTurnNeedsEstablishmentCollection,
  messageIsStandaloneReservationLocator,
  assistantMentionedReservationLocator,
  assistantSentNfDataForm,
  userMessageLooksLikeNfFormSubmission,
  assistantSentNfConfirmationMirror,
  assistantRequestedEstablishmentForUnitKb,
  shouldRequireReservationLookupThisTurn,
  shouldRequireCallHumanAfterNfConfirmation,
  shouldRequireUnitKnowledgeLookupThisTurn,
  isNfEstablishmentSelectionTurn,
  userMessageLooksLikeReceiptFormSubmission,
  assistantSentReceiptDataForm,
  isReceiptFormSubmissionTurn,
  assistantSentReceiptConfirmationMirror,
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

test("standalone locator after NF form does not require reservation lookup", () => {
  assert.equal(messageIsStandaloneReservationLocator("DE4KRMDP"), true);
  assert.equal(messageIsStandaloneReservationLocator("fazer check-in DE4KRMDP"), false);
  assert.equal(
    assistantMentionedReservationLocator(
      "Para a nota fiscal, informe o localizador da reserva para preencher período e valor.",
    ),
    false,
  );
  assert.equal(
    shouldRequireReservationLookupThisTurn({
      userMessage: "DE4KRMDP",
      lastAssistantMessage:
        "Para emitir a NF, preciso do localizador da reserva para preencher período, valor, unidade, hóspede e quarto.",
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

test("locator after non-NF flow still requires reservation lookup", () => {
  assert.equal(
    shouldRequireReservationLookupThisTurn({
      userMessage: "DE4KRMDP",
      lastAssistantMessage: "Olá! Como posso ajudar?",
    }),
    false,
  );
  assert.equal(
    shouldRequireReservationLookupThisTurn({
      userMessage: "DE4KRMDP",
      lastAssistantMessage: "Para verificar sua reserva, informe o localizador.",
    }),
    true,
  );
});

test("typo udaar Tech Suites resolves establishment from user message", () => {
  assert.equal(
    resolveEstablishmentInConversation({ userMessage: "udaar Tech Suites" }),
    "Audaar Tech Suites",
  );
});

test("establishment not inferred from assistant menu when user message is unrelated", () => {
  const menu = `Para emitir a nota fiscal:

1️⃣ Audaar Tech Suites
7️⃣ Hotel Brooklin`;
  assert.equal(
    resolveEstablishmentInConversation({
      userMessage: "oi",
      lastAssistantMessage: menu,
    }),
    null,
  );
});

test("isNfEstablishmentSelectionTurn detects post-unit NF step", () => {
  const lastAssistant = `Para emitir a nota fiscal, informe qual unidade:

1️⃣ Audaar Tech Suites
7️⃣ Hotel Brooklin`;
  assert.equal(
    isNfEstablishmentSelectionTurn({
      userMessage: "Hotel brooklin",
      lastAssistantMessage: lastAssistant,
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

test("receipt form submission is not treated as checkout procedure question", () => {
  const msg = `🏨 Nome da hospedagem: Audaar Tech Suites
🛏️ Quarto: 101
⏰ Check-in: 01/08/2026
⏰ Checkout: 05/08/2026`;
  assert.equal(userMessageLooksLikeCheckoutProcedureQuestion(msg), false);
  assert.equal(userMessageLooksLikeReceiptFormSubmission(msg), true);
});

test("receipt form submission turn skips KB lookup", () => {
  const lastAssistant = `Para emitir o recibo (pessoa física), preencha:

🏨 Nome da hospedagem:
🛏️ Quarto:
⏰ Check-in:
⏰ Checkout:`;
  const userMsg = `🏨 Nome da hospedagem: Audaar Tech Suites
🛏️ Quarto: 101
⏰ Check-in: 01/08/2026
⏰ Checkout: 05/08/2026`;
  assert.equal(
    isReceiptFormSubmissionTurn({ userMessage: userMsg, lastAssistantMessage: lastAssistant }),
    true,
  );
  assert.equal(
    shouldRequireUnitKnowledgeLookupThisTurn({
      userMessage: userMsg,
      lastAssistantMessage: lastAssistant,
    }),
    false,
  );
});

test("sim after receipt mirror requires call_human", () => {
  const mirror = `Confira os dados para emissão do recibo (pessoa física):

🏨 Nome da hospedagem: Audaar Tech Suites
🛏️ Quarto: 101
⏰ Check-in: 01/08/2026
⏰ Checkout: 05/08/2026

Está tudo correto?`;
  assert.equal(assistantSentReceiptConfirmationMirror(mirror), true);
  assert.equal(
    shouldRequireCallHumanAfterNfConfirmation({
      userMessage: "sim",
      lastAssistantMessage: mirror,
    }),
    true,
  );
});
