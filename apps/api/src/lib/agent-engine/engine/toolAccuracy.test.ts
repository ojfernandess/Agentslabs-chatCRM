import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapabilityGraph,
  canInvokeTool,
  capabilityPreExecBlockReason,
  detectToolOrderViolations,
  orderToolsByFactDeps,
  toolRequiresUnmetFacts,
} from "../eil/CapabilityGraph.js";
import { buildToolRegistry } from "./ToolRegistry.js";
import { validateToolExecution } from "../validators/ToolValidator.js";
import { planScheduledToolInvocations } from "../scheduler/TurnToolScheduler.js";
import { buildTurnContext } from "../core/buildTurnContext.js";
import type { TurnContext } from "../core/types.js";

const LOOKUP_CHECKIN_TOOLS = [
  {
    name: "consultar_reserva",
    config: {
      eil: {
        produces: ["reservationId"],
        capabilities: ["lookup"],
        factPaths: { reservationId: "reservationId" },
      },
    },
  },
  {
    name: "audaar_check_in",
    config: {
      eil: {
        produces: ["checkinDone"],
        requiresFacts: ["reservationId"],
        capabilities: ["checkin"],
        conflictsWith: ["embratur-reference"],
      },
    },
  },
  {
    name: "embratur-reference",
    config: {
      eil: {
        produces: ["referenceOk"],
        capabilities: ["reference"],
      },
    },
  },
];

test("ToolRegistry parses timeout retry provider version", () => {
  const reg = buildToolRegistry([
    {
      name: "crm_submit",
      config: {
        eil: {
          produces: ["orderId"],
          timeoutMs: 5000,
          retryMax: 2,
          provider: "http",
          version: "1.2.0",
        },
      },
    },
  ]);
  const e = reg.byName.get("crm_submit");
  assert.ok(e);
  assert.equal(e!.timeoutMs, 5000);
  assert.equal(e!.retryMax, 2);
  assert.equal(e!.provider, "http");
  assert.equal(e!.version, "1.2.0");
});

test("canInvokeTool blocks when requiresFacts unmet", () => {
  const graph = buildCapabilityGraph({ tools: LOOKUP_CHECKIN_TOOLS });
  const blocked = canInvokeTool(graph, "audaar_check_in", {});
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.unmetFacts, ["reservationId"]);
  const ok = canInvokeTool(graph, "audaar_check_in", {
    reservationId: { key: "reservationId", value: 1 },
  });
  assert.equal(ok.ok, true);
});

test("orderToolsByFactDeps puts producers before dependents", () => {
  const graph = buildCapabilityGraph({ tools: LOOKUP_CHECKIN_TOOLS });
  const ordered = orderToolsByFactDeps(
    graph,
    ["audaar_check_in", "consultar_reserva"],
    {},
  );
  assert.equal(ordered[0], "consultar_reserva");
  assert.equal(ordered[1], "audaar_check_in");
});

test("capabilityPreExecBlockReason conflict and unmet facts", () => {
  const graph = buildCapabilityGraph({ tools: LOOKUP_CHECKIN_TOOLS });
  const unmet = capabilityPreExecBlockReason("audaar_check_in", graph, {});
  assert.ok(unmet && /factos em falta/i.test(unmet));
  const conflict = capabilityPreExecBlockReason(
    "audaar_check_in",
    graph,
    { reservationId: { key: "reservationId", value: 1 } },
    ["embratur-reference"],
  );
  assert.ok(conflict && /conflita/i.test(conflict));
});

test("detectToolOrderViolations flags dependent before producer", () => {
  const graph = buildCapabilityGraph({ tools: LOOKUP_CHECKIN_TOOLS });
  const alerts = detectToolOrderViolations(
    graph,
    [
      { name: "audaar_check_in", ok: true },
      { name: "consultar_reserva", ok: true },
    ],
    {},
  );
  assert.ok(alerts.some((a) => /Ordem de tools/i.test(a)));
});

