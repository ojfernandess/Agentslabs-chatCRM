import type { AgentEngineConfig } from "../types.js";
import { STRICT_MODE_MIN_CONFIDENCE } from "../validators/StrictModeGate.js";

export type ExecutionInspectorLogEntry = {
  nodeId: string;
  nodeName: string;
  nodePath: string;
  level: string;
  message: string;
  sequence: number;
  createdAt: string;
  inputContext: unknown;
  outputContext: unknown;
};

export type ExecutionInspectorView = {
  executionId: string;
  workflowKey: string;
  status: string;
  botName: string;
  conversationId: string | null;
  engine: AgentEngineConfig;
  model: string | null;
  provider: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  userMessage: string | null;
  finalPromptPreview: string | null;
  replySent: string | null;
  tokens: { prompt?: number; completion?: number; total?: number } | null;
  tools: Array<{ name: string; ok: boolean | null; preview: string; at: string }>;
  supervisor: { approved: boolean | null; summary: string | null; level: string } | null;
  strictMode: {
    confidence: number | null;
    minConfidence: number;
    blocked: boolean;
    reasons: string[];
  } | null;
  memoryUsed: unknown | null;
  validationChecklist: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
  timeline: Array<{
    id: string;
    name: string;
    level: string;
    message: string;
    at: string;
  }>;
};

function readInputUserMessage(inputContext: unknown): string | null {
  if (!inputContext || typeof inputContext !== "object") return null;
  const input = (inputContext as Record<string, unknown>).input;
  if (!input || typeof input !== "object") return null;
  const um = (input as Record<string, unknown>).userMessage;
  return typeof um === "string" && um.trim() ? um.trim() : null;
}

function readOutputReply(outputContext: unknown): string | null {
  if (!outputContext || typeof outputContext !== "object") return null;
  const output = (outputContext as Record<string, unknown>).output;
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (typeof o.reply === "string" && o.reply.trim()) return o.reply.trim();
  if (typeof o.replyPreview === "string" && o.replyPreview.trim()) return o.replyPreview.trim();
  return null;
}

