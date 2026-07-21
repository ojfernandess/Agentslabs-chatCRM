import { hasSubstantiveAgentReplyToCustomer, isLikelyStallOnlyReply } from "./agentNativeLlm.js";

export type ExecutionQualitySignalKind =
  | "lost_context"
  | "possible_hallucination"
  | "tool_not_answered"
  | "tool_ignored"
  | "conversation_loop"
  | "supervisor_warning";

export type ExecutionQualitySignal = {
  id: string;
  kind: ExecutionQualitySignalKind;
  severity: "warn" | "error";
  title: string;
  detail: string;
  toolName?: string;
  toolPreview?: string;
  replyPreview?: string;
  suggestedActions?: Array<"send_now" | "ignore" | "retry">;
};

export type ExecutionFlowNodeKind =
  | "message"
  | "agent"
  | "condition"
  | "tool"
  | "response"
  | "supervisor"
  | "quality";

export type ExecutionFlowNode = {
  id: string;
  kind: ExecutionFlowNodeKind;
  label: string;
  sequence: number;
  level?: string;
  meta?: Record<string, unknown>;
};

export type ExecutionFlowEdge = {
  from: string;
  to: string;
};

export type ExecutionFlowGraph = {
  nodes: ExecutionFlowNode[];
  edges: ExecutionFlowEdge[];
};

export type ParsedToolRound = {
  name: string;
  nodeId: string;
  ok: boolean;
  preview: string;
  sequence: number;
};

export type ExecutionLogEntryLike = {
  id: string;
  sequence: number;
  level: string;
  nodeId: string;
  nodeName: string;
  nodePath: string;
  message: string;
  inputContext?: unknown;
  outputContext?: unknown;
};

const GENERIC_REPLY_RE =
  /\b(como\s+posso\s+ajud(a|á)|posso\s+ajud(a|á)|em\s+que\s+posso\s+ajud(a|á)|how\s+can\s+i\s+help|what\s+can\s+i\s+do\s+for\s+you)\b/i;

const TOOL_INTENT_RE =
  /\b(saldo|balance|reserva|reservation|cancelar|cancel|check[\s-]?in|check[\s-]?out|pedido|order|status|extrato|statement|hotel|voo|flight|boleto|invoice|fatura|cpf|documento|document|agendamento|appointment|marcar|schedule)\b/i;

function tokenizeForOverlap(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (w.length >= 3) out.add(w);
  }
  return out;
}

function overlapRatio(a: string, b: string): number {
  const ta = tokenizeForOverlap(a);
  const tb = tokenizeForOverlap(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared += 1;
  }
  return shared / Math.min(ta.size, tb.size);
}

function isGenericDeflectionReply(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 220) return false;
  if (GENERIC_REPLY_RE.test(t)) return true;
  return isLikelyStallOnlyReply(t);
}

function extractPreviewFromOutput(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const o = output as Record<string, unknown>;
  const preview = o.preview;
  if (typeof preview === "string") return preview.trim();
  const bodyPreview = o.bodyPreview;
  if (typeof bodyPreview === "string") return bodyPreview.trim();
  return "";
}

function parseToolOkFromOutput(output: unknown): boolean | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (typeof o.ok === "boolean") return o.ok;
  try {
    const preview = extractPreviewFromOutput(output);
    if (!preview) return null;
    const parsed = JSON.parse(preview) as { ok?: boolean };
    if (typeof parsed.ok === "boolean") return parsed.ok;
  } catch {
    /* ignore */
  }
  return null;
}

export function parseToolRoundsFromLogEntries(entries: ExecutionLogEntryLike[]): ParsedToolRound[] {
  const rounds: ParsedToolRound[] = [];
  for (const e of entries) {
    const isToolCall = e.message.includes("Chamada à ferramenta") || e.nodePath.includes("/tools/");
    const isToolResult = e.message.includes("Resultado da ferramenta");
    if (!isToolCall && !isToolResult) continue;
    const preview = extractPreviewFromOutput(e.outputContext);
    const okFromOutput = parseToolOkFromOutput(e.outputContext);
    if (isToolResult || preview) {
      const existing = rounds.find((r) => r.nodeId === e.nodeId);
      if (existing) {
        if (preview) existing.preview = preview;
        if (okFromOutput != null) existing.ok = okFromOutput;
      } else {
        rounds.push({
          name: e.nodeName.replace(/^Tool:\s*/i, "").trim() || e.nodeId,
          nodeId: e.nodeId,
          ok: okFromOutput ?? preview.length > 0,
          preview,
          sequence: e.sequence,
        });
      }
    }
  }
  return rounds.sort((a, b) => a.sequence - b.sequence);
}

