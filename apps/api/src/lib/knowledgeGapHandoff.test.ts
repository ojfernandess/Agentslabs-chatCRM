import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnowledgeGapHandoffReply,
  kbOutcomeCoversUserQuery,
  shouldEscalateAfterKnowledgeGap,
  userMessageLooksLikeKbEscalationCandidate,
} from "./knowledgeGapHandoff.js";
import {
  userMessageLooksLikeAmenityItemQuestion,
  userMessageLooksLikeEstablishmentEntryFaqQuestion,
} from "./unitKnowledgeFlow.js";

test("userMessageLooksLikeAmenityItemQuestion detects pet question", () => {
  assert.equal(
    userMessageLooksLikeAmenityItemQuestion("pode pet pequeno porte no Achieta Riviera?"),
    true,
  );
});

test("userMessageLooksLikeKbEscalationCandidate includes pet amenity question", () => {
  assert.equal(
    userMessageLooksLikeKbEscalationCandidate("pode pet pequeno porte no Achieta Riviera?"),
    true,
  );
});

test("kbOutcomeCoversUserQuery false when KB has unrelated checkout content", () => {
  const covered = kbOutcomeCoversUserQuery(
    {
      name: "buscar_conhecimento",
      ok: true,
      preview: "Procedimento de check-out: deixe as chaves na recepção.",
    },
    "pode pet pequeno porte no Achieta Riviera?",
  );
  assert.equal(covered, false);
});

test("shouldEscalateAfterKnowledgeGap true when KB searched but does not cover pet", () => {
  assert.equal(
    shouldEscalateAfterKnowledgeGap({
      userMessage: "pode pet pequeno porte no Achieta Riviera?",
      toolOutcomes: [
        {
          name: "buscar_conhecimento",
          ok: true,
          preview: "Wi-Fi: rede Audaar · senha no check-in.",
        },
      ],
      callHumanSucceeded: false,
    }),
    true,
  );
});

test("shouldEscalateAfterKnowledgeGap false when call_human already ran", () => {
  assert.equal(
    shouldEscalateAfterKnowledgeGap({
      userMessage: "pode pet pequeno porte no Achieta Riviera?",
      toolOutcomes: [
        { name: "buscar_conhecimento", ok: true, preview: "sem pet" },
        { name: "call_human", ok: true, preview: '{"ok":true}' },
      ],
      callHumanSucceeded: true,
    }),
    false,
  );
});

test("buildKnowledgeGapHandoffReply mentions attendant verification", () => {
  const reply = buildKnowledgeGapHandoffReply();
  assert.match(reply, /base de conhecimento/i);
  assert.match(reply, /atendente/i);
  assert.match(reply, /verificar/i);
});

test("userMessageLooksLikeEstablishmentEntryFaqQuestion detects procedural entrada FAQ", () => {
  assert.equal(
    userMessageLooksLikeEstablishmentEntryFaqQuestion("Como funciona a entrada no audaar tech?"),
    true,
  );
  assert.equal(
    userMessageLooksLikeEstablishmentEntryFaqQuestion("qual o procedimento de entrada no hotel?"),
    true,
  );
});

test("userMessageLooksLikeKbEscalationCandidate excludes establishment entry FAQ", () => {
  assert.equal(
    userMessageLooksLikeKbEscalationCandidate("Como funciona a entrada no audaar tech?"),
    false,
  );
});

test("shouldEscalateAfterKnowledgeGap false for establishment entry FAQ even when KB lacks answer", () => {
  assert.equal(
    shouldEscalateAfterKnowledgeGap({
      userMessage: "Como funciona a entrada no audaar tech?",
      toolOutcomes: [
        {
          name: "buscar_conhecimento",
          ok: true,
          preview: "Wi-Fi: rede Audaar · senha no check-in.",
        },
      ],
      callHumanSucceeded: false,
    }),
    false,
  );
});

test("userMessageLooksLikeKbEscalationCandidate excludes access blocked problem", () => {
  assert.equal(userMessageLooksLikeKbEscalationCandidate("não consigo entrar no quarto"), false);
});
