import assert from "node:assert/strict";
import test from "node:test";
import type { Bot, Conversation, Message } from "@prisma/client";
import type { AgentRuntimeExecuteInput } from "../types.js";
import { LangGraphRuntime, type LangGraphRuntimeDeps } from "./LangGraphRuntime.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";

const stubMemoryFactory: LangGraphRuntimeDeps["createMemoryProvider"] = () => ({
  kind: "openconduit" as const,
  load: async () => ({ preferences: {} }),
  saveLegacy: async () => {},
} as never);

function stubLog(): AgentRuntimeExecuteInput["log"] {
  const log = {
    level: "info",
    silent: () => false,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: (): AgentRuntimeExecuteInput["log"] => log,
  };
  return log as AgentRuntimeExecuteInput["log"];
}

function stubExecutionLog(): NonNullable<AgentRuntimeExecuteInput["executionLog"]> {
  const port = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => port,
  };
  return port;
}

function buildExecuteInput(
  overrides: Partial<AgentRuntimeExecuteInput> & {
    messageBody?: string;
    behaviorConfig?: Record<string, unknown>;
  } = {},
): AgentRuntimeExecuteInput {
  const now = new Date();
  return {
    organizationId: "org-test",
    bot: { id: "bot-1", organizationId: "org-test" } as unknown as Bot,
    conversation: {
      id: "conv-1",
      organizationId: "org-test",
      botId: "bot-1",
    } as unknown as Conversation,
    message: {
      id: "msg-1",
      conversationId: "conv-1",
      body: overrides.messageBody ?? "Quais categorias de quartos?",
      createdAt: now,
    } as unknown as Message,
    log: stubLog(),
    executionLog: stubExecutionLog(),
    engineConfig: {
      runtime: "langgraph",
      memory: "openconduit",
      supervisorEnabled: true,
      strictMode: true,
      observability: "basic",
      checkpointStore: "memory",
      ...(overrides.engineConfig ?? {}),
    },
    llmConfig: {},
    behaviorConfig: overrides.behaviorConfig ?? {},
    ...overrides,
  };
}

test("LangGraphRuntime approves compliant KB execution with mock executor", async () => {
  const executor: NativeAgentExecutor = async () => ({
    reply: "Temos Standard, Duplo e Quadruplo conforme a base.",
    toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: '{"found":true}' }],
    kbMeta: { hasUsefulExcerpts: true, coversQuery: true },
  });

  const runtime = new LangGraphRuntime(executor, { createMemoryProvider: stubMemoryFactory });
  const result = await runtime.execute(
    buildExecuteInput({ messageBody: "Quais categorias de quartos?" }),
  );

  assert.ok(result.reply.length > 0);
  assert.equal(result.trace?.runtime, "langgraph");
  assert.ok(result.trace?.nodes.some((n) => n.id === "supervisor"));
  assert.ok(result.trace?.nodes.some((n) => n.id === "respond"));
});

test("LangGraphRuntime blocks when mandatory buscar_conhecimento missing", async () => {
  const executor: NativeAgentExecutor = async () => ({
    reply: "Temos quartos Standard e Deluxe.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });

  const runtime = new LangGraphRuntime(executor, { createMemoryProvider: stubMemoryFactory });
  const result = await runtime.execute(
    buildExecuteInput({
      messageBody: "Quais categorias de quartos?",
      behaviorConfig: {
        promptBuilder: {
          blocks: {
            restrictions: "Sempre use buscar_conhecimento antes de responder sobre quartos.",
          },
        },
      },
    }),
  );

  assert.equal(result.reply, "");
  assert.equal(result.trace?.supervisor?.approved, false);
});

test("LangGraphRuntime blocks stall reply without KB in strict mode", async () => {
  const executor: NativeAgentExecutor = async () => ({
    reply: "Só um momento, vou verificar.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });

  const runtime = new LangGraphRuntime(executor, { createMemoryProvider: stubMemoryFactory });
  const result = await runtime.execute(
    buildExecuteInput({ messageBody: "Quais categorias de quartos do hotel?" }),
  );

  assert.equal(result.reply, "");
  assert.equal(result.trace?.supervisor?.approved, false);
});

test("LangGraphRuntime skips workflow gate when strict mode off", async () => {
  const executor: NativeAgentExecutor = async () => ({
    reply: "Resposta genérica.",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });

  const runtime = new LangGraphRuntime(executor, { createMemoryProvider: stubMemoryFactory });
  const result = await runtime.execute(
    buildExecuteInput({
      engineConfig: {
        runtime: "langgraph",
        memory: "openconduit",
        supervisorEnabled: false,
        strictMode: false,
        observability: "basic",
      },
    }),
  );

  assert.ok(result.reply.length > 0);
});
