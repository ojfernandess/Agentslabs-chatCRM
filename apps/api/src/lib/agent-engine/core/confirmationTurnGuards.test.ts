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
});
