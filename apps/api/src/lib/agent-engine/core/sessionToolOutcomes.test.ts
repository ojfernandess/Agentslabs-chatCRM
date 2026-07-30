import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_SATISFIED_TOOLS_KEY,
  appendSessionSatisfiedToolName,
  applyConfirmationPhaseTransitions,
  buildPersistedFlowSlots,
  priorToolOutcomesFromSession,
  readSessionSatisfiedToolNames,
} from "../core/sessionToolOutcomes.js";

test("session satisfied tools round-trip in flowSlots", () => {
  let slots: Record<string, string | number | boolean> = {};
  slots = appendSessionSatisfiedToolName(slots, "embratur-reference");
  slots = appendSessionSatisfiedToolName(slots, "audaar_check_in");
  slots = appendSessionSatisfiedToolName(slots, "embratur-reference");

  assert.equal(readSessionSatisfiedToolNames(slots).length, 2);
  assert.ok(typeof slots[SESSION_SATISFIED_TOOLS_KEY] === "string");

  const prior = priorToolOutcomesFromSession(slots);
  assert.equal(prior.length, 2);
  assert.ok(prior.every((t) => t.ok));
});

test("buildPersistedFlowSlots preserves session tools and skips EIL overwrite of __satisfiedToolNames", () => {
  const slots = buildPersistedFlowSlots({
    baseFlowSlots: { __satisfiedToolNames: "audaar_consultar_reserva", cpf: "123" },
    toolOutcomes: [{ name: "embratur-reference", ok: true }],
    eilFacts: {
      __satisfiedToolNames: { value: "stale_only_reserva" },
      profilePhotoId: { value: 99 },
    },
  });
  const names = readSessionSatisfiedToolNames(slots);
  assert.ok(names.includes("audaar_consultar_reserva"));
  assert.ok(names.includes("embratur-reference"));
  assert.equal(slots.profilePhotoId, 99);
});

test("buildPersistedFlowSlots never persists failed tool outcomes", () => {
  const slots = buildPersistedFlowSlots({
    baseFlowSlots: {},
    toolOutcomes: [
      { name: "audaar_check_in", ok: false },
      { name: "embratur-reference", ok: true },
    ],
  });
  const names = readSessionSatisfiedToolNames(slots);
  assert.deepEqual(names, ["embratur-reference"]);
});

test("applyConfirmationPhaseTransitions gates completion until post-gate data", () => {
  let slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: {},
    toolOutcomes: [{ name: "embratur-reference", ok: true }],
    confirmationPrerequisiteTools: ["embratur-reference"],
    completionToolHints: ["audaar_check_in"],
    userMessage: "Sim",
  });
  assert.equal(slots.__awaitingPostGateData, true);
  assert.equal(slots.__completionReady, false);

  slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: slots,
    toolOutcomes: [],
    confirmationPrerequisiteTools: ["embratur-reference"],
    completionToolHints: ["audaar_check_in"],
    userMessage: "Motivo: lazer\nTransporte: carro",
  });
  assert.equal(slots.__awaitingPostGateData, false);
  assert.equal(slots.__completionReady, true);

  slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: slots,
    toolOutcomes: [{ name: "audaar_check_in", ok: true }],
    confirmationPrerequisiteTools: ["embratur-reference"],
    completionToolHints: ["audaar_check_in"],
    userMessage: "Sim",
  });
  assert.equal(slots.__awaitingPostGateData, false);
  assert.equal(slots.__completionReady, false);
  assert.equal(slots.__postCompletionPending, true);

  slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: slots,
    toolOutcomes: [],
    clearPostCompletionPending: true,
    lastAssistantPreview: "Passo 8 completo com Wi-Fi",
  });
  assert.equal(slots.__postCompletionPending, false);
});

test("applyConfirmationPhaseTransitions does not arm ready on CPF or nationality", () => {
  const awaiting = {
    __awaitingPostGateData: true,
    __completionReady: false,
  };
  for (const msg of ["12345678901", "brasileiro", "NCMT0VPN"]) {
    const slots = applyConfirmationPhaseTransitions({
      baseFlowSlots: awaiting,
      toolOutcomes: [],
      confirmationPrerequisiteTools: ["embratur-reference"],
      completionToolHints: ["audaar_check_in"],
      userMessage: msg,
    });
    assert.equal(slots.__awaitingPostGateData, true, msg);
    assert.equal(slots.__completionReady, false, msg);
  }
});

test("applyConfirmationPhaseTransitions does not arm ready on companion personal block", () => {
  const companion = `* Nome completo  Caroline Luna Moreira
* CPF (ou passaporte se estrangeiro)  513.464.754-23
* RG e órgão (BR)  17.208.764-8 / SSP - SP
* Data de nascimento (DD/MM/AAAA)  24/07/1977
* Gênero  Feminino
* País de nascimento : Brasil
* Celular com DDD  55 (65) 3625-8200
* E-mail caroline@technew.ind.br`;
  const slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: {
      __awaitingPostGateData: true,
      __completionReady: false,
    },
    toolOutcomes: [],
    confirmationPrerequisiteTools: ["embratur-reference"],
    completionToolHints: ["audaar_check_in"],
    userMessage: companion,
  });
  assert.equal(slots.__awaitingPostGateData, true);
  assert.equal(slots.__completionReady, false);
});

test("applyConfirmationPhaseTransitions persists lastAssistantPreview", () => {
  const slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: {},
    lastAssistantPreview: "Confirme os dados do TITULAR. Está tudo certo?",
  });
  assert.match(String(slots.__lastAssistantPreview), /TITULAR/i);
});
