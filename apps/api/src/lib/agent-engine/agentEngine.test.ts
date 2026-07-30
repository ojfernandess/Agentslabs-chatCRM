import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentEngineConfig } from "./config/parseAgentEngineConfig.js";
import { DEFAULT_AGENT_ENGINE_CONFIG } from "./types.js";
import { AgentRuntimeFactory } from "./runtime/AgentRuntimeFactory.js";
import { validateAgentPrompt } from "./validators/PromptValidator.js";
import { buildExecutionInspectorView } from "./observability/buildExecutionInspector.js";
import {
  filterRelevantAiMemoryText,
  mergeMemoryCenterIntoState,
  parseMemoryCenterFromState,
  suggestAiMemoryFromTurn,
} from "./memory/memoryCenterTypes.js";
import {
  computeReplyConfidence,
  evaluateStrictModeGate,
  STRICT_MODE_MIN_CONFIDENCE,
} from "./validators/StrictModeGate.js";
import {
  buildMem0UserId,
  buildMem0AgentId,
} from "./memory/mem0Client.js";
import { formatMem0PromptAppendix } from "./memory/mem0MemoryBridge.js";

test("parseAgentEngineConfig defaults for legacy agents", () => {
  const cfg = parseAgentEngineConfig({ nativeTools: { knowledge_search: true } });
  assert.equal(cfg.runtime, "openconduit");
  assert.equal(cfg.memory, "openconduit");
  assert.equal(cfg.strictMode, false);
  assert.equal(cfg.observability, "basic");
  assert.equal(cfg.schedulerEnabled, true);
  assert.equal(cfg.toolExecutionMode, "runtime_owned");
  assert.equal(cfg.resilienceEnabled, true);
});

test("parseAgentEngineConfig Motor Padrao openconduit enables scheduler by default", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: { runtime: "openconduit" },
  });
  assert.equal(cfg.schedulerEnabled, true);
  assert.equal(cfg.toolExecutionMode, "runtime_owned");
  assert.equal(cfg.resilienceEnabled, true);
});

test("parseAgentEngineConfig langgraph defaults to shared workflow spine", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: { runtime: "langgraph" },
  });
  assert.equal(cfg.schedulerEnabled, false);
  assert.equal(cfg.toolExecutionMode, "hybrid");
  assert.equal(cfg.workflowRuntimeShared, true);
});

test("parseAgentEngineConfig langgraph can opt out of shared spine", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: { runtime: "langgraph", workflowRuntimeShared: false },
  });
  assert.equal(cfg.workflowRuntimeShared, false);
});

test("parseAgentEngineConfig reads agentEngine block", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: {
      runtime: "langgraph",
      memory: "mem0",
      supervisorEnabled: true,
      strictMode: true,
      observability: "full",
      checkpointStore: "redis",
      streamingEnabled: true,
      humanInTheLoopEnabled: true,
      humanInTheLoopNativeEnabled: true,
      executionQueueEnabled: true,
      clientTokenStreamingEnabled: true,
      clientOutboundStreamingEnabled: true,
      parallelKbPrefetchEnabled: true,
    },
  });
  assert.equal(cfg.runtime, "langgraph");
  assert.equal(cfg.memory, "mem0");
  assert.equal(cfg.supervisorEnabled, true);
  assert.equal(cfg.strictMode, true);
  assert.equal(cfg.observability, "full");
  assert.equal(cfg.checkpointStore, "redis");
  assert.equal(cfg.streamingEnabled, true);
  assert.equal(cfg.humanInTheLoopEnabled, true);
  assert.equal(cfg.humanInTheLoopNativeEnabled, true);
  assert.equal(cfg.executionQueueEnabled, true);
  assert.equal(cfg.clientTokenStreamingEnabled, true);
  assert.equal(cfg.clientOutboundStreamingEnabled, true);
  assert.equal(cfg.parallelKbPrefetchEnabled, true);
});

