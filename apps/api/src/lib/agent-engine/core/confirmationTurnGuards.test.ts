import assert from "node:assert/strict";
import test from "node:test";
import {
  messageLooksLikePostGateFormData,
  shouldAllowCompletionToolPromotion,
  shouldSuppressConfirmationExclusiveTools,
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
