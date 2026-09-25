import assert from "node:assert/strict";
import test from "node:test";
import {
  messageLooksLikeOperationalComplaint,
  messageLooksLikeHumanHandoffRequest,
  messageLooksLikeReservationUpdateRequest,
  messageLooksLikeVagueProblemReport,
  userMessageLooksLikeAccessBlockedProblem,
  shouldRequireCallHumanThisTurn,
  assistantIsComplaintDataCollection,
  assistantIsReservationChannelPrompt,
  guestProvidesComplaintContext,
} from "./escalationTurnDetection.js";

test("messageLooksLikeOperationalComplaint detects dirty room", () => {
  assert.equal(messageLooksLikeOperationalComplaint("meu quarto está sujo"), true);
  assert.equal(messageLooksLikeOperationalComplaint("qual endereço do hotel?"), false);
});

test("messageLooksLikeHumanHandoffRequest accepts atendimento wording", () => {
  assert.equal(messageLooksLikeHumanHandoffRequest("falar com atendimento"), true);
  assert.equal(messageLooksLikeHumanHandoffRequest("quero um atendente"), true);
});

test("shouldRequireCallHumanThisTurn on explicit human request", () => {
  assert.equal(shouldRequireCallHumanThisTurn({ userMessage: "falar com atendimento" }), true);
  assert.equal(shouldRequireCallHumanThisTurn({ userMessage: "meu quarto está sujo" }), false);
});

test("userMessageLooksLikeAccessBlockedProblem detects blocked entry", () => {
  assert.equal(userMessageLooksLikeAccessBlockedProblem("não consigo entrar no quarto"), true);
  assert.equal(userMessageLooksLikeAccessBlockedProblem("a portaria não liberou"), true);
  assert.equal(
    userMessageLooksLikeAccessBlockedProblem("Como funciona a entrada no audaar tech?"),
    false,
  );
  assert.equal(userMessageLooksLikeAccessBlockedProblem("podem liberar a entrada?"), false);
});

test("shouldRequireCallHumanThisTurn on access blocked problem", () => {
  assert.equal(
    shouldRequireCallHumanThisTurn({ userMessage: "não consigo entrar no estabelecimento" }),
    true,
  );
});

test("messageLooksLikeHumanHandoffRequest accepts named attendant", () => {
  assert.equal(
    messageLooksLikeHumanHandoffRequest(
      "Gostaria de falar com o William do time de atendimento",
    ),
    true,
  );
});

test("shouldRequireCallHumanThisTurn on payment continuation without context", () => {
  assert.equal(
    shouldRequireCallHumanThisTurn({
      userMessage: "O Pagamento dos R$ 760,00 será feito hoje também",
    }),
    true,
  );
});

test("shouldRequireCallHumanThisTurn not on vague problem (triage first)", () => {
  assert.equal(messageLooksLikeVagueProblemReport("Estou tentando aqui e não está dando certo."), true);
  assert.equal(
    shouldRequireCallHumanThisTurn({
      userMessage: "Estou tentando aqui e não está dando certo.",
    }),
    false,
  );
});

test("messageLooksLikeReservationUpdateRequest detects update wording", () => {
  assert.equal(messageLooksLikeReservationUpdateRequest("preciso atualizar uma reserva"), true);
});

test("shouldRequireCallHumanThisTurn on C24 direct channel after prompt", () => {
  const last =
    "Para alterações na reserva, preciso saber: onde ela foi realizada? Booking, Airbnb, Expedia, outra OTA ou conosco/direto?";
  assert.equal(assistantIsReservationChannelPrompt(last), true);
  assert.equal(
    shouldRequireCallHumanThisTurn({
      userMessage: "foi feita com vocês pelo atendimento",
      lastAssistantMessage: last,
    }),
    true,
  );
  assert.equal(
    shouldRequireCallHumanThisTurn({
      userMessage: "Booking",
      lastAssistantMessage: last,
    }),
    false,
  );
});

test("shouldRequireCallHumanThisTurn after C13 data collection", () => {
  const last =
    "Sinto muito pelo ocorrido. Para agilizar, pode me informar o nome da hospedagem e o número do quarto?";
  assert.equal(assistantIsComplaintDataCollection(last), true);
  assert.equal(
    shouldRequireCallHumanThisTurn({
      userMessage: "estou no audaar tech, quarto 45",
      lastAssistantMessage: last,
    }),
    true,
  );
  assert.equal(guestProvidesComplaintContext("estou no audaar tech, quarto 45"), true);
});