function readTokens(outputContext: unknown): ExecutionInspectorView["tokens"] {
  if (!outputContext || typeof outputContext !== "object") return null;
  const output = (outputContext as Record<string, unknown>).output;
  if (!output || typeof output !== "object") return null;
  const usage = (output as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const prompt = typeof u.promptTokens === "number" ? u.promptTokens : undefined;
  const completion = typeof u.completionTokens === "number" ? u.completionTokens : undefined;
  const total = typeof u.totalTokens === "number" ? u.totalTokens : undefined;
  if (prompt == null && completion == null && total == null) return null;
  return { prompt, completion, total };
}

function parseSupervisorApproval(message: string, level: string): ExecutionInspectorView["supervisor"] {
  const lower = message.toLowerCase();
  let approved: boolean | null = null;
  if (/approved\s*[:=]\s*true|"approved"\s*:\s*true/.test(lower)) approved = true;
  if (/approved\s*[:=]\s*false|"approved"\s*:\s*false/.test(lower)) approved = false;
  if (approved == null && level === "WARN") approved = false;
  if (approved == null && level === "INFO") approved = true;
  return { approved, summary: message.slice(0, 500), level };
}

function isToolNode(nodeId: string, nodeName: string): boolean {
  return nodeId.startsWith("oc_tool_") || /^Tool:/i.test(nodeName);
}

export function buildExecutionInspectorView(input: {
  executionId: string;
  workflowKey: string;
  status: string;
  botName: string;
  conversationId: string | null;
  engine: AgentEngineConfig;
  model: string | null;
  provider: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  logEntries: ExecutionInspectorLogEntry[];
  triggerMessageBody?: string | null;
}): ExecutionInspectorView {
  const sorted = [...input.logEntries].sort((a, b) => a.sequence - b.sequence);

  let userMessage = input.triggerMessageBody?.trim() || null;
  let replySent: string | null = null;
  let finalPromptPreview: string | null = null;
  let tokens: ExecutionInspectorView["tokens"] = null;
  let supervisor: ExecutionInspectorView["supervisor"] = null;
  let strictMode: ExecutionInspectorView["strictMode"] = null;
  let memoryUsed: unknown = null;
  const tools: ExecutionInspectorView["tools"] = [];

  for (const e of sorted) {
    if (!userMessage && e.nodeId === "inbound") {
      userMessage = readInputUserMessage(e.inputContext);
    }
    if (e.nodeId === "context" && e.inputContext) {
      memoryUsed = e.inputContext;
    }
    if (e.nodeId === "agent_engine" || e.nodeName.toLowerCase().includes("langgraph")) {
      finalPromptPreview = e.message.slice(0, 2000);
    }
    if (e.nodeId === "llm" || e.nodePath.includes("agent_llm")) {
      const tok = readTokens(e.outputContext);
      if (tok) tokens = tok;
      const reply = readOutputReply(e.outputContext);
      if (reply) replySent = reply;
    }
    if (e.nodeId === "supervisor") {
      supervisor = parseSupervisorApproval(e.message, e.level);
    }
    if (e.nodeId === "strict_mode") {
      const output =
        e.outputContext &&
        typeof e.outputContext === "object" &&
        typeof (e.outputContext as Record<string, unknown>).output === "object"
          ? ((e.outputContext as Record<string, unknown>).output as Record<string, unknown>)
          : null;
      const confidence = typeof output?.confidence === "number" ? output.confidence : null;
      const blockSend = output?.blockSend === true;
      const reasons = Array.isArray(output?.reasons)
        ? (output!.reasons as unknown[]).filter((r): r is string => typeof r === "string")
        : [];
      strictMode = {
        confidence,
        minConfidence:
          typeof output?.minConfidence === "number"
            ? output.minConfidence
            : STRICT_MODE_MIN_CONFIDENCE,
        blocked: blockSend || /hard-block|bloqueado/i.test(e.message),
        reasons,
      };
    }
    if (e.nodeId === "outbound") {
      const chars =
        e.outputContext &&
        typeof e.outputContext === "object" &&
        typeof (e.outputContext as Record<string, unknown>).output === "object"
          ? ((e.outputContext as Record<string, unknown>).output as Record<string, unknown>).chars
          : null;
      if (!replySent && typeof chars === "number" && userMessage) {
        replySent = `(resposta enviada — ${chars} caracteres)`;
      }
    }
    if (isToolNode(e.nodeId, e.nodeName)) {
      const ok =
        e.level === "ERROR" || e.level === "FATAL"
          ? false
          : e.level === "WARN"
            ? false
            : e.level === "INFO" || e.level === "DEBUG"
              ? true
              : null;
      tools.push({
        name: e.nodeName.replace(/^Tool:\s*/i, "").trim() || e.nodeId,
        ok,
        preview: e.message.slice(0, 400),
        at: e.createdAt,
      });
    }
  }

  const durationMs =
    input.finishedAt != null
      ? Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime())
      : null;

  const validationChecklist = [
    {
      id: "context",
      label: "Contexto carregado",
      passed: sorted.some((e) => e.nodeId === "context" && e.level !== "ERROR"),
      detail: sorted.some((e) => e.nodeId === "context") ? undefined : "Sem nó de contexto",
    },
    {
      id: "memory",
      label: "Memória carregada",
      passed: memoryUsed != null || input.engine.memory === "openconduit",
    },
    {
      id: "tools",
      label: "Ferramenta executada (se necessária)",
      passed: tools.length === 0 || tools.some((t) => t.ok === true),
      detail: tools.length > 0 ? `${tools.filter((t) => t.ok).length}/${tools.length} ok` : "Nenhuma tool",
    },
    {
      id: "supervisor",
      label: "Supervisor aprovou",
      passed: !input.engine.supervisorEnabled || supervisor?.approved !== false,
      detail: supervisor?.summary?.slice(0, 120) ?? (input.engine.supervisorEnabled ? "Pendente" : "Desligado"),
    },
    {
      id: "strict_mode",
      label: "Confiança modo estrito",
      passed:
        !input.engine.strictMode ||
        (strictMode?.confidence != null && strictMode.confidence >= strictMode.minConfidence),
      detail:
        strictMode?.confidence != null
          ? `${strictMode.confidence}% (mín. ${strictMode.minConfidence}%)`
          : input.engine.strictMode
            ? "Sem avaliação registada"
            : "Desligado",
    },
    {
      id: "reply",
      label: "Resposta consistente / enviada",
      passed: Boolean(replySent) || sorted.some((e) => e.nodeId === "outbound"),
    },
  ];

  return {
    executionId: input.executionId,
    workflowKey: input.workflowKey,
    status: input.status,
    botName: input.botName,
    conversationId: input.conversationId,
    engine: input.engine,
    model: input.model,
    provider: input.provider,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt?.toISOString() ?? null,
    durationMs,
    userMessage,
    finalPromptPreview,
    replySent,
    tokens,
    tools,
    supervisor,
    strictMode,
    memoryUsed,
    validationChecklist,
    timeline: sorted.map((e) => ({
      id: e.nodeId,
      name: e.nodeName,
      level: e.level,
      message: e.message,
      at: e.createdAt,
    })),
  };
}
