import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareTurnContextShadow,
  compareTurnContextCritical,
  resolveSpineTurnContext,
  resolveUnifiedSpineMode,
  requiresLegacyTurnContextBuilder,
  isSpineOnlyMode,
  shouldUseEngineTurnContext,
  UnifiedSpineSession,
} from "./UnifiedSpineBridge.js";
import { DEFAULT_AGENT_ENGINE_CONFIG } from "../types.js";
import { buildTurnContext } from "../core/buildTurnContext.js";
import type { AgentRuntimeExecuteInput } from "../types.js";

test("resolveUnifiedSpineMode defaults to off", () => {
  assert.equal(resolveUnifiedSpineMode({ ...DEFAULT_AGENT_ENGINE_CONFIG }), "off");
});

test("resolveUnifiedSpineMode reads config", () => {
  assert.equal(
    resolveUnifiedSpineMode({ ...DEFAULT_AGENT_ENGINE_CONFIG, unifiedSpineMode: "shadow" }),
    "shadow",
  );
});

test("shouldUseEngineTurnContext true for primary and only", () => {
  assert.equal(shouldUseEngineTurnContext("primary"), true);
  assert.equal(shouldUseEngineTurnContext("only"), true);
  assert.equal(shouldUseEngineTurnContext("shadow"), false);
});

test("compareTurnContextShadow detects promptHash mismatch", () => {
  const base = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {
      promptBuilder: { userCore: "Chame `tool_a` quando necessário." },
    },
    userMessage: "preciso de tool_a",
  });
  const other = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {
      promptBuilder: { userCore: "Chame `tool_b` quando necessário." },
    },
    userMessage: "preciso de tool_b",
  });
  const report = compareTurnContextShadow(base, other);
  assert.equal(report.equivalent, false);
  assert.ok(report.diffs.length > 0);
  assert.ok(
    report.diffs.some(
      (d) => d.includes("requiredTools") || d.includes("promptHash") || d.includes("pendingTools"),
    ),
  );
});

test("compareTurnContextCritical ignores promptHash-only mismatch", () => {
  const base = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {
      promptBuilder: { userCore: "Chame `tool_a` quando necessário." },
    },
    userMessage: "preciso de tool_a",
  });
  const other = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {
      promptBuilder: { userCore: "Chame `tool_b` quando necessário." },
    },
    userMessage: "preciso de tool_b",
  });
  const full = compareTurnContextShadow(base, other);
  const critical = compareTurnContextCritical(base, other);
  assert.equal(full.equivalent, false);
  assert.equal(critical.equivalent, true);
});

test("resolveSpineTurnContext primary uses engine when critically equivalent", () => {
  const ctx = buildTurnContext({
    turnId: "t1",
    behaviorConfig: { promptBuilder: { userCore: "Fluxo simples." } },
    userMessage: "oi",
  });
  const resolution = resolveSpineTurnContext({
    mode: "primary",
    engineContext: ctx,
    legacyBuilder: () => ctx,
    fallbackActive: false,
  });
  assert.equal(resolution.source, "engine");
  assert.equal(resolution.fallbackActivated, false);
});

test("resolveSpineTurnContext primary falls back on pending tools mismatch", () => {
  const engine = buildTurnContext({
    turnId: "t1",
    behaviorConfig: {
      promptBuilder: { userCore: "Fluxo check-in." },
    },
    userMessage: "sim confirmo",
  });
  const legacy = structuredClone(engine);
  legacy.executionContract = {
    ...legacy.executionContract,
    pendingToolNames: ["check_in", "embratur-reference"],
  };
  let fallbackCalled = false;
  const resolution = resolveSpineTurnContext({
    mode: "primary",
    engineContext: engine,
    legacyBuilder: () => legacy,
    fallbackActive: false,
    onPrimaryFallback: () => {
      fallbackCalled = true;
    },
  });
  assert.equal(fallbackCalled, true);
  assert.equal(resolution.source, "legacy");
  assert.equal(resolution.fallbackActivated, true);
  assert.deepEqual(resolution.context.executionContract.pendingToolNames, [
    "check_in",
    "embratur-reference",
  ]);
});

test("resolveSpineTurnContext only never falls back", () => {
  const engine = buildTurnContext({
    turnId: "t1",
    behaviorConfig: { promptBuilder: { userCore: "A" } },
    userMessage: "x",
  });
  const legacy = buildTurnContext({
    turnId: "t1",
    behaviorConfig: { promptBuilder: { userCore: "B" } },
    userMessage: "y",
  });
  const resolution = resolveSpineTurnContext({
    mode: "only",
    engineContext: engine,
    legacyBuilder: () => legacy,
    fallbackActive: false,
  });
  assert.equal(resolution.source, "engine");
  assert.equal(resolution.context.userMessage, "x");
});

