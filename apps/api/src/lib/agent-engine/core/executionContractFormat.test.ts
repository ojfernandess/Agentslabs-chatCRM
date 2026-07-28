import assert from "node:assert/strict";
import test from "node:test";
import { buildTurnContext } from "./buildTurnContext.js";
import {
  executionContractRequiresBlock,
  executionContractViolationAlerts,
  formatExecutionContractForSupervisor,
} from "./executionContractFormat.js";

test("formatExecutionContractForSupervisor includes required and pending tools", () => {
  const ctx = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {
      promptBuilder: {
        blocks: {
          restrictions: "",
          tools: "",
          flows: "| C3 | check-in localizador | audaar_consultar_reserva |",
        },
      },
    },
    userMessage: "check-in ABC12345",
  });
  const summary = formatExecutionContractForSupervisor(ctx.executionContract);
  assert.match(summary, /audaar_consultar_reserva/);
  assert.match(summary, /pendentes/i);
});

test("executionContractViolationAlerts maps required_tool_missing", () => {
  const alerts = executionContractViolationAlerts({
    version: 1,
    turnId: "t1",
    userMessage: "x",
    objective: "y",
    planPhase: "tooling",
    requiredToolNames: ["foo"],
    forbiddenToolNames: [],
    pendingToolNames: ["foo"],
    satisfiedToolNames: [],
    requiredFacts: [],
    existingFacts: [],
    constraints: [],
    completionCriteria: [],
    valid: false,
    violations: ["required_tool_missing:foo"],
  });
  assert.ok(alerts.some((a) => /foo/.test(a)));
  assert.equal(
    executionContractRequiresBlock({
      version: 1,
      turnId: "t1",
      userMessage: "x",
      objective: "y",
      planPhase: "tooling",
      requiredToolNames: ["foo"],
      forbiddenToolNames: [],
      pendingToolNames: ["foo"],
      satisfiedToolNames: [],
      requiredFacts: [],
      existingFacts: [],
      constraints: [],
      completionCriteria: [],
      valid: false,
      violations: ["required_tool_missing:foo"],
    }),
    true,
  );
});
