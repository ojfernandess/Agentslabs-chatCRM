import assert from "node:assert/strict";
import test from "node:test";
import {
  routeStructuralViolations,
  routeSupervisorCheckFailure,
  routeViolationsFromContract,
} from "./ViolationRouter.js";

test("routeViolationsFromContract maps required_tool_missing to scheduler", () => {
  const routed = routeViolationsFromContract({
    version: 1,
    turnId: "t1",
    userMessage: "x",
    objective: "test",
    planPhase: "tooling",
    requiredToolNames: ["consultar_reserva"],
    forbiddenToolNames: [],
    pendingToolNames: ["consultar_reserva"],
    satisfiedToolNames: [],
    requiredFacts: [],
    existingFacts: [],
    constraints: [],
    completionCriteria: [],
    valid: false,
    violations: ["required_tool_missing:consultar_reserva"],
  });
  assert.equal(routed[0]?.layer, "scheduler");
  assert.equal(routed[0]?.component, "TurnToolScheduler");
});

test("routeSupervisorCheckFailure maps eil_constraints to policy", () => {
  const routed = routeSupervisorCheckFailure("eil_constraints", "party policy");
  assert.equal(routed.layer, "policy");
  assert.match(routed.rcaHint, /PolicyRule|constraints EIL/i);
});

test("routeStructuralViolations deduplicates", () => {
  const routed = routeStructuralViolations({
    executionContract: {
      version: 1,
      turnId: "t1",
      userMessage: "x",
      objective: "test",
      planPhase: "tooling",
      requiredToolNames: [],
      forbiddenToolNames: [],
      pendingToolNames: [],
      satisfiedToolNames: [],
      requiredFacts: [],
      existingFacts: [],
      constraints: [],
      completionCriteria: [],
      valid: false,
      violations: ["required_tool_missing:x"],
    },
    failedCheckIds: [{ id: "required_tools_contract" }],
  });
  assert.ok(routed.length >= 2);
});
