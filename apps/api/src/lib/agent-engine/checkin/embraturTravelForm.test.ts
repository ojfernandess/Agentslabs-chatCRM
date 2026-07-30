import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapTravelFormToEmbraturFields,
  extractEmbraturSlotsFromTravelForm,
  assembleEmbraturFromSources,
  parseTravelFormFields,
  normalizeAudaarCheckInPayload,
} from "./embraturTravelForm.js";
import { parseEmbraturReferenceCatalog } from "./embraturReferenceCatalog.js";
import { applyConfirmationPhaseTransitions } from "../core/sessionToolOutcomes.js";
import { buildScheduledToolArgs } from "../scheduler/TurnToolScheduler.js";
import type { TurnContext } from "../core/types.js";

const SAMPLE_REFERENCE = {
  motivosViagem: [
    { id: 3, nome: "Congresso/Feira" },
    { id: 7, nome: "Saúde" },
  ],
  meiosTransporte: [{ id: 2, nome: "Automóvel" }],
  paises: [
    { id: "1058", nome: "Brasil" },
    { id: "6289", nome: "Inglaterra" },
  ],
  cidades: [{ id: 3550308, nome: "São Paulo" }],
};

const CATALOG = parseEmbraturReferenceCatalog(SAMPLE_REFERENCE);

const FORM = `* Motivo da viagem: Congresso
* Meio de transporte: Automóvel
* País de residência: Brasil
* País de destino: Brasil
* Cidade de procedência: São Paulo
* Cidade de destino: São Paulo`;

test("mapTravelFormToEmbraturFields requires reference catalog", () => {
  assert.equal(mapTravelFormToEmbraturFields(FORM, null), null);
  const mapped = mapTravelFormToEmbraturFields(FORM, CATALOG);
  assert.ok(mapped);
  assert.equal(mapped!.snmotvia, "3");
  assert.equal(mapped!.sntiptran, "2");
  assert.equal(mapped!.bgstdscpais, "1058");
});

test("parseTravelFormFields extracts labels", () => {
  const f = parseTravelFormFields(FORM);
  assert.match(f.motivo, /Congresso/i);
  assert.match(f.transporte, /Autom/i);
  assert.equal(f.cidadeProcedencia, "São Paulo");
});

test("parseTravelFormFields strips markdown bold labels from WhatsApp/LLM", () => {
  const md = `**Motivo da viagem:** Saúde
**Meio de transporte:** Automóvel
**País de residência:** Brasil
**País de destino:** Brasil
**Cidade de procedência:** São Paulo
**Cidade de destino:** São Paulo`;
  const f = parseTravelFormFields(md);
  assert.equal(f.motivo, "Saúde");
  const mapped = mapTravelFormToEmbraturFields(md, CATALOG);
  assert.ok(mapped);
  assert.equal(mapped!.snmotvia, "7");
});

test("applyConfirmationPhaseTransitions stores embratur ids when catalog present", () => {
  const slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: {
      __awaitingPostGateData: true,
      __embraturReferenceCatalog: JSON.stringify(CATALOG),
    },
    userMessage: FORM,
    confirmationPrerequisiteTools: ["embratur-reference"],
  });
  assert.equal(slots.__completionReady, true);
  assert.equal(slots.snmotvia, "3");
  assert.equal(slots.sntiptran, "2");
  assert.equal(slots.snidcidadeibge, "3550308");
});

test("applyConfirmationPhaseTransitions without catalog stores only raw form", () => {
  const slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: { __awaitingPostGateData: true },
    userMessage: FORM,
    lastAssistantPreview: "Para finalizar, envie o motivo da viagem",
    confirmationPrerequisiteTools: ["embratur-reference"],
  });
  assert.equal(slots.__completionReady, true);
  assert.equal(slots.snmotvia, undefined);
  assert.ok(slots.__travelFormMessage);
});

test("buildScheduledToolArgs includes embratur object for check_in", () => {
  const ctx = {
    userMessage: "sim",
    intent: { entities: {} },
    facts: {
      snmotvia: { key: "snmotvia", value: 3, source: "slots", updatedAt: "" },
      sntiptran: { key: "sntiptran", value: 2, source: "slots", updatedAt: "" },
      bgstdscpais: { key: "bgstdscpais", value: "1058", source: "slots", updatedAt: "" },
      bgstdscpaisdest: { key: "bgstdscpaisdest", value: "1058", source: "slots", updatedAt: "" },
      snidcidadeibge: { key: "snidcidadeibge", value: 3550308, source: "slots", updatedAt: "" },
      snidcidadeibgedest: { key: "snidcidadeibgedest", value: 3550308, source: "slots", updatedAt: "" },
    },
  } as unknown as TurnContext;
  const args = buildScheduledToolArgs("audaar_check_in", ctx);
  assert.ok(args.embratur && typeof args.embratur === "object");
  const e = args.embratur as Record<string, unknown>;
  assert.equal(e.snmotvia, "3");
  assert.equal(e.snidcidadeibge, "3550308");
  assert.equal(e.bgstdscpais, "1058");
});

test("assembleEmbraturFromSources remaps from __travelFormMessage + catalog", () => {
  const e = assembleEmbraturFromSources({
    __travelFormMessage: FORM,
    __embraturReferenceCatalog: JSON.stringify(CATALOG),
  });
  assert.ok(e);
  assert.equal(e!.snmotvia, "3");
  assert.equal(e!.bgstdscpais, "1058");
});

test("normalizeAudaarCheckInPayload keeps resolved country codes", () => {
  const normalized = normalizeAudaarCheckInPayload({
    mode: "digital",
    embratur: {
      snmotvia: "7",
      sntiptran: "2",
      bgstdscpais: "1058",
      bgstdscpaisdest: "6289",
      snidcidadeibge: "3550308",
      snidcidadeibgedest: "3550308",
    },
  });
  const e = normalized.embratur as Record<string, unknown>;
  assert.equal(e.bgstdscpaisdest, "6289");
});
