import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapTravelFormToEmbraturFields,
  extractEmbraturSlotsFromTravelForm,
  assembleEmbraturFromSources,
  parseTravelFormFields,
} from "./embraturTravelForm.js";
import { applyConfirmationPhaseTransitions } from "../core/sessionToolOutcomes.js";
import { buildScheduledToolArgs } from "../scheduler/TurnToolScheduler.js";
import { buildSchemaFillSources, fillMissingRequiredSchemaFields } from "../../automationHttpToolExecute.js";
import type { TurnContext } from "../core/types.js";

const FORM = `* Motivo da viagem: Congresso
* Meio de transporte: Automóvel
* País de residência: Brasil
* País de destino: Brasil
* Cidade de procedência: São Paulo
* Cidade de destino: São Paulo`;

test("mapTravelFormToEmbraturFields maps Congresso/Automóvel/SP", () => {
  const mapped = mapTravelFormToEmbraturFields(FORM);
  assert.ok(mapped);
  assert.equal(mapped!.snmotvia, 3);
  assert.equal(mapped!.sntiptran, 2);
  assert.equal(mapped!.bgstdscpais, "Brasil");
  assert.equal(mapped!.bgstdscpaisdest, "Brasil");
  assert.equal(mapped!.snidcidadeibge, 3550308);
  assert.equal(mapped!.snidcidadeibgedest, 3550308);
});

test("parseTravelFormFields extracts labels", () => {
  const f = parseTravelFormFields(FORM);
  assert.match(f.motivo, /Congresso/i);
  assert.match(f.transporte, /Autom/i);
  assert.equal(f.cidadeProcedencia, "São Paulo");
});

test("applyConfirmationPhaseTransitions persists Embratur slots from ficha", () => {
  const slots = applyConfirmationPhaseTransitions({
    baseFlowSlots: { __awaitingPostGateData: true },
    userMessage: FORM,
    lastAssistantPreview: "Para finalizar, envie o motivo da viagem e meio de transporte",
    confirmationPrerequisiteTools: ["embratur-reference"],
    completionToolHints: ["audaar_check_in"],
  });
  assert.equal(slots.__completionReady, true);
  assert.equal(slots.snmotvia, 3);
  assert.equal(slots.sntiptran, 2);
  assert.equal(slots.snidcidadeibge, 3550308);
});

test("buildScheduledToolArgs includes embratur object for check_in", () => {
  const turnContext = {
    userMessage: "sim",
    intent: { kind: "confirmation", confidence: 0.9, entities: {}, expectedGoal: "complete_operational_flow" },
    facts: {
      snmotvia: { key: "snmotvia", value: 3, source: "slots", updatedAt: "" },
      sntiptran: { key: "sntiptran", value: 2, source: "slots", updatedAt: "" },
      bgstdscpais: { key: "bgstdscpais", value: "Brasil", source: "slots", updatedAt: "" },
      bgstdscpaisdest: { key: "bgstdscpaisdest", value: "Brasil", source: "slots", updatedAt: "" },
      snidcidadeibge: { key: "snidcidadeibge", value: 3550308, source: "slots", updatedAt: "" },
      snidcidadeibgedest: { key: "snidcidadeibgedest", value: 3550308, source: "slots", updatedAt: "" },
      documentNumber: { key: "documentNumber", value: "41026299802", source: "slots", updatedAt: "" },
      email: { key: "email", value: "a@b.com", source: "slots", updatedAt: "" },
      name: { key: "name", value: "Ana", source: "slots", updatedAt: "" },
    },
  } as unknown as TurnContext;

  const args = buildScheduledToolArgs("audaar_check_in", turnContext);
  assert.ok(args.embratur && typeof args.embratur === "object");
  const e = args.embratur as Record<string, unknown>;
  assert.equal(e.snmotvia, 3);
  assert.equal(e.sntiptran, 2);
  assert.equal(e.snidcidadeibge, 3550308);
  assert.ok(args.mainGuest);
});

test("fillMissingRequiredSchemaFields fills nested embratur from flat slots", () => {
  const schema = {
    type: "object",
    required: ["embratur"],
    properties: {
      embratur: {
        type: "object",
        required: [
          "snmotvia",
          "sntiptran",
          "bgstdscpais",
          "bgstdscpaisdest",
          "snidcidadeibge",
          "snidcidadeibgedest",
        ],
        properties: {
          snmotvia: { type: "number" },
          sntiptran: { type: "number" },
          bgstdscpais: { type: "string" },
          bgstdscpaisdest: { type: "string" },
          snidcidadeibge: { type: "number" },
          snidcidadeibgedest: { type: "number" },
        },
      },
    },
  };
  const sources = buildSchemaFillSources(
    {
      sampleContext: {
        flowSlots: extractEmbraturSlotsFromTravelForm(FORM),
      },
    },
    {},
  );
  const filled = fillMissingRequiredSchemaFields({
    schema,
    data: {},
    fillSources: sources,
  });
  const embratur = filled.data.embratur as Record<string, unknown>;
  assert.ok(embratur);
  assert.equal(embratur.snmotvia, 3);
  assert.equal(embratur.sntiptran, 2);
  assert.equal(embratur.bgstdscpais, "Brasil");
  assert.equal(embratur.snidcidadeibge, 3550308);
  assert.ok(
    filled.applied.includes("embratur") ||
      filled.applied.some((p) => p.includes("snmotvia")),
  );
});

test("assembleEmbraturFromSources remaps from __travelFormMessage", () => {
  const e = assembleEmbraturFromSources({ __travelFormMessage: FORM });
  assert.ok(e);
  assert.equal(e!.snmotvia, 3);
  assert.equal(e!.sntiptran, 2);
});
