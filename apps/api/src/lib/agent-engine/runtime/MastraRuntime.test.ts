import assert from "node:assert/strict";
import test from "node:test";
import type { Bot, Conversation, Message } from "@prisma/client";
import type { AgentRuntimeExecuteInput } from "../types.js";
import { MastraRuntime } from "./MastraRuntime.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";

const stubMemoryFactory = () => ({
  kind: "openconduit" as const,
  load: async () => ({ flowSlots: { __satisfiedToolNames: "embratur-reference" } }),
  saveLegacy: async () => {},
});

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
      id: "conv-mastra-1",
      organizationId: "org-test",
      botId: "bot-1",
    } as unknown as Conversation,
    message: {
      id: "msg-mastra-1",
      conversationId: "conv-mastra-1",
      body: overrides.messageBody ?? "sim",
      createdAt: now,
    } as unknown as Message,
    log: stubLog(),
    executionLog: stubExecutionLog(),
    engineConfig: {
      runtime: "mastra",
      memory: "openconduit",
      supervisorEnabled: true,
      strictMode: false,
      observability: "basic",
      checkpointStore: "memory",
      ...(overrides.engineConfig ?? {}),
    },
    llmConfig: {},
    behaviorConfig: overrides.behaviorConfig ?? {},
    ...overrides,
  };
}

const SAMPLE_PLAYBOOK = `
**Proibido** \`embratur-reference\` + \`audaar_check_in\` no mesmo turno
| N=1 → S9 | só \`embratur-reference\` | reference |
| S10 | Chame \`audaar_check_in\` | check-in concluído |
`;

test("MastraRuntime executes full graph with mocked executor", async () => {
  const executor: NativeAgentExecutor = async () => ({
    reply: "Check-in concluído com sucesso. Bem-vindo ao hotel!",
    toolOutcomes: [{ name: "audaar_check_in", ok: true, preview: '{"ok":true}' }],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });

  const runtime = new MastraRuntime(executor, { createMemoryProvider: stubMemoryFactory as never });
  const result = await runtime.execute(
    buildExecuteInput({
      behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    }),
  );

  assert.equal(runtime.kind, "mastra");
  assert.ok(result.reply.length > 0);
  assert.equal(result.trace?.runtime, "mastra");
  assert.ok(result.trace?.nodes.some((n) => n.id === "mastra_compose"));
  assert.ok(result.trace?.nodes.some((n) => n.id === "mastra_execute"));
  assert.ok(result.trace?.nodes.some((n) => n.id === "execute_tool"));
  assert.ok(result.trace?.nodes.some((n) => n.id === "update_memory"));
  assert.ok(result.trace?.nodes.some((n) => n.id === "respond"));
});

test("MastraRuntime mastra_audit blocks low-confidence reply in strict mode", async () => {
  const executor: NativeAgentExecutor = async () => ({
    reply: "ok",
    toolOutcomes: [],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });

  const runtime = new MastraRuntime(executor, { createMemoryProvider: stubMemoryFactory as never });
  const result = await runtime.execute(
    buildExecuteInput({
      messageBody: "Qual horário do café?",
      engineConfig: {
        runtime: "mastra",
        memory: "openconduit",
        supervisorEnabled: false,
        strictMode: true,
        observability: "basic",
      },
    }),
  );

  assert.equal(result.reply, "");
  assert.ok(result.trace?.nodes.some((n) => n.id === "mastra_audit" && n.status === "error"));
});

test("MastraRuntime uses session prior tools — sim after embratur requires check_in not re-embratur", async () => {
  const executor: NativeAgentExecutor = async () => ({
    reply: "Check-in registado com sucesso na reserva.",
    toolOutcomes: [{ name: "audaar_check_in", ok: true, preview: "{}" }],
    kbMeta: { hasUsefulExcerpts: false, coversQuery: false },
  });

  const runtime = new MastraRuntime(executor, { createMemoryProvider: stubMemoryFactory as never });
  const result = await runtime.execute(
    buildExecuteInput({
      messageBody: "sim",
      engineConfig: {
        runtime: "mastra",
        memory: "openconduit",
        supervisorEnabled: true,
        strictMode: false,
        observability: "basic",
      },
      behaviorConfig: { promptBuilder: { useFullPrompt: true, userCore: SAMPLE_PLAYBOOK } },
    }),
  );

  assert.ok(result.reply.length > 0);
  assert.notEqual(result.trace?.supervisor?.approved, false);
});
