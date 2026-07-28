import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduledToolArgs,
  planScheduledToolInvocations,
  shouldRunToolScheduler,
} from "./TurnToolScheduler.js";
import type { TurnContext } from "../core/types.js";
import { buildTurnContext } from "../core/buildTurnContext.js";

function stubTurnContext(overrides: Partial<TurnContext> = {}): TurnContext {
  const base = buildTurnContext({
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
  return { ...base, ...overrides };
}

test("planScheduledToolInvocations returns pending required tools", () => {
  const ctx = stubTurnContext();
  const plan = planScheduledToolInvocations(ctx, []);
  assert.ok(plan.some((p) => p.toolName === "audaar_consultar_reserva"));
  assert.equal(plan[0]?.reason, "execution_contract_required");
});

test("planScheduledToolInvocations skips satisfied tools", () => {
  const ctx = stubTurnContext();
  const plan = planScheduledToolInvocations(ctx, [
    { name: "audaar_consultar_reserva", ok: true },
  ]);
  assert.equal(plan.length, 0);
});

test("buildScheduledToolArgs maps reference entity for HTTP tools", () => {
  const ctx = stubTurnContext({
    intent: {
      kind: "operational_action",
      confidence: 0.8,
      entities: { referenceCode: "ABC12345" },
      expectedGoal: "complete_operational_flow",
    },
  });
  const args = buildScheduledToolArgs("audaar_consultar_reserva", ctx);
  assert.equal(args.localizador, "ABC12345");
});

test("buildScheduledToolArgs uses user message for buscar_conhecimento", () => {
  const ctx = stubTurnContext({ userMessage: "horário do café?" });
  const args = buildScheduledToolArgs("buscar_conhecimento", ctx);
  assert.equal(args.query, "horário do café?");
});

test("shouldRunToolScheduler respects feature flag and reply-only retry", () => {
  assert.equal(
    shouldRunToolScheduler({ schedulerEnabled: false } as never, undefined),
    false,
  );
  assert.equal(
    shouldRunToolScheduler({ schedulerEnabled: true } as never, { replyOnlyRetry: true }),
    false,
  );
  assert.equal(
    shouldRunToolScheduler({ schedulerEnabled: true } as never, undefined),
    true,
  );
});