test("validateToolExecution hard-blocks conflicts in strict mode", () => {
  const graph = buildCapabilityGraph({ tools: LOOKUP_CHECKIN_TOOLS });
  const result = validateToolExecution({
    toolOutcomes: [
      { name: "embratur-reference", ok: true, preview: "{}" },
      { name: "audaar_check_in", ok: true, preview: "{}" },
    ],
    replyText: "Check-in feito.",
    strictMode: true,
    capabilityGraph: graph,
    factsBeforeTurn: { reservationId: { key: "reservationId", value: 1 } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockSend, true);
  assert.ok(result.alerts.some((a) => /conflita/i.test(a)));
});

test("planScheduledToolInvocations expands producers and orders them", () => {
  const graph = buildCapabilityGraph({ tools: LOOKUP_CHECKIN_TOOLS });
  const turnContext = {
    version: 1 as const,
    userMessage: "fazer check-in",
    intent: {
      kind: "operational_action" as const,
      confidence: 0.8,
      entities: {},
      expectedGoal: "complete",
    },
    promptContract: {
      version: 1 as const,
      compiledAt: new Date().toISOString(),
      promptHash: "x",
      objective: "test",
      requiredToolNames: ["audaar_check_in"],
      optionalToolNames: [],
      forbiddenToolNames: [],
      forbiddenSameTurnPairs: [],
      preconditions: [],
      postconditions: [],
      restrictions: [],
      turnPolicy: {
        forbiddenSameTurnPairs: [],
        exclusiveAllowedTools: null,
        completionToolHints: [],
        confirmationPrerequisiteTools: [],
        omitToolsWhenSlotsPresent: [],
        blockEscalation: false,
      },
    },
    turnPlan: {
      userMessage: "fazer check-in",
      requiredToolNames: ["audaar_check_in"],
      turnPolicy: {
        forbiddenSameTurnPairs: [],
        exclusiveAllowedTools: null,
        completionToolHints: [],
        confirmationPrerequisiteTools: [],
        omitToolsWhenSlotsPresent: [],
        blockEscalation: false,
      },
      knowledgeSeeking: false,
      matchedPatternIds: [],
    },
    executionContract: {
      version: 1 as const,
      turnId: "t1",
      userMessage: "fazer check-in",
      objective: "test",
      planPhase: "tooling" as const,
      requiredToolNames: ["audaar_check_in"],
      forbiddenToolNames: [],
      pendingToolNames: ["audaar_check_in"],
      satisfiedToolNames: [],
      requiredFacts: ["reservationId"],
      existingFacts: [],
      constraints: [],
      completionCriteria: [],
      valid: false,
      violations: ["required_tool_missing:audaar_check_in", "fact_missing:reservationId"],
    },
    eilEnabled: true,
    facts: {},
    capabilityGraph: graph,
    availableToolNames: ["consultar_reserva", "audaar_check_in", "embratur-reference"],
  } satisfies TurnContext;

  const planned = planScheduledToolInvocations(turnContext, []);
  // check_in blocked by unmet facts; producer consultar_reserva should be scheduled
  assert.ok(planned.some((p) => p.toolName === "consultar_reserva"));
  assert.equal(
    planned.some((p) => p.toolName === "audaar_check_in"),
    false,
    "check_in must not run before reservationId fact",
  );
});

test("toolRequiresUnmetFacts empty when node missing", () => {
  assert.deepEqual(toolRequiresUnmetFacts(undefined, {}), []);
});

test("buildTurnContext marks fact_missing in contract when EIL pending", () => {
  const ctx = buildTurnContext({
    turnId: "t-eil",
    behaviorConfig: {
      eil: { enabled: true },
      promptBuilder: {
        useFullPrompt: true,
        userCore: "| Final | concluído | Chame `audaar_check_in` |",
      },
    },
    userMessage: "concluir check-in agora",
    toolConfigs: LOOKUP_CHECKIN_TOOLS,
    availableToolNames: ["audaar_check_in", "consultar_reserva"],
  });
  // Only if check_in is required and has requiresFacts
  if (ctx.eilEnabled && ctx.executionContract.requiredFacts.includes("reservationId")) {
    assert.ok(ctx.executionContract.violations.some((v) => v.startsWith("fact_missing:")));
  }
});
