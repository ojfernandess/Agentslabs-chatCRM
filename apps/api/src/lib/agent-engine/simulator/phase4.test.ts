import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";
import {
  clearOtelSpansForTests,
  getRecentOtelSpans,
  buildOtelSpansFromTrace,
  ingestAgentTraceToOtel,
} from "../observability/OtelBridge.js";
import {
  isMemoryExpired,
  packMemoryForPrompt,
  resolveMemoryPriority,
} from "../memory/MemoryBudgetPacker.js";
import { normalizeMemoryRecord } from "../memory/memoryEngineTypes.js";
import { estimatePromptTokenBudget } from "./TokenBudget.js";
import { simulateAgentTurn } from "./AgentTurnSimulator.js";
import { DEFAULT_AGENT_ENGINE_CONFIG } from "../types.js";
import { parseAgentEngineConfig } from "../config/parseAgentEngineConfig.js";

beforeEach(() => {
  clearOtelSpansForTests();
});

describe("MemoryBudgetPacker", () => {
  test("drops expired temporary by TTL metadata", () => {
    const expired = normalizeMemoryRecord({
      text: "old temp",
      scope: "temporary",
      metadata: { ttlExpiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const fresh = normalizeMemoryRecord({
      text: "fresh",
      scope: "temporary",
      status: "pinned",
    });
    assert.equal(isMemoryExpired(expired, Date.now(), 0), true);
    const packed = packMemoryForPrompt(
      { temporary: [expired, fresh], contact: [], agent: [], global: [] },
      { promptTokenBudget: 500 },
    );
    assert.equal(packed.expiredIds.includes(expired.id), true);
    assert.equal(packed.records.some((r) => r.id === fresh.id), true);
  });

  test("respects token budget and prefers higher priority", () => {
    const low = normalizeMemoryRecord({
      text: "x".repeat(400),
      scope: "contact",
      score: 0.2,
      metadata: { priority: 10 },
    });
    const high = normalizeMemoryRecord({
      text: "important fact",
      scope: "contact",
      status: "pinned",
    });
    assert.ok(resolveMemoryPriority(high) > resolveMemoryPriority(low));
    const packed = packMemoryForPrompt(
      { temporary: [], contact: [low, high], agent: [], global: [] },
      { promptTokenBudget: 80 },
    );
    assert.equal(packed.records[0]?.id, high.id);
    assert.equal(packed.truncated, true);
    assert.ok(packed.tokensUsed <= packed.tokensBudget);
  });
});

describe("TokenBudget", () => {
  test("reports memory pressure", () => {
    const r = estimatePromptTokenBudget({
      userMessage: "hello world",
      memoryTokens: 900,
      memoryBudget: 800,
      pendingTools: 2,
    });
    assert.equal(r.overMemoryBudget, true);
    assert.ok(r.memoryPressure > 1);
    assert.ok(r.estimatedPromptTokens > 900);
  });
});

describe("OtelBridge", () => {
  test("builds spans from execution trace", async () => {
    const spans = buildOtelSpansFromTrace({
      runtime: "openconduit",
      memory: "openconduit",
      strictMode: false,
      observability: "basic",
      nodes: [
        {
          id: "load_memory",
          name: "mem",
          status: "ok",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        },
      ],
      errors: [],
    });
    assert.ok(spans.length >= 2);
    assert.equal(spans[0]?.name, "agent.openconduit.turn");
    assert.equal(spans[1]?.layer, "memory");

    const result = await ingestAgentTraceToOtel(spans.length
      ? {
          runtime: "langgraph",
          memory: "openconduit",
          strictMode: true,
          observability: "full",
          nodes: [
            {
              id: "schedule_tools",
              name: "sched",
              status: "ok",
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
            },
          ],
          errors: [],
        }
      : {
          runtime: "langgraph",
          memory: "openconduit",
          strictMode: false,
          observability: "basic",
          nodes: [],
          errors: [],
        });
    assert.equal(result.exported, false);
    assert.ok(result.spanCount >= 1);
    assert.ok(getRecentOtelSpans().length >= 1);
  });
});

describe("AgentTurnSimulator", () => {
  test("dry-runs plan without LLM", async () => {
    const result = await simulateAgentTurn({
      organizationId: "org1",
      conversationId: "c1",
      messageId: "m1",
      botId: "b1",
      userMessage: "quero fazer check-in HVW4V2D5",
      engineConfig: {
        ...DEFAULT_AGENT_ENGINE_CONFIG,
        schedulerEnabled: true,
        memoryBudgetEnabled: true,
        memoryTokenBudget: 200,
        simulatorEnabled: true,
      },
      behaviorConfig: {
        agentEngine: { schedulerEnabled: true },
      },
      availableToolNames: ["audaar_consultar_reserva", "buscar_conhecimento"],
      memoryRecords: {
        contact: [
          normalizeMemoryRecord({
            text: "hóspede VIP",
            scope: "contact",
            status: "pinned",
          }),
        ],
      },
    });
    assert.ok(result.turnContext.executionContract);
    assert.equal(result.wouldRunScheduler, true);
    assert.ok(result.tokenBudget.estimatedPromptTokens > 0);
    assert.ok(result.snapshot.version === 1);
  });
});

test("parseAgentEngineConfig phase4 flags", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: {
      memoryBudgetEnabled: true,
      memoryTokenBudget: 900,
      otelEnabled: true,
      simulatorEnabled: true,
    },
  });
  assert.equal(cfg.memoryBudgetEnabled, true);
  assert.equal(cfg.memoryTokenBudget, 900);
  assert.equal(cfg.otelEnabled, true);
  assert.equal(cfg.simulatorEnabled, true);
});