test("UnifiedSpineSession primary uses engine turn context when equivalent", () => {
  const input = {
    organizationId: "org",
    bot: { id: "bot" } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: "conv" } as AgentRuntimeExecuteInput["conversation"],
    message: { id: "msg", body: "sim", direction: "INBOUND" } as AgentRuntimeExecuteInput["message"],
    log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as AgentRuntimeExecuteInput["log"],
    engineConfig: { ...DEFAULT_AGENT_ENGINE_CONFIG, unifiedSpineMode: "primary" },
    llmConfig: {},
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: "Confirmação: chame `embratur-reference`." },
    },
  } satisfies AgentRuntimeExecuteInput;

  const session = UnifiedSpineSession.begin({ input, memory: {} });
  assert.equal(session.mode, "primary");

  const legacy = buildTurnContext({
    turnId: "conv:msg",
    behaviorConfig: input.behaviorConfig,
    userMessage: "sim",
  });
  const resolved = session.resolveTurnContext(() => legacy);
  assert.equal(session.lastResolutionSource, "engine");
  assert.equal(resolved.turnId, legacy.turnId);
});

test("requiresLegacyTurnContextBuilder false for only", () => {
  assert.equal(requiresLegacyTurnContextBuilder("only"), false);
  assert.equal(requiresLegacyTurnContextBuilder("primary"), true);
  assert.equal(isSpineOnlyMode("only"), true);
});

test("UnifiedSpineSession only skips legacy builder", () => {
  const input = {
    organizationId: "org",
    bot: { id: "bot" } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: "conv" } as AgentRuntimeExecuteInput["conversation"],
    message: { id: "msg", body: "sim", direction: "INBOUND" } as AgentRuntimeExecuteInput["message"],
    log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as AgentRuntimeExecuteInput["log"],
    engineConfig: { ...DEFAULT_AGENT_ENGINE_CONFIG, unifiedSpineMode: "only" },
    llmConfig: {},
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: "Confirmação: chame `embratur-reference`." },
    },
  } satisfies AgentRuntimeExecuteInput;

  const session = UnifiedSpineSession.begin({ input, memory: {} });
  assert.equal(session.mode, "only");
  const resolved = session.resolveTurnContext(undefined);
  assert.equal(session.lastResolutionSource, "engine");
  assert.ok(resolved.promptIr);
  assert.equal(resolved, session.resolveEngineTurnContext());
});

test("UnifiedSpineSession shadow keeps legacy turn context", () => {
  const input = {
    organizationId: "org",
    bot: { id: "bot" } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: "conv" } as AgentRuntimeExecuteInput["conversation"],
    message: { id: "msg", body: "sim", direction: "INBOUND" } as AgentRuntimeExecuteInput["message"],
    log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as AgentRuntimeExecuteInput["log"],
    engineConfig: { ...DEFAULT_AGENT_ENGINE_CONFIG, unifiedSpineMode: "shadow" },
    llmConfig: {},
    behaviorConfig: {
      promptBuilder: { useFullPrompt: true, userCore: "Confirmação: chame `embratur-reference`." },
    },
  } satisfies AgentRuntimeExecuteInput;

  const session = UnifiedSpineSession.begin({ input, memory: {} });
  assert.equal(session.mode, "shadow");
  assert.ok(session.engineState);

  const legacy = buildTurnContext({
    turnId: "conv:msg",
    behaviorConfig: input.behaviorConfig,
    userMessage: "sim",
  });
  const resolved = session.resolveTurnContext(() => legacy);
  assert.deepEqual(resolved.promptContract.requiredToolNames, legacy.promptContract.requiredToolNames);
});

test("UnifiedSpineSession off has no engine state", () => {
  const input = {
    organizationId: "org",
    bot: { id: "bot" } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: "conv" } as AgentRuntimeExecuteInput["conversation"],
    message: { id: "msg", body: "oi", direction: "INBOUND" } as AgentRuntimeExecuteInput["message"],
    log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as AgentRuntimeExecuteInput["log"],
    engineConfig: { ...DEFAULT_AGENT_ENGINE_CONFIG, unifiedSpineMode: "off" },
    llmConfig: {},
    behaviorConfig: {},
  } satisfies AgentRuntimeExecuteInput;
  const session = UnifiedSpineSession.begin({ input });
  assert.equal(session.engineState, null);
});
