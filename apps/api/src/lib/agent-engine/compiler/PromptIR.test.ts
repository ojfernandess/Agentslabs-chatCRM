import assert from "node:assert/strict";
import { test } from "node:test";
import { compilePromptToIR, compileStaticPromptIR } from "./compilePromptToIR.js";
import { compilePromptContract } from "./PromptCompiler.js";
import { promptIrToContract, promptContractMatchesIr } from "../contract/promptIrAdapter.js";
import { clearPromptIRCache, promptIRCacheSize } from "./PromptIRCache.js";
import { PROMPT_IR_VERSION } from "../contract/PromptIR.js";
import { summarizePlaybookIntent } from "./IntentAnalyzer.js";

const HOTEL_PLAYBOOK = `
## Objetivo
Realizar check-in digital de hóspedes.

## Regras
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno

| C2 | Verificar | consultar + localizador | Chame \`audaar_consultar_reserva\` |
| C3 | Check-in | localizador | Chame \`audaar_consultar_reserva\` |
| S9 | Embratur | só \`embratur-reference\` | reference |
| S10 | Conclusão | \`audaar_check_in\` | check-in |

Modelo S1 — script fixo após consultar_reserva.
Modelo S9 — template dos 6 campos.
`;

test("compilePromptToIR produces versioned Prompt IR", () => {
  clearPromptIRCache();
  const ir = compilePromptToIR({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: HOTEL_PLAYBOOK } },
    userMessage: "pode consultar essa reserva QP7ZVTOG",
    availableToolNames: ["audaar_consultar_reserva", "embratur-reference", "audaar_check_in"],
  });
  assert.equal(ir.promptIrVersion, PROMPT_IR_VERSION);
  assert.ok(ir.metadata.hash.length >= 8);
  assert.ok(ir.metadata.playbookHash.length >= 8);
  assert.match(ir.objective, /check-in/i);
  assert.ok(ir.turnPatterns.length >= 5);
  assert.ok(ir.flows.length > 0);
  assert.ok(ir.flows[0]!.steps.length >= 2);
});

test("compilePromptToIR extracts policies from forbidden pairs", () => {
  const ir = compilePromptToIR({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: HOTEL_PLAYBOOK } },
    userMessage: "sim",
  });
  assert.ok(
    ir.policies.some((p) => p.kind === "forbidden_same_turn_pair"),
    "expected forbidden pair policy",
  );
  assert.ok(ir.forbiddenSameTurnPairs.length > 0);
});

test("promptIrToContract matches compilePromptContract", () => {
  const opts = {
    behaviorConfig: {
      promptBuilder: {
        blocks: {
          restrictions: "",
          tools: "",
          flows: "| C3 | check-in localizador | audaar_consultar_reserva |",
        },
      },
    },
    userMessage: "quero fazer check-in ABC12345",
  };
  const ir = compilePromptToIR(opts);
  const contract = compilePromptContract(opts);
  assert.ok(promptContractMatchesIr(contract, ir));
  assert.deepEqual(promptIrToContract(ir).requiredToolNames, contract.requiredToolNames);
});

test("compilePromptToIR is idempotent for same inputs", () => {
  const behaviorConfig = {
    promptBuilder: {
      userCore: "Objetivo: atender hóspedes.\nSempre use buscar_conhecimento para FAQ.",
    },
  };
  const a = compilePromptToIR({ behaviorConfig, userMessage: "wifi?" });
  const b = compilePromptToIR({ behaviorConfig, userMessage: "wifi?" });
  assert.equal(a.metadata.hash, b.metadata.hash);
  assert.deepEqual(a.tools.required, b.tools.required);
});

test("compileStaticPromptIR caches by playbook hash", () => {
  clearPromptIRCache();
  assert.equal(promptIRCacheSize(), 0);
  const behavior = { promptBuilder: { userCore: HOTEL_PLAYBOOK } };
  compileStaticPromptIR(behavior);
  assert.equal(promptIRCacheSize(), 1);
  compileStaticPromptIR(behavior);
  assert.equal(promptIRCacheSize(), 1);
});

test("summarizePlaybookIntent reports static extract", () => {
  const staticIr = compileStaticPromptIR({
    promptBuilder: { useFullPrompt: true, userCore: HOTEL_PLAYBOOK },
  });
  const summary = summarizePlaybookIntent(staticIr);
  assert.equal(summary.hasFlows, true);
  assert.ok(summary.flowStepCount >= 2);
  assert.ok(summary.policyCount >= 1);
});

test("compilePromptToIR extracts reply templates from playbook", () => {
  const ir = compilePromptToIR({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: HOTEL_PLAYBOOK } },
    userMessage: "oi",
  });
  assert.ok(ir.replyTemplates.some((t) => /s1|s9/i.test(t.label)));
});

test("buildTurnContext includes promptIr", async () => {
  const { buildTurnContext } = await import("../core/buildTurnContext.js");
  const ctx = buildTurnContext({
    turnId: "conv:msg",
    behaviorConfig: {
      promptBuilder: {
        blocks: {
          restrictions: "",
          tools: "",
          flows: "| C3 | check-in localizador | audaar_consultar_reserva |",
        },
      },
    },
    userMessage: "quero fazer check-in ABC12345",
  });
  assert.ok(ctx.promptIr);
  assert.equal(ctx.promptIr.promptIrVersion, PROMPT_IR_VERSION);
  assert.deepEqual(ctx.promptIr.tools.required, ctx.promptContract.requiredToolNames);
});
