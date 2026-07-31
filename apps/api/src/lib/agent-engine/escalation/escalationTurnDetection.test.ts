import assert from "node:assert/strict";
import test from "node:test";
import {
  messageLooksLikeOperationalComplaint,
  messageLooksLikeHumanHandoffRequest,
  shouldRequireCallHumanThisTurn,
  assistantIsComplaintDataCollection,
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
