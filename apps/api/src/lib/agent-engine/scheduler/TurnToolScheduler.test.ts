import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduledToolArgs,
  formatScheduledToolsSystemAppendix,
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
  assert.equal(args.localizadorOuReservationId, "ABC12345");
  assert.equal(args.reservationIdOrLocalizer, "ABC12345");
});

test("buildScheduledToolArgs extracts locator from check-in phrase", () => {
  const ctx = stubTurnContext({
    userMessage: "fazer check-in na reserva HVW4V2D5",
    intent: {
      kind: "operational_action",
      confidence: 0.7,
      entities: {},
      expectedGoal: "complete_operational_flow",
    },
  });
  const args = buildScheduledToolArgs("audaar_consultar_reserva", ctx);
  assert.equal(args.localizadorOuReservationId, "HVW4V2D5");
  assert.equal(args.reservationIdOrLocalizer, "HVW4V2D5");
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

test("formatScheduledToolsSystemAppendix requires substantive use of structured facts", () => {
  const appendix = formatScheduledToolsSystemAppendix([
    {
      name: "audaar_consultar_reserva",
      ok: true,
      preview: "found",
      structuredPayload: {
        reservationId: 279264,
        checkinDate: "2026-07-31",
        checkoutDate: "2026-08-01",
      },
    },
  ]);
  assert.match(appendix, /OBRIGATÓRIO/i);
  assert.match(appendix, /substantiva/i);
  assert.match(appendix, /279264/);
  assert.match(appendix, /2026-07-31/);
  assert.match(appendix, /Proibido responder só que/);
  assert.match(appendix, /SCRIPT FIXO/i);
  assert.match(appendix, /Modelo S1/i);
});

test("buildScheduledToolArgs copies session facts for HTTP required fields", () => {
  const ctx = stubTurnContext({
    userMessage: "sim",
    intent: {
      kind: "confirmation",
      confidence: 0.9,
      entities: {},
      expectedGoal: "confirm_and_proceed",
    },
    facts: {
      reservationId: 279307,
      mainGuestId: 33051,
      documentNumber: "41026299802",
      __satisfiedToolNames: "embratur-reference",
    },
  });
  const args = buildScheduledToolArgs("audaar_check_in", ctx);
  assert.equal(args.reservationId, 279307);
  assert.equal(args.mainGuestId, 33051);
  assert.equal(args.documentNumber, "41026299802");
  assert.equal(args.__satisfiedToolNames, undefined);
  // Sem localizador string: usa reservationId numérico como reservationIdOrLocalizer.
  assert.equal(args.reservationIdOrLocalizer, "279307");
});

test("buildScheduledToolArgs maps session localizer aliases to reservationIdOrLocalizer on sim", () => {
  const ctx = stubTurnContext({
    userMessage: "sim",
    intent: {
      kind: "confirmation",
      confidence: 0.9,
      entities: {},
      expectedGoal: "confirm_and_proceed",
    },
    facts: {
      localizadorOuReservationId: "NCMT0VPN",
      reservationId: 279307,
    },
  });
  const args = buildScheduledToolArgs("audaar_check_in", ctx);
  assert.equal(args.reservationIdOrLocalizer, "NCMT0VPN");
  assert.equal(args.localizadorOuReservationId, "NCMT0VPN");
  assert.equal(args.reservationId, 279307);
});

test("formatScheduledToolsSystemAppendix forbids claiming success when tool failed", () => {
  const appendix = formatScheduledToolsSystemAppendix([
    {
      name: "audaar_check_in",
      ok: false,
      preview: '{"error":"schema_validation_failed","missingFields":["reservationId"]}',
    },
  ]);
  assert.match(appendix, /FALHOU/i);
  assert.match(appendix, /PROIBIDO dizer ao cliente que a operação foi concluída/i);
  assert.match(appendix, /schema_validation_failed/);
});

const C6_DISCOUNT_OFFER_MSG = `Entendo sua preocupação com o valor. Não posso conceder descontos por aqui, mas posso transferir você para nossa equipe de atendimento para verificar se há alguma condição especial disponível.

Deseja que eu faça essa transferência?`;

test("planScheduledToolInvocations schedules call_human on sim after C6 discount offer", () => {
  const ctx = buildTurnContext({
    turnId: "c6f-sim",
    behaviorConfig: {
      promptBuilder: {
        useFullPrompt: true,
        userCore: `
| C6f | Desconto pós-cotação | caro · desconto | sim → call_human | call_human |
| C6 | Cotação | cotação | GATE C6 | ZERO |
`,
      },
    },
    userMessage: "sim",
    lastAssistantMessage: C6_DISCOUNT_OFFER_MSG,
    availableToolNames: ["call_human"],
  });
  const plan = planScheduledToolInvocations(ctx, []);
  assert.deepEqual(
    plan.map((p) => p.toolName),
    ["call_human"],
  );
});
