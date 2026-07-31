import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTurnContext } from "../core/buildTurnContext.js";
import { packTurnContextForLlm } from "./TurnContextPacker.js";
import { filterToolsForCurrentStep } from "./FilteredToolCatalog.js";
import { evaluateLlmToolSandbox } from "./LlmToolSandbox.js";

test("packTurnContextForLlm excludes full playbook", () => {
  const ctx = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {
      promptBuilder: {
        useFullPrompt: true,
        userCore: "## Objetivo\nCheck-in digital.\n".repeat(200),
      },
    },
    userMessage: "NCMT0VPN",
    availableToolNames: ["audaar_consultar_reserva", "audaar_check_in"],
  });
  const packed = packTurnContextForLlm(ctx);
  assert.match(packed.systemSlice, /Objetivo do passo actual/);
  assert.match(packed.systemSlice, /Factos conhecidos/);
  assert.ok(packed.systemSlice.length < ctx.promptIr.metadata.playbookCharCount);
  assert.ok(packed.allowedToolNames.length >= 1);
});

test("filterToolsForCurrentStep respects pending tools", () => {
  const ctx = buildTurnContext({
    turnId: "t2",
    behaviorConfig: {
      promptBuilder: {
        blocks: { flows: "| C3 | lookup | audaar_consultar_reserva |" },
      },
    },
    userMessage: "ABC12345",
    availableToolNames: ["audaar_consultar_reserva", "audaar_check_in", "buscar_conhecimento"],
  });
  const filtered = filterToolsForCurrentStep(ctx.availableToolNames, ctx);
  assert.ok(filtered.includes("audaar_consultar_reserva") || filtered.length === ctx.availableToolNames.length);
});

test("evaluateLlmToolSandbox blocks forbidden tool", () => {
  const ctx = buildTurnContext({
    turnId: "t3",
    behaviorConfig: {},
    userMessage: "sim",
    availableToolNames: ["tool_a", "tool_b"],
  });
  ctx.executionContract.forbiddenToolNames = ["tool_b"];
  const decision = evaluateLlmToolSandbox("tool_b", ctx);
  assert.equal(decision.allowed, false);
  assert.equal(decision.layer, "policy");
});