test("parseAgentEngineConfig reads workflowEngineEnabled", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: { workflowEngineEnabled: true },
  });
  assert.equal(cfg.workflowEngineEnabled, true);
  assert.equal(DEFAULT_AGENT_ENGINE_CONFIG.workflowEngineEnabled, false);
});

test("parseAgentEngineConfig supervisorMode structural skips llm in native path", () => {
  const cfg = parseAgentEngineConfig({
    agentEngine: { supervisorEnabled: true, supervisorMode: "structural" },
  });
  assert.equal(cfg.supervisorMode, "structural");
});

test("validateAgentPrompt scores filled blocks", () => {
  const result = validateAgentPrompt({
    userCore: "Playbook",
    blocks: {
      objective: "Atender hóspedes",
      personality: "Cordial",
      restrictions: "Não inventar",
      flows: "Check-in",
      examples: "Exemplo",
    },
    connectedToolCount: 2,
    hasFallbacks: true,
  });
  assert.ok(result.score >= 70);
  assert.equal(result.ready, true);
});

test("validateAgentPrompt low score when empty", () => {
  const result = validateAgentPrompt({ userCore: "" });
  assert.ok(result.score < 50);
  assert.equal(result.ready, false);
});

test("buildExecutionInspectorView extracts inbound message and tools", () => {
  const view = buildExecutionInspectorView({
    executionId: "e1",
    workflowKey: "native_agent",
    status: "success",
    botName: "Auda",
    conversationId: "c1",
    engine: {
      runtime: "openconduit",
      memory: "openconduit",
      supervisorEnabled: true,
      strictMode: false,
      observability: "basic",
    },
    model: "gpt-4o-mini",
    provider: "openai",
    startedAt: new Date("2026-07-24T12:00:00.000Z"),
    finishedAt: new Date("2026-07-24T12:00:05.000Z"),
    logEntries: [
      {
        nodeId: "inbound",
        nodeName: "Webhook inbound",
        nodePath: "inbound",
        level: "INFO",
        message: "Mensagem recebida",
        sequence: 1,
        createdAt: "2026-07-24T12:00:00.000Z",
        inputContext: { input: { userMessage: "Localizador ABC123" } },
        outputContext: null,
      },
      {
        nodeId: "oc_tool_checkin",
        nodeName: "Tool: check-in",
        nodePath: "agent_llm/oc_tool_checkin",
        level: "INFO",
        message: "ok",
        sequence: 2,
        createdAt: "2026-07-24T12:00:02.000Z",
        inputContext: null,
        outputContext: null,
      },
      {
        nodeId: "supervisor",
        nodeName: "Agente supervisor",
        nodePath: "agent_llm/supervisor",
        level: "INFO",
        message: 'approved: true — "Resposta coerente"',
        sequence: 3,
        createdAt: "2026-07-24T12:00:04.000Z",
        inputContext: null,
        outputContext: null,
      },
      {
        nodeId: "outbound",
        nodeName: "Entrega",
        nodePath: "outbound",
        level: "INFO",
        message: "Mensagem enviada",
        sequence: 4,
        createdAt: "2026-07-24T12:00:05.000Z",
        inputContext: null,
        outputContext: { output: { chars: 42 } },
      },
    ],
  });
  assert.equal(view.userMessage, "Localizador ABC123");
  assert.equal(view.tools.length, 1);
  assert.equal(view.supervisor?.approved, true);
  assert.equal(view.durationMs, 5000);
  assert.ok(view.validationChecklist.every((c) => c.id !== "reply" || c.passed));
});

test("parseMemoryCenterFromState reads memoryCenter slice", () => {
  const slice = parseMemoryCenterFromState({
    memoryCenter: {
      preferences: { room: "101" },
      aiMemories: [{ id: "m1", text: "Prefere check-in tardio", source: "agent", createdAt: "2026-07-24T12:00:00.000Z" }],
      score: 85,
    },
  });
  assert.equal(slice.preferences?.room, "101");
  assert.equal(slice.aiMemories?.length, 1);
  assert.equal(slice.score, 85);
});

