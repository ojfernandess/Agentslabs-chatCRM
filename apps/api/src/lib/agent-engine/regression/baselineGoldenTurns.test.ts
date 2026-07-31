/**
 * Regression suite — Fase 0 baseline.
 *
 * Golden turns que capturam comportamento actual antes da reconstrução
 * Prompt → IR → Unified Spine. Qualquer refactor deve manter estes invariantes
 * até a migração explícita por fase (ver PATCH-REGISTRY.md).
 *
 * Executar:
 *   node --import tsx --test src/lib/agent-engine/regression/baselineGoldenTurns.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compilePromptContract } from "../compiler/PromptCompiler.js";
import { buildExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import { buildUnifiedExecutionPlan } from "../planner/UnifiedExecutionPlanner.js";
import { buildTurnContext } from "../core/buildTurnContext.js";
import { compareTurnContextCritical } from "../runtime/UnifiedSpineBridge.js";
import { sharedExecutionEngine } from "../engine/index.js";
import { DEFAULT_AGENT_ENGINE_CONFIG } from "../types.js";
import type { AgentRuntimeExecuteInput } from "../types.js";
import { planScheduledToolInvocations } from "../scheduler/TurnToolScheduler.js";
import { ensureDeliveringReply } from "../reply/ReplySynthesizer.js";
import { resolveTurnPolicy } from "../validators/turnPolicyParser.js";
import { GENERIC_TURN_PATTERNS } from "../validators/requiredToolNamesParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_MANIFEST = join(__dirname, "baselineManifest.json");

/** Playbook mínimo partilhado com turnPolicyParser.test.ts */
const SAMPLE_PLAYBOOK = `
## Regras
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno

| Passo | Acção | Tools |
| N=1 → S9 | só \`embratur-reference\` | reference |
| S10 | check-in | \`audaar_check_in\` |
Confirmação: após OK do titular chame \`embratur-reference\` antes de \`audaar_check_in\`.
`;

const RESERVATION_PAYLOAD = {
  found: true,
  uid: "NCMT0VPN",
  establishmentName: "Vivá Porto de Galinhas",
  checkinDate: "2026-08-01",
  checkoutDate: "2026-08-03",
  guestsQuantity: 2,
};

type GoldenManifest = {
  version: string;
  phase: number;
  metrics: {
    agentNativeLlmLines: number;
    patchesCatalogued: number;
    unitTestsInSuite: number;
  };
  goldenTurns: Array<{ id: string; description: string; phase: string }>;
};

test("baseline manifest loads and matches Fase 3 metrics", () => {
  const manifest = JSON.parse(readFileSync(BASELINE_MANIFEST, "utf8")) as GoldenManifest;
  assert.equal(manifest.phase, 9);
  assert.equal(manifest.metrics.patchesCatalogued, 47);
  assert.ok(manifest.goldenTurns.length >= 10);
});

test("G-001 C2/C3 localizador requires consultar_reserva", () => {
  const plan = buildExecutionTurnPlan({
    behaviorConfig: {
      promptBuilder: {
        useFullPrompt: true,
        userCore: `
| C2 | Verificar | consultar + localizador | Chame \`audaar_consultar_reserva\` |
| C8 | CPF | 11 dígitos | Chame \`audaar_consultar_main_guest\` |
Sempre use buscar_conhecimento. Chame \`audaar_check_in\`.
`,
      },
    },
    userMessage: "pode consultar essa reserva QP7ZVTOG",
  });
  assert.ok(plan.requiredToolNames.some((n) => /consultar_reserva/i.test(n)));
  assert.ok(plan.matchedPatternIds.includes("checkin_or_reservation"));
});

test("G-002 confirmation sim with embratur gate requires exclusive S9", () => {
  const plan = buildExecutionTurnPlan({
    behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    userMessage: "sim",
  });
  assert.ok(plan.requiredToolNames.some((t) => /embratur|reference/i.test(t)));
  assert.equal(plan.turnPolicy.exclusiveAllowedTools?.length ?? 0, 1);
});

test("G-003 buildTurnContext produces execution contract with compiler hash", () => {
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
  assert.ok(ctx.promptContract.promptHash.length >= 8);
  assert.ok(ctx.executionContract);
  assert.ok(ctx.turnPlan);
});