function extractUserMessage(entries: ExecutionLogEntryLike[]): string {
  for (const e of entries) {
    if (e.nodeId !== "inbound") continue;
    const input = e.inputContext;
    if (input && typeof input === "object") {
      const um = (input as Record<string, unknown>).userMessage;
      if (typeof um === "string") return um.trim();
    }
  }
  return "";
}

function extractReplyPreview(entries: ExecutionLogEntryLike[]): string {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.nodeId === "outbound" || e.nodeName === "Entrega" || e.nodeName === "Resposta") {
      const output = e.outputContext;
      if (output && typeof output === "object") {
        const reply = (output as Record<string, unknown>).replyPreview;
        if (typeof reply === "string" && reply.trim()) return reply.trim();
      }
    }
  }
  return "";
}

function extractNamedEntities(text: string): string[] {
  const entities: string[] = [];
  const quoted = text.match(/["'«]([^"'»]{2,48})["'»]/g) ?? [];
  for (const q of quoted) {
    const inner = q.replace(/^["'«]|["'»]$/g, "").trim();
    if (inner.length >= 3) entities.push(inner);
  }
  for (const m of text.match(/\b(?:Hotel|Resort|Pousada|Plaza|Ocean|Mar|Sol)\s+[A-Z][\p{L}]{2,24}\b/gu) ?? []) {
    entities.push(m.trim());
  }
  return [...new Set(entities.map((x) => x.toLowerCase()))];
}

function detectPossibleHallucination(toolPreview: string, replyText: string): boolean {
  const toolEntities = extractNamedEntities(toolPreview);
  if (toolEntities.length === 0) return false;
  const replyLower = replyText.toLowerCase();
  const toolLower = toolPreview.toLowerCase();
  const toolHasDistinctName = toolEntities.some((ent) => ent.length >= 4 && toolLower.includes(ent));
  if (!toolHasDistinctName) return false;
  for (const ent of toolEntities) {
    if (ent.length < 4) continue;
    if (toolLower.includes(ent) && !replyLower.includes(ent)) {
      const altHotel = replyLower.match(/\b(hotel|resort|pousada)\s+[\p{L}0-9][\p{L}0-9\s-]{2,40}/iu);
      if (altHotel && !toolLower.includes(altHotel[0].toLowerCase().slice(0, 12))) {
        return true;
      }
    }
  }
  return false;
}

function normalizeForLoopCompare(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

export function detectConversationLoop(input: {
  userMessage: string;
  replyText: string;
  priorAgentReplies?: string[];
}): boolean {
  const replyNorm = normalizeForLoopCompare(input.replyText);
  if (!replyNorm || replyNorm.length < 12) return false;
  const priors = input.priorAgentReplies ?? [];
  const repeats = priors.filter((p) => overlapRatio(p, input.replyText) >= 0.72).length;
  if (repeats >= 1) return true;
  if (GENERIC_REPLY_RE.test(input.replyText) && TOOL_INTENT_RE.test(input.userMessage)) {
    return true;
  }
  return false;
}

export function analyzeExecutionQualityFromLogs(entries: ExecutionLogEntryLike[]): ExecutionQualitySignal[] {
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
  const userMessage = extractUserMessage(sorted);
  let replyText = extractReplyPreview(sorted);

  for (const e of sorted) {
    if (e.nodeId === "quality" && e.outputContext && typeof e.outputContext === "object") {
      const rp = (e.outputContext as Record<string, unknown>).replyPreview;
      if (typeof rp === "string" && rp.trim()) replyText = rp.trim();
    }
  }

  const toolRounds = parseToolRoundsFromLogEntries(sorted);
  const signals: ExecutionQualitySignal[] = [];
  let seq = 0;
  const push = (signal: Omit<ExecutionQualitySignal, "id">) => {
    seq += 1;
    signals.push({ id: `q${seq}`, ...signal });
  };

  const successfulTools = toolRounds.filter((t) => t.ok && t.preview.length >= 8);
  const anyToolCalled = toolRounds.length > 0;

  if (successfulTools.length > 0 && replyText) {
    for (const tool of successfulTools) {
      const overlap = overlapRatio(tool.preview, replyText);
      if (isGenericDeflectionReply(replyText) || overlap < 0.08) {
        push({
          kind: "lost_context",
          severity: "warn",
          title: "Contexto perdido",
          detail: "A ferramenta devolveu dados úteis, mas a resposta final não os utiliza de forma substantiva.",
          toolName: tool.name,
          toolPreview: tool.preview.slice(0, 400),
          replyPreview: replyText.slice(0, 400),
        });
        break;
      }
      if (detectPossibleHallucination(tool.preview, replyText)) {
        push({
          kind: "possible_hallucination",
          severity: "error",
          title: "Possível alucinação",
          detail: "A resposta menciona informação que não corresponde ao resultado da ferramenta.",
          toolName: tool.name,
          toolPreview: tool.preview.slice(0, 400),
          replyPreview: replyText.slice(0, 400),
        });
      }
    }
  }

  const outboundSent = sorted.some(
    (e) =>
      (e.nodeId === "outbound" && e.nodeName === "Entrega") ||
      (e.message.includes("Mensagem outbound enviada") || e.message.includes("Resposta em áudio enviada")),
  );

  if (successfulTools.length > 0 && (!replyText || !hasSubstantiveAgentReplyToCustomer(replyText)) && !outboundSent) {
    push({
      kind: "tool_not_answered",
      severity: "warn",
      title: "Ferramenta sem resposta ao contacto",
      detail: "Ferramenta executada com sucesso, mas nenhuma resposta substantiva foi enviada ao contacto.",
      toolName: successfulTools.map((t) => t.name).join(", "),
      toolPreview: successfulTools[0]?.preview.slice(0, 400),
      replyPreview: replyText.slice(0, 400),
      suggestedActions: ["send_now", "ignore", "retry"],
    });
  }

  if (userMessage && TOOL_INTENT_RE.test(userMessage) && !anyToolCalled && replyText) {
    push({
      kind: "tool_ignored",
      severity: "warn",
      title: "Ferramenta ignorada",
      detail: "A intenção do cliente sugere consulta via ferramenta, mas nenhuma ferramenta foi invocada.",
      replyPreview: replyText.slice(0, 400),
    });
  }

  if (userMessage && replyText && detectConversationLoop({ userMessage, replyText })) {
    push({
      kind: "conversation_loop",
      severity: "warn",
      title: "Loop detectado",
      detail: "Resposta genérica repetida face a um pedido concreto do cliente — risco de loop conversacional.",
      replyPreview: replyText.slice(0, 400),
    });
  }

  for (const e of sorted) {
    if (e.nodeId !== "supervisor") continue;
    if (e.level !== "WARN" && e.level !== "ERROR") continue;
    push({
      kind: "supervisor_warning",
      severity: e.level === "ERROR" ? "error" : "warn",
      title: "Supervisor",
      detail: e.message,
      replyPreview: extractPreviewFromOutput(e.outputContext) || undefined,
    });
  }

  return signals;
}

export function buildExecutionFlowGraph(entries: ExecutionLogEntryLike[]): ExecutionFlowGraph {
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
  const nodes: ExecutionFlowNode[] = [];
  const edges: ExecutionFlowEdge[] = [];
  let prevId: string | null = null;

  const addNode = (node: ExecutionFlowNode) => {
    nodes.push(node);
    if (prevId) edges.push({ from: prevId, to: node.id });
    prevId = node.id;
  };

  for (const e of sorted) {
    let kind: ExecutionFlowNodeKind | null = null;
    let label = e.nodeName || e.nodeId;

    if (e.nodeId === "inbound") {
      kind = "message";
      label = "Mensagem recebida";
    } else if (e.nodePath.includes("/tools/") || e.message.includes("Chamada à ferramenta")) {
      kind = "tool";
      label = e.nodeName.startsWith("Tool:") ? e.nodeName : `Tool: ${e.nodeName}`;
    } else if (e.nodeId === "stall" || e.nodeId === "tool_delivery") {
      kind = "condition";
      label = e.nodeName;
    } else if (e.nodeId === "supervisor") {
      kind = "supervisor";
      label = "Supervisor";
    } else if (e.nodeId === "quality") {
      kind = "quality";
      label = "Análise de qualidade";
    } else if (e.nodeId === "outbound" || e.nodeName === "Entrega" || e.nodeName === "Resposta") {
      kind = "response";
      label = e.nodeName === "Entrega" ? "Resposta enviada" : e.nodeName;
    } else if (e.nodePath.includes("agent_llm") || e.nodeId === "agent_llm") {
      kind = "agent";
      label = "Agente IA";
    }

    if (!kind) continue;
    const id = `flow-${e.sequence}-${e.nodeId}`;
    addNode({
      id,
      kind,
      label,
      sequence: e.sequence,
      level: e.level,
      meta: { nodePath: e.nodePath, message: e.message.slice(0, 200) },
    });
  }

  if (nodes.length === 0 && sorted.length > 0) {
    addNode({
      id: "flow-root",
      kind: "agent",
      label: "Execução",
      sequence: sorted[0]?.sequence ?? 0,
    });
  }

  return { nodes, edges };
}

export type LiveQualityInput = {
  userMessage: string;
  replyText: string;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string }>;
  outboundSent?: boolean;
  priorAgentReplies?: string[];
};

export function analyzeLiveExecutionQuality(input: LiveQualityInput): ExecutionQualitySignal[] {
  const pseudoEntries: ExecutionLogEntryLike[] = [
    {
      id: "in",
      sequence: 1,
      level: "INFO",
      nodeId: "inbound",
      nodeName: "Webhook inbound",
      nodePath: "native_agent/inbound",
      message: "Mensagem recebida",
      inputContext: { userMessage: input.userMessage },
    },
  ];
  let seq = 2;
  for (const t of input.toolOutcomes) {
    pseudoEntries.push({
      id: `t${seq}`,
      sequence: seq,
      level: "INFO",
      nodeId: t.name,
      nodeName: `Tool: ${t.name}`,
      nodePath: `native_agent/agent_llm/tools/${t.name}`,
      message: "Resultado da ferramenta",
      outputContext: { ok: t.ok, preview: t.preview },
    });
    seq += 1;
  }
  if (input.outboundSent) {
    pseudoEntries.push({
      id: "out",
      sequence: seq,
      level: "INFO",
      nodeId: "outbound",
      nodeName: "Entrega",
      nodePath: "native_agent/outbound",
      message: "Mensagem outbound enviada",
      outputContext: { replyPreview: input.replyText },
    });
  } else {
    pseudoEntries.push({
      id: "qual",
      sequence: seq,
      level: "INFO",
      nodeId: "quality",
      nodeName: "Qualidade",
      nodePath: "native_agent/quality",
      message: "Snapshot",
      outputContext: { replyPreview: input.replyText },
    });
  }
  const base = analyzeExecutionQualityFromLogs(pseudoEntries);
  if (input.priorAgentReplies?.length && input.replyText) {
    if (detectConversationLoop({ userMessage: input.userMessage, replyText: input.replyText, priorAgentReplies: input.priorAgentReplies })) {
      const hasLoop = base.some((s) => s.kind === "conversation_loop");
      if (!hasLoop) {
        base.push({
          id: "q-loop",
          kind: "conversation_loop",
          severity: "warn",
          title: "Loop detectado",
          detail: "Resposta similar a turnos anteriores — risco de loop conversacional.",
          replyPreview: input.replyText.slice(0, 400),
        });
      }
    }
  }
  return base;
}