test("mergeMemoryCenterIntoState preserves other state keys", () => {
  const next = mergeMemoryCenterIntoState(
    { flowStep: "awaiting_locator", memoryCenter: { score: 50 } },
    { score: 90, preferences: { lang: "pt" } },
  );
  assert.equal((next as { flowStep: string }).flowStep, "awaiting_locator");
  assert.deepEqual((next as { memoryCenter: { score: number } }).memoryCenter.score, 90);
});

test("memory center legacy slice ids are stable for delete targeting", () => {
  const slice = parseMemoryCenterFromState({
    memoryCenter: {
      aiMemories: [
        { id: "mem_engine_1", text: "Prefere quarto silencioso no andar alto", source: "agent", createdAt: "2026-07-24T12:00:00.000Z" },
      ],
    },
  });
  assert.equal(slice.aiMemories?.[0]?.id, "mem_engine_1");
});

test("filterRelevantAiMemoryText rejects greetings and short text", () => {
  assert.equal(filterRelevantAiMemoryText("oi"), false);
  assert.equal(filterRelevantAiMemoryText("bom dia"), false);
  assert.equal(filterRelevantAiMemoryText("Prefere quarto no andar superior"), true);
});

test("suggestAiMemoryFromTurn extracts locator context", () => {
  const mem = suggestAiMemoryFromTurn("Meu localizador é ABC123", "Obrigado, vou verificar a reserva.");
  assert.ok(mem?.includes("ABC123"));
});

test("evaluateStrictModeGate allows completion claim when check-in succeeded after scheduler fail", () => {
  const evaluation = evaluateStrictModeGate({
    strictMode: true,
    replyText:
      "O check-in foi concluído com sucesso. A sua reserva está confirmada para a data de chegada.",
    userMessage: "sim",
    toolOutcomes: [
      {
        name: "audaar_check_in",
        ok: false,
        preview: '{"ok":false,"error":"schema_validation_failed"}',
      },
      {
        name: "audaar_check_in",
        ok: true,
        preview: '{"ok":true,"statusCode":200,"bodyPreview":"{\\"embraturId\\":1}"}',
      },
    ],
    hasSubstantiveReply: true,
    turnPolicy: {
      forbiddenSameTurnPairs: [],
      exclusiveAllowedTools: null,
      completionToolHints: ["audaar_check_in"],
      confirmationPrerequisiteTools: ["embratur-reference"],
      omitToolsWhenSlotsPresent: [],
      blockEscalation: false,
    },
  });
  assert.equal(
    evaluation.reasons.some((r) => /Sem afirmar conclusão sem tool/i.test(r)),
    false,
    `unexpected reasons: ${evaluation.reasons.join(" | ")}`,
  );
  assert.equal(
    evaluation.reasons.some((r) => /retornou erro/i.test(r)),
    false,
  );
  assert.ok(evaluation.confidence >= STRICT_MODE_MIN_CONFIDENCE);
  assert.equal(evaluation.blockSend, false);
});

test("evaluateStrictModeGate blocks low confidence when strict mode on", () => {
  const evaluation = evaluateStrictModeGate({
    strictMode: true,
    replyText: "Só um momento, vou verificar.",
    userMessage: "Qual o horário do check-in?",
    toolOutcomes: [{ name: "checkin", ok: true, preview: '{"ok":true}' }],
    llmSupervisorApproved: false,
  });
  assert.ok(evaluation.confidence < STRICT_MODE_MIN_CONFIDENCE);
  assert.equal(evaluation.blockSend, true);
});

test("evaluateStrictModeGate allows high confidence replies", () => {
  const evaluation = evaluateStrictModeGate({
    strictMode: true,
    replyText: "O check-in é a partir das 15h. Posso ajudar com mais alguma coisa?",
    userMessage: "Qual o horário do check-in?",
    toolOutcomes: [{ name: "kb", ok: true, preview: '{"found":true}' }],
    llmSupervisorApproved: true,
    hasSubstantiveReply: true,
  });
  assert.ok(evaluation.confidence >= STRICT_MODE_MIN_CONFIDENCE);
  assert.equal(evaluation.blockSend, false);
});

