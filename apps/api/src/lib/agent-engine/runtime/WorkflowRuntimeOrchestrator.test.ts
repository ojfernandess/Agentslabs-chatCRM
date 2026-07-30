import assert from "node:assert/strict";
import test from "node:test";
import type { Bot, Conversation, Message } from "@prisma/client";
import { parseAgentEngineConfig } from "../config/parseAgentEngineConfig.js";
import type { AgentRuntimeExecuteInput } from "../types.js";
import { OpenNexoRuntime, type NativeAgentExecutor } from "./OpenNexoRuntime.js";
import {
  resolveEffectiveToolExecutionMode,
  runWorkflowRuntimeTurn,
} from "./WorkflowRuntimeOrchestrator.js";
import { LangGraphRuntime } from "./LangGraphRuntime.js";

const stubMemoryFactory = () =>
  ({
    kind: "openconduit" as const,
    load: async () => ({ preferences: {}, flowSlots: {} }),
    saveLegacy: async () => {},
  }) as never;

function stubLog(): AgentRuntimeExecuteInput["log"] {
  const log = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: (): AgentRuntimeExecuteInput["log"] => log,
  };
  return log as AgentRuntimeExecuteInput["log"];
}

function engineForTest(
  overrides: Record<string, unknown> = {},
): AgentRuntimeExecuteInput["engineConfig"] {
  return parseAgentEngineConfig({
    agentEngine: {
      runtime: "openconduit",
      schedulerEnabled: false,
      toolExecutionMode: "runtime_owned",
      resilienceEnabled: false,
      strictMode: false,
      supervisorEnabled: false,
      ...overrides,
    },
  });
}

function buildInput(
  overrides: Partial<AgentRuntimeExecuteInput> & {
    messageBody?: string;
    behaviorConfig?: Record<string, unknown>;
  } = {},
): AgentRuntimeExecuteInput {
  return {
    organizationId: "org-test",
    bot: { id: "bot-1", organizationId: "org-test" } as unknown as Bot,
    conversation: {
      id: "conv-wf",
      organizationId: "org-test",
      botId: "bot-1",
    } as unknown as Conversation,
    message: {
      id: "msg-wf",
      conversationId: "conv-wf",
      body: overrides.messageBody ?? "olá",
      createdAt: new Date(),
    } as unknown as Message,
    log: stubLog(),
    engineConfig: overrides.engineConfig ?? engineForTest(),
    llmConfig: {},
    behaviorConfig: overrides.behaviorConfig ?? {
      promptBuilder: { useFullPrompt: true, userCore: "Seja útil." },
    },
    ...overrides,
  };
}

test("resolveEffectiveToolExecutionMode defaults runtime_owned for Motor Padrao + scheduler", () => {
  const input = buildInput({
    engineConfig: engineForTest({ schedulerEnabled: true, toolExecutionMode: "runtime_owned" }),
  });
  assert.equal(resolveEffectiveToolExecutionMode(input), "runtime_owned");
});

test("resolveEffectiveToolExecutionMode falls back to hybrid when scheduler off", () => {
  const input = buildInput({
    engineConfig: engineForTest({ schedulerEnabled: false, toolExecutionMode: "runtime_owned" }),
  });
  assert.equal(resolveEffectiveToolExecutionMode(input), "hybrid");
});

test("resolveEffectiveToolExecutionMode respects hybrid hint", () => {
  const input = buildInput({
    engineConfig: engineForTest({ schedulerEnabled: true }),
    executionHints: { toolExecutionMode: "hybrid" },
  });
  assert.equal(resolveEffectiveToolExecutionMode(input), "hybrid");
});

test("OpenNexoRuntime passes toolExecutionMode hint and keeps reply", async () => {
  let seenMode: string | undefined;
  const executor: NativeAgentExecutor = async (input) => {
    seenMode = input.executionHints?.toolExecutionMode;
    return {
      reply: "Posso ajudar com a sua reserva.",
      toolOutcomes: [],
      kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    };
  };
  const runtime = new OpenNexoRuntime(executor, { createMemoryProvider: stubMemoryFactory });
  const result = await runtime.execute(
    buildInput({
      messageBody: "oi",
      engineConfig: engineForTest({
        schedulerEnabled: true,
        toolExecutionMode: "runtime_owned",
      }),
      // Force mode via hint so scheduler-off fallback is not required
      executionHints: { toolExecutionMode: "runtime_owned" },
    }),
  );
  assert.equal(seenMode, "runtime_owned");
  assert.ok(result.reply.length > 0);
  assert.equal(result.trace?.runtime, "openconduit");
  assert.ok(result.trace?.nodes.some((n) => n.id === "load_memory"));
  assert.ok(result.trace?.nodes.some((n) => n.id === "respond"));
});

test("runWorkflowRuntimeTurn emits workflow_engine timeline for implicit workflow", async () => {
  const events: string[] = [];
  const executor: NativeAgentExecutor = async () => ({
    reply: "Consulta registada.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });
  const input = buildInput({
    messageBody: "olá",
    engineConfig: engineForTest({
      schedulerEnabled: false,
      toolExecutionMode: "hybrid",
    }),
  });
  input.executionLog = {
    info: (meta: { id?: string }, _msg?: string) => {
      if (meta?.id) events.push(String(meta.id));
    },
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => input.executionLog!,
  };
  const result = await runWorkflowRuntimeTurn(input, executor, {
    runtimeLabel: "openconduit",
    createMemoryProvider: stubMemoryFactory,
  });
  assert.ok(result.reply.length > 0);
  assert.ok(events.includes("workflow_engine"));
  assert.ok(events.includes("agent_engine"));
});

test("LangGraph workflowRuntimeShared delegates to same orchestrator", async () => {
  let calls = 0;
  const executor: NativeAgentExecutor = async (input) => {
    calls += 1;
    assert.equal(input.executionHints?.toolExecutionMode, "runtime_owned");
    return {
      reply: "Parity ok.",
      toolOutcomes: [],
      kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
    };
  };
  const runtime = new LangGraphRuntime(executor, { createMemoryProvider: stubMemoryFactory });
  const result = await runtime.execute(
    buildInput({
      messageBody: "oi",
      engineConfig: engineForTest({
        runtime: "langgraph",
        workflowRuntimeShared: true,
        schedulerEnabled: false,
        toolExecutionMode: "runtime_owned",
      }),
      executionHints: { toolExecutionMode: "runtime_owned" },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.reply, "Parity ok.");
  assert.equal(result.trace?.runtime, "langgraph");
});
