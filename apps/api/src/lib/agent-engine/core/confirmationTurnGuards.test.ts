import assert from "node:assert/strict";
import test from "node:test";
import {
  messageLooksLikePostGateFormData,
  shouldAllowCompletionToolPromotion,
  shouldSuppressConfirmationExclusiveTools,
  assistantIsQuoteAvailabilityConfirm,
  guestSelectedQuoteOption,
  guestAsksQuoteCategoryInfo,
  messageLooksLikeQuoteOptionChoice,
} from "./confirmationTurnGuards.js";

const TITULAR_MIRROR = `
Obrigado! Confira se os dados do titular estão corretos:
• Nome: João
➡️ Confirme os dados do TITULAR. Está tudo certo?
`;

const FICHA_MIRROR = `
Obrigado! Confira a ficha de viagem:
• Motivo da viagem: lazer
➡️ Confirme os dados da ficha.
`;

const S4C_ASK =
  "Sua reserva é para 2 hóspedes (titular + 1 acompanhante). Deseja cadastrar o(s) acompanhante(s) agora?";

test("messageLooksLikePostGateFormData rejects CPF and nationality", () => {
  assert.equal(messageLooksLikePostGateFormData("12345678901"), false);
  assert.equal(messageLooksLikePostGateFormData("123.456.789-01"), false);
  assert.equal(messageLooksLikePostGateFormData("brasileiro"), false);
  assert.equal(messageLooksLikePostGateFormData("NCMT0VPN"), false);
});

test("messageLooksLikePostGateFormData accepts ficha block", () => {
  assert.equal(
    messageLooksLikePostGateFormData("Motivo: lazer\nTransporte: carro\nPaís: Brasil"),
    true,
  );
});

test("messageLooksLikePostGateFormData rejects companion personal block", () => {
  const companion = `* Nome completo  Caroline Luna Moreira
* CPF (ou passaporte se estrangeiro)  513.464.754-23
* RG e órgão (BR)  17.208.764-8 / SSP - SP
* Data de nascimento (DD/MM/AAAA)  24/07/1977
* Gênero  Feminino
* País de nascimento : Brasil
* Celular com DDD  55 (65) 3625-8200
* E-mail caroline@technew.ind.br`;
  assert.equal(messageLooksLikePostGateFormData(companion), false);
});

test("titular sim with N≥2 suppresses exclusive gate tools", () => {
  assert.equal(
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage: TITULAR_MIRROR,
      flowSlots: { guestsQuantity: 2 },
      userMessage: "Sim",
    }),
    true,
  );
  assert.equal(
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage: TITULAR_MIRROR,
      flowSlots: { guestsQuantity: 1 },
      userMessage: "Sim",
    }),
    false,
  );
});

test("S4c sim suppresses exclusive gate tools", () => {
  assert.equal(
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage: S4C_ASK,
      userMessage: "Sim",
    }),
    true,
  );
});

test("S4c nao does not suppress — goes to S9 embratur exclusive", () => {
  assert.equal(
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage: S4C_ASK,
      userMessage: "Não",
    }),
    false,
  );
  assert.equal(
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage: S4C_ASK,
      userMessage: "não desejo cadastrar o acompanhante",
    }),
    false,
  );
});

test("completion promotion blocked on titular / allowed on ficha", () => {
  assert.equal(
    shouldAllowCompletionToolPromotion({ lastAssistantMessage: TITULAR_MIRROR }),
    false,
  );
  assert.equal(
    shouldAllowCompletionToolPromotion({ lastAssistantMessage: FICHA_MIRROR }),
    true,
  );
  assert.equal(
    shouldAllowCompletionToolPromotion({
      lastAssistantMessage:
        "Seu check-in foi concluído com sucesso! Em seguida envio os detalhes da sua estadia.",
    }),
    false,
  );
});

test("completion promotion blocked on companion mirror even if completionReady", () => {
  const companion =
    "Obrigado! Confira se os dados do acompanhante estão corretos:\n• Nome: Caroline\n• RG / órgão: 17.208.764-8 / SSP - SP\n➡️ Confirme os dados do ACOMPANHANTE. Está tudo certo?";
  assert.equal(
    shouldAllowCompletionToolPromotion({
      lastAssistantMessage: companion,
      flowSlots: { __completionReady: true },
    }),
    false,
  );
});

test("post check-in ack suppresses exclusive gate on OK", () => {
  assert.equal(
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage:
        "Seu check-in foi concluído com sucesso! Em seguida envio os detalhes da sua estadia.",
      userMessage: "OK",
      flowSlots: { guestsQuantity: 1 },
    }),
    true,
  );
});

const C6_CONFIRM = `Perfeito! Então temos:

🏢 Propriedade: Audaar Tech Suites
📅 Data de chegada: 02/08/2026
📅 Data de partida: 03/08/2026
👤 Quantidade de pessoas: 2

Está tudo certo? Posso consultar a disponibilidade?`;

test("assistantIsQuoteAvailabilityConfirm detects Modelo C6 Confirm", () => {
  assert.equal(assistantIsQuoteAvailabilityConfirm(C6_CONFIRM), true);
  assert.equal(assistantIsQuoteAvailabilityConfirm(TITULAR_MIRROR), false);
});

test("assistantIsQuoteAvailabilityConfirm detects Perfeito + Está tudo certo pattern", () => {
  const msg = `Perfeito! Então temos:
🏢 Propriedade: Club Suítes
📅 Data de chegada: 02/08/2026
Está tudo certo? Posso verificar a disponibilidade?`;
  assert.equal(assistantIsQuoteAvailabilityConfirm(msg), true);
});

test("sim after Modelo C6 Confirm does not suppress exclusive gate", () => {
  assert.equal(
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage: C6_CONFIRM,
      userMessage: "Sim",
    }),
    false,
  );
});

const C6_OPTIONS = `Consultei a disponibilidade para o período informado - 03/08/2026 a 04/08/2026. Estas são as opções:

1️⃣ Standard Quadruplo (4 camas) — R$ 210,00 / diária · R$ 210,00 total
2️⃣ Deluxe Duplo — R$ 380,00 / diária · R$ 380,00 total

Qual opção você prefere?`;

test("guestSelectedQuoteOption detects category name without choice verb", () => {
  assert.equal(
    guestSelectedQuoteOption({
      lastAssistantMessage: C6_OPTIONS,
      userMessage: "Standard Quadruplo (4 camas)",
    }),
    true,
  );
  assert.equal(messageLooksLikeQuoteOptionChoice("Standard Quadruplo (4 camas)"), true);
});

test("guestAsksQuoteCategoryInfo detects category question and not bare choice", () => {
  assert.equal(
    guestAsksQuoteCategoryInfo({
      lastAssistantMessage: C6_OPTIONS,
      userMessage: "Quantas camas tem o Standard Quadruplo?",
    }),
    true,
  );
  assert.equal(
    guestSelectedQuoteOption({
      lastAssistantMessage: C6_OPTIONS,
      userMessage: "Quantas camas tem o Standard Quadruplo?",
    }),
    false,
  );
});