test("computeReplyConfidence ignores strict flag", () => {
  const score = computeReplyConfidence({
    replyText: "Resposta substantiva com informação útil ao cliente.",
    userMessage: "Preciso de ajuda",
    toolOutcomes: [],
    hasSubstantiveReply: true,
  });
  assert.ok(score >= 90);
});

test("buildMem0UserId scopes contact per organization", () => {
  const userId = buildMem0UserId("org-1", "contact-9");
  assert.match(userId, /openconduit:org-1:contact:contact-9/);
  const agentId = buildMem0AgentId("org-1", "bot-2");
  assert.match(agentId, /openconduit:org-1:bot:bot-2/);
});

test("formatMem0PromptAppendix renders memory block", () => {
  const block = formatMem0PromptAppendix([
    { id: "m1", memory: "Prefere check-in tardio", score: 0.82 },
  ]);
  assert.match(block, /Mem0/);
  assert.match(block, /check-in tardio/);
});

test("AgentRuntimeFactory instantiates all runtime kinds", () => {
  AgentRuntimeFactory.registerExecutor("_default", async () => ({ reply: "ok" }));
  for (const runtime of ["openconduit", "langgraph", "crewai", "autogen", "mastra"] as const) {
    const rt = AgentRuntimeFactory.create({ ...DEFAULT_AGENT_ENGINE_CONFIG, runtime });
    assert.equal(rt.kind, runtime);
  }
});

test("parseMemoryEngineConfig defaults and reads memoryEngine block", async () => {
  const { parseMemoryEngineConfig } = await import("./memory/parseMemoryEngineConfig.js");
  const defaults = parseMemoryEngineConfig({});
  assert.equal(defaults.provider, "openconduit");
  assert.equal(defaults.maxMemories, 100);
  assert.equal(defaults.autoSaveEnabled, true);

  const cfg = parseMemoryEngineConfig({
    agentEngine: { memory: "mem0" },
    memoryEngine: {
      provider: "mem0",
      intelligentMemoryEnabled: false,
      maxMemories: 50,
    },
  });
  assert.equal(cfg.provider, "mem0");
  assert.equal(cfg.intelligentMemoryEnabled, false);
  assert.equal(cfg.maxMemories, 50);
});

test("MemoryValidator rejects casual and short text", async () => {
  const { isCasualText, validateMemoryCandidate } = await import("./memory/MemoryValidator.js");
  const { DEFAULT_MEMORY_ENGINE_CONFIG } = await import("./memory/memoryEngineTypes.js");
  const { DEFAULT_MEMORY_ENGINE_ORG_CONFIG } = await import("./memory/memoryEngineTypes.js");
  assert.equal(isCasualText("bom dia"), true);
  assert.equal(isCasualText("O cliente prefere WhatsApp para contacto"), false);
  const rejected = validateMemoryCandidate({
    text: "ok",
    category: "preferences",
    confidence: 0.9,
    config: DEFAULT_MEMORY_ENGINE_CONFIG,
    orgConfig: DEFAULT_MEMORY_ENGINE_ORG_CONFIG,
  });
  assert.equal(rejected.ok, false);
});

test("MemoryExtractor detects preference and reservation facts", async () => {
  const { extractMemoryCandidates } = await import("./memory/MemoryExtractor.js");
  const rows = extractMemoryCandidates(
    "O cliente prefere WhatsApp e quarto térreo",
    "Registado. Localizador ABC123 confirmado na reserva.",
  );
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((r) => r.category === "preferences" || r.category === "reservation"));
});

test("MemoryExtractor skips assistant KB dump on factual questions (any category)", async () => {
  const { extractMemoryCandidates } = await import("./memory/MemoryExtractor.js");
  const rows = extractMemoryCandidates(
    "Qual a política de cancelamento do plano enterprise?",
    "O Plano Enterprise permite cancelamento com 30 dias de antecedência e reembolso proporcional.",
  );
  assert.equal(rows.length, 0);
});

