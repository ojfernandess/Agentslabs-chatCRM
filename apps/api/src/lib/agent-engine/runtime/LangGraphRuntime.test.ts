import assert from "node:assert/strict";
import test from "node:test";
import type { Bot, Conversation, Message } from "@prisma/client";
import type { AgentRuntimeExecuteInput } from "../types.js";
import { LangGraphRuntime, type LangGraphRuntimeDeps } from "./LangGraphRuntime.js";
import type { NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { AgentRuntimeFactory } from "./AgentRuntimeFactory.js";
import { DEFAULT_AGENT_ENGINE_CONFIG } from "../types.js";
import { OpenNexoRuntime } from "./OpenNexoRuntime.js";

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

function buildExecuteInput(
  overrides: Partial<AgentRuntimeExecuteInput> & {
    messageBody?: string;
  } = {},
): AgentRuntimeExecuteInput {
  const now = new Date();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const conversationId = `conv-${suffix}`;
  const messageId = `msg-${suffix}`;
  return {
    organizationId: "org-test",
    bot: { id: "bot-1", organizationId: "org-test" } as unknown as Bot,
    conversation: {
      id: conversationId,
      organizationId: "org-test",
      botId: "bot-1",
    } as unknown as Conversation,
    message: {
      id: messageId,
      conversationId,
      body: overrides.messageBody ?? "Olá",
      createdAt: now,
    } as unknown as Message,
    log: stubLog(),
    engineConfig: {
      runtime: "langgraph",
      memory: "openconduit",
      supervisorEnabled: false,
      strictMode: false,
      observability: "basic",
      checkpointStore: "memory",
      ...(overrides.engineConfig ?? {}),
    },
    llmConfig: {},
    behaviorConfig: {},
    ...overrides,
  };
}

test("LangGraphRuntime agent node uses native executor (no orchestrator)", async () => {
  let calls = 0;
  const executor: NativeAgentExecutor = async () => {
    calls += 1;
    return {
      reply: "Temos Standard e Duplo.",
      toolOutcomes: [{ name: "buscar_conhecimento", ok: true, preview: '{"found":true}' }],
    };
  };

  const runtime = new LangGraphRuntime(executor);
  const result = await runtime.execute(
    buildExecuteInput({ messageBody: "Quais categorias de quartos?" }),
  );

  assert.equal(calls, 1);
  assert.equal(result.reply, "Temos Standard e Duplo.");
  assert.equal(result.trace?.runtime, "langgraph");
  assert.ok(result.trace?.nodes.some((n) => n.id === "agent"));
  assert.ok(result.trace?.nodes.some((n) => n.id === "respond"));
  assert.ok(result.trace?.checkpointThreadId?.includes("conv-"));
  assert.equal(result.toolOutcomes?.[0]?.name, "buscar_conhecimento");
});

test("LangGraphRuntime agent↔tools loop with injected LLM", async () => {
  let llmRounds = 0;
  let toolCalls = 0;
  const deps: LangGraphRuntimeDeps = {
    invokeAgentLlm: async ({ round }) => {
      llmRounds = round;
      if (round === 1) {
        return {
          content: "",
          toolCalls: [
            { id: "call_1", name: "consultar_reserva", args: { code: "NCMT0VPN" } },
          ],
        };
      }
      return { content: "Reserva encontrada no Vivá Porto." };
    },
    invokeTool: async (name, args) => {
      toolCalls += 1;
      assert.equal(name, "consultar_reserva");
      assert.equal(args.code, "NCMT0VPN");
      return JSON.stringify({ ok: true, found: true, establishmentName: "Vivá Porto" });
    },
  };

  const executor: NativeAgentExecutor = async () => {
    throw new Error("executor must not run when invokeAgentLlm is set");
  };

  const runtime = new LangGraphRuntime(executor, deps);
  const result = await runtime.execute(buildExecuteInput({ messageBody: "consultar reserva" }));

  assert.equal(llmRounds, 2);
  assert.equal(toolCalls, 1);
  assert.equal(result.reply, "Reserva encontrada no Vivá Porto.");
  assert.equal(result.toolOutcomes?.[0]?.name, "consultar_reserva");
  assert.equal(result.toolOutcomes?.[0]?.ok, true);
  assert.ok(result.trace?.nodes.some((n) => n.id === "tools"));
});

test("LangGraphRuntime does not honor workflowRuntimeShared orchestrator path", async () => {
  let calls = 0;
  const executor: NativeAgentExecutor = async () => {
    calls += 1;
    return { reply: "Linear no grafo.", toolOutcomes: [] };
  };
  const runtime = new LangGraphRuntime(executor);
  const result = await runtime.execute(
    buildExecuteInput({
      engineConfig: {
        runtime: "langgraph",
        memory: "openconduit",
        supervisorEnabled: false,
        strictMode: false,
        observability: "basic",
        workflowRuntimeShared: true,
      },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.reply, "Linear no grafo.");
  assert.ok(result.trace?.nodes.every((n) => n.id !== "load_memory"));
});

test("OpenNexoRuntime Motor Padrao is linear sandbox without orchestrator nodes", async () => {
  const executor: NativeAgentExecutor = async (input) => ({
    reply: `eco:${(input.message.body ?? "").slice(0, 20)}`,
    toolOutcomes: [],
  });
  const runtime = new OpenNexoRuntime(executor);
  const result = await runtime.execute(
    buildExecuteInput({
      messageBody: "check-in",
      engineConfig: {
        runtime: "openconduit",
        memory: "openconduit",
        supervisorEnabled: false,
        strictMode: false,
        observability: "basic",
      },
    }),
  );
  assert.equal(result.reply, "eco:check-in");
  assert.equal(result.trace?.runtime, "openconduit");
  assert.ok(result.trace?.nodes.some((n) => n.id === "respond"));
  assert.ok(!result.trace?.nodes.some((n) => n.id === "load_memory"));
  assert.ok(!result.trace?.nodes.some((n) => n.id === "schedule_tools"));
});

test("Factory openconduit and langgraph remain selectable with crewai", () => {
  AgentRuntimeFactory.registerExecutor("_default", async () => ({ reply: "ok" }));
  for (const runtime of ["openconduit", "langgraph", "crewai"] as const) {
    const rt = AgentRuntimeFactory.create({ ...DEFAULT_AGENT_ENGINE_CONFIG, runtime });
    assert.equal(rt.kind, runtime);
  }
});
