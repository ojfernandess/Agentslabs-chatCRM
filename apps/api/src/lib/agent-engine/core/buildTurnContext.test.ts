import assert from "node:assert/strict";
import test from "node:test";
import { analyzeIntent, buildTurnContext } from "./buildTurnContext.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";

test("analyzeIntent detects knowledge query", () => {
  const turnPlan = buildExecutionTurnPlan({
    behaviorConfig: {},
    userMessage: "qual o horário do café?",
  });
  const intent = analyzeIntent("qual o horário do café?", {
    ...turnPlan,
    knowledgeSeeking: true,
  });
  assert.equal(intent.kind, "knowledge_query");
});

test("buildTurnContext produces execution contract with pending required tools", () => {
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
  assert.equal(ctx.version, 1);
  assert.ok(ctx.promptContract.requiredToolNames.includes("audaar_consultar_reserva"));
  assert.equal(ctx.executionContract.valid, false);
  assert.ok(
    ctx.executionContract.violations.some((v) => v.includes("audaar_consultar_reserva")),
  );
});

test("buildTurnContext marks contract valid when required tool executed", () => {
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
    toolOutcomes: [{ name: "audaar_consultar_reserva", ok: true, preview: "ok" }],
  });
  assert.equal(ctx.executionContract.valid, true);
  assert.deepEqual(ctx.executionContract.pendingToolNames, []);
});