test("MemoryExtractor skips hotel/preferences from assistant on factual KB questions", async () => {
  const { extractMemoryCandidates } = await import("./memory/MemoryExtractor.js");
  const rows = extractMemoryCandidates(
    "Quais as categorias de quartos do hotel brooklin?",
    "O Hotel Brooklin oferece quartos Standard, Deluxe e Suite Master.",
  );
  assert.ok(!rows.some((r) => r.category === "hotel" || r.category === "preferences"));
});

test("MemoryContextBuilder merges hierarchy order", async () => {
  const { mergeMemoryHierarchy } = await import("./memory/MemoryContextBuilder.js");
  const { normalizeMemoryRecord } = await import("./memory/memoryEngineTypes.js");
  const mk = (scope: "temporary" | "contact" | "agent" | "global", text: string) =>
    normalizeMemoryRecord({ text, scope, category: "preferences" });
  const { ranked } = mergeMemoryHierarchy({
    temporary: [mk("temporary", "Temporária relevante para o pedido actual")],
    contact: [mk("contact", "Contacto prefere comunicação via WhatsApp")],
    agent: [mk("agent", "Agente comercial regista preferência de pacote premium")],
    global: [mk("global", "Empresa oferece suporte premium 24 horas por dia")],
    userMessage: "WhatsApp",
  });
  assert.equal(ranked.length, 4);
});

test("parseKnowledgeEngineConfig defaults for legacy agents", async () => {
  const { parseKnowledgeEngineConfig } = await import("./knowledge/parseKnowledgeEngineConfig.js");
  const cfg = parseKnowledgeEngineConfig({ nativeTools: { knowledge_search: true } });
  assert.equal(cfg.provider, "openconduit");
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.maxDocuments, 10);
  assert.equal(cfg.maxChunks, 20);
});

test("parseKnowledgeEngineConfig reads knowledgeEngine block", async () => {
  const { parseKnowledgeEngineConfig } = await import("./knowledge/parseKnowledgeEngineConfig.js");
  const cfg = parseKnowledgeEngineConfig({
    nativeTools: { knowledge_search: true },
    knowledgeEngine: {
      provider: "llamaindex",
      enabled: true,
      reranking: false,
      maxDocuments: 5,
      maxChunks: 12,
    },
  });
  assert.equal(cfg.provider, "llamaindex");
  assert.equal(cfg.reranking, false);
  assert.equal(cfg.maxDocuments, 5);
  assert.equal(cfg.maxChunks, 12);
});

test("shouldUseKnowledgeEngineRuntime only for llamaindex", async () => {
  const { shouldUseKnowledgeEngineRuntime } = await import("./knowledge/parseKnowledgeEngineConfig.js");
  assert.equal(shouldUseKnowledgeEngineRuntime({ nativeTools: { knowledge_search: true } }), false);
  assert.equal(
    shouldUseKnowledgeEngineRuntime({ knowledgeEngine: { provider: "openconduit" } }),
    false,
  );
  assert.equal(
    shouldUseKnowledgeEngineRuntime({ knowledgeEngine: { provider: "llamaindex" } }),
    true,
  );
});

test("mergeKnowledgeEngineIntoBehavior syncs nativeTools", async () => {
  const { mergeKnowledgeEngineIntoBehavior } = await import("./knowledge/parseKnowledgeEngineConfig.js");
  const { DEFAULT_KNOWLEDGE_ENGINE_CONFIG } = await import("./knowledge/knowledgeEngineTypes.js");
  const merged = mergeKnowledgeEngineIntoBehavior(
    { nativeTools: { knowledge_search: false } },
    { ...DEFAULT_KNOWLEDGE_ENGINE_CONFIG, enabled: false },
  );
  const nt = merged.nativeTools as Record<string, unknown>;
  assert.equal(nt.knowledge_search, false);
});
