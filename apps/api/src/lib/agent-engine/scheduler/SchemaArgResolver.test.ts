import assert from "node:assert/strict";
import test from "node:test";
import { resolveSchemaToolArgs, outcomeHasLookupCapability } from "./SchemaArgResolver.js";
import { buildTurnContext } from "../core/buildTurnContext.js";
import { buildCapabilityGraph } from "../eil/CapabilityGraph.js";
import type { TurnContext } from "../core/types.js";

test("resolveSchemaToolArgs generic CRM tool uses facts only", () => {
  const ctx: TurnContext = {
    version: 1,
    userMessage: "criar pedido",
    intent: {
      kind: "operational_action",
      confidence: 0.8,
      entities: {},
      expectedGoal: "create_order",
    },
    promptIr: {} as TurnContext["promptIr"],
    promptContract: {} as TurnContext["promptContract"],
    turnPlan: {} as TurnContext["turnPlan"],
    executionContract: {} as TurnContext["executionContract"],
    eilEnabled: false,
    facts: { customerId: { key: "customerId", value: "C-42" } },
    availableToolNames: ["crm_create_order"],
  };
  const args = resolveSchemaToolArgs({ toolName: "crm_create_order", turnContext: ctx });
  assert.equal(args.customerId, "C-42");
});

test("outcomeHasLookupCapability uses structured payload without graph", () => {
  assert.equal(
    outcomeHasLookupCapability("any_tool", undefined, {
      reservationId: 1,
      checkinDate: "2026-08-01",
    }),
    true,
  );
});

test("outcomeHasLookupCapability uses capability graph lookup node", () => {
  const graph = buildCapabilityGraph({
    tools: [{ name: "consultar_reserva", config: { eil: { capabilities: ["lookup"] } } }],
  });
  assert.equal(outcomeHasLookupCapability("consultar_reserva", graph), true);
});

test("resolveSchemaToolArgs checkin nested mainGuest from session facts", () => {
  const ctx = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {},
    userMessage: "sim",
    availableToolNames: ["audaar_check_in"],
  });
  const enriched: TurnContext = {
    ...ctx,
    facts: {
      reservationId: { key: "reservationId", value: 279307 },
      documentNumber: { key: "documentNumber", value: "41026299802" },
      name: { key: "name", value: "João Silva" },
    },
  };
  const args = resolveSchemaToolArgs({ toolName: "audaar_check_in", turnContext: enriched });
  assert.equal(args.mode, "digital");
  assert.equal(args.reservationId, 279307);
  assert.equal((args.mainGuest as Record<string, unknown>).name, "João Silva");
});