test("G-004 scheduler plans required tools from contract", () => {
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
    availableToolNames: ["audaar_consultar_reserva"],
  });
  const scheduled = planScheduledToolInvocations(ctx, []);
  assert.ok(Array.isArray(scheduled));
});

test("G-005 ensureDeliveringReply synthesizes reservation template after consultar_reserva", () => {
  const result = ensureDeliveringReply({
    replyText: "Vou consultar… Um momento…",
    userMessage: "fazer check-in na reserva NCMT0VPN",
    toolOutcomes: [
      {
        name: "audaar_consultar_reserva",
        ok: true,
        preview: JSON.stringify(RESERVATION_PAYLOAD),
        structuredPayload: RESERVATION_PAYLOAD,
      },
    ],
  });
  assert.equal(result.replaced, true);
  assert.ok(result.reason === "reservation_s1" || result.reason === "ir_template");
  assert.match(result.reply, /Encontramos sua reserva/);
});

test("G-006 GENERIC_TURN_PATTERNS includes checkin_or_reservation", () => {
  const pattern = GENERIC_TURN_PATTERNS.find((p) => p.id === "checkin_or_reservation");
  assert.ok(pattern);
  assert.ok(pattern!.test("Quero fazer check-in com localizador ABC12345"));
});

test("G-007 prompt compiler extracts objective from playbook", () => {
  const contract = compilePromptContract({
    behaviorConfig: {
      promptBuilder: {
        userCore: "## Objetivo\nRealizar check-in digital.\n\n## Restrições\nNunca inventar dados.",
      },
    },
    userMessage: "oi",
    availableToolNames: [],
  });
  assert.match(contract.objective, /check-in/i);
});

test("G-008 ficha confirm forces check_in exclusive (HJ2XQZXO-FICHA invariant)", () => {
  const ficha =
    "Confira a ficha de viagem:\n• Motivo da viagem: Congresso\nConfirme os dados da ficha.";
  const policy = resolveTurnPolicy(
    { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    {
      userMessage: "sim",
      priorToolOutcomes: [],
      lastAssistantMessage: ficha,
      availableToolNames: ["embratur-reference", "audaar_check_in"],
    },
  );
  assert.ok(
    policy.exclusiveAllowedTools?.some((t) => /check[_-]?in/i.test(t)),
    `expected exclusive check_in, got ${JSON.stringify(policy.exclusiveAllowedTools)}`,
  );
});

test("G-009 ExecutionEngine beginTurn critically matches buildTurnContext (spine parity)", () => {
  const behaviorConfig = {
    promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
  };
  const userMessage = "NCMT0VPN";
  const input = {
    organizationId: "org",
    bot: { id: "bot" } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: "conv" } as AgentRuntimeExecuteInput["conversation"],
    message: { id: "msg", body: userMessage, direction: "INBOUND" } as AgentRuntimeExecuteInput["message"],
    log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as AgentRuntimeExecuteInput["log"],
    engineConfig: { ...DEFAULT_AGENT_ENGINE_CONFIG, unifiedSpineMode: "shadow" },
    llmConfig: {},
    behaviorConfig,
  } satisfies AgentRuntimeExecuteInput;
  const engineState = sharedExecutionEngine.beginTurn({ input, memory: {} });
  const legacy = buildTurnContext({
    turnId: "conv:msg",
    behaviorConfig,
    userMessage,
  });
  const report = compareTurnContextCritical(legacy, engineState.turnContext);
  assert.equal(
    report.equivalent,
    true,
    report.diffs.join("; ") || "engine vs legacy critical mismatch",
  );
});

test("G-010 unified planner parity with legacy turn plan (SAMPLE_PLAYBOOK)", () => {
  const behaviorConfig = {
    promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK },
  };
  const opts = {
    behaviorConfig,
    userMessage: "NCMT0VPN",
    availableToolNames: ["audaar_consultar_reserva", "embratur-reference", "audaar_check_in"],
    priorToolOutcomes: [],
  };
  const legacy = buildExecutionTurnPlan(opts);
  const unified = buildUnifiedExecutionPlan(opts);
  assert.deepEqual(
    [...unified.requiredToolNames].sort(),
    [...legacy.requiredToolNames].sort(),
  );
  assert.deepEqual(
    unified.turnPolicy.exclusiveAllowedTools?.sort(),
    legacy.turnPolicy.exclusiveAllowedTools?.sort(),
  );
  assert.ok(unified.promptIrHash);
  assert.ok(unified.planGraph);
});
