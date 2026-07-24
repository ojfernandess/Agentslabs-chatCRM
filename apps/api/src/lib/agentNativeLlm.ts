import type { FastifyBaseLogger } from "fastify";
import type { Bot, Conversation, Message } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import {
  callGeminiGenerateContent,
  callOpenAiCompatibleChat,
  callOpenAiCompatibleChatWithTools,
  type OpenAiToolDefinition,
  type PreviewChatTurn,
} from "./promptModulePreviewLlm.js";
import { kbAppendixHasRetrievedExcerpts } from "./kbAppendix.js";
import {
  fetchProactiveKnowledgeSystemAppendix,
  mergeBotLinkedKnowledgeWhenRankedEmpty,
  mergePinnedKnowledgeWhenRankedEmpty,
  parseLinkedKnowledgeArticleIdsFromBehavior,
  rankedKnowledgeSearch,
} from "./knowledgeRetrieval.js";
import { isAgentKbDebugEnabled, logAgentKbDebug } from "./agentKnowledgeDebugLog.js";
import { buildNativeAgentMessageWhere } from "./agentConversationHistory.js";
import {
  buildFollowUpCampaignPromptBlock,
  buildNativeFlowStatePromptBlock,
  extractFlowSlotsFromToolExchange,
  loadAutomationConversationContext,
  mergeFlowSlotsAutomationContext,
  mergeNativeToolRoundAutomationContext,
  type AutomationFlowSlots,
} from "./automationConversationContextLib.js";
import { recordNativeAgentTransferHandoff } from "./agentConversationHandoff.js";
import { assignConversationTeamForOrg } from "./conversationTeamAssignment.js";
import { assignTagsToConversationContact } from "./assignContactTags.js";
import type { AutomationExecutionLogPort } from "./automationExecutionLog.js";
import { applyAgentPlaybookToSystemInstructions } from "./agentPlaybook.js";
import {
  buildNativeAgentHttpToolRuntimeContext,
  openAiToolDefinitionForAutomationTool,
  parseAutomationToolIdFromOpenAiName,
  runAutomationHttpLikeTool,
  type AutomationHttpToolRow,
} from "./automationHttpToolExecute.js";
import { AUDIO_TRANSCRIPTION_PREFIX } from "./audioTranscription.js";
import { IMAGE_TRANSCRIPTION_PREFIX } from "./imageTranscription.js";
import {
  mergeInstructionFallbacksIntoSystemPrompt,
  parseInstructionFallbacks,
  type InstructionFallback,
} from "./instructionFallbacks.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { analyzeLiveExecutionQuality } from "./automationExecutionQuality.js";

const DEFAULT_TOOL_CALL_NOTIFY_MESSAGE = "Um momento, estou a consultar isso para si…";

/** Tempo máximo por pedido LLM do agente nativo (várias rondas de tools + HTTP externo). */
const NATIVE_AGENT_LLM_TIMEOUT_MS = 90_000;

function nativeAgentLlmAbortSignal(): AbortSignal {
  return AbortSignal.timeout(NATIVE_AGENT_LLM_TIMEOUT_MS);
}

export function parseAgentSupervisorFromBehavior(behaviorConfig: unknown): { enabled: boolean } {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return { enabled: false };
  const raw = (behaviorConfig as Record<string, unknown>).agentSupervisor;
  if (!raw || typeof raw !== "object") return { enabled: false };
  return { enabled: (raw as Record<string, unknown>).enabled === true };
}

export function parseToolCallNotifyFromBehavior(behaviorConfig: unknown): {
  enabled: boolean;
  message: string;
  /** `null` = perfis antigos (avisar em qualquer ferramenta). */
  selectedTools: string[] | null;
  /** Após tools, garante que o cliente recebe resposta substantiva com o resultado (não só aviso inicial). */
  ensureResultDelivered: boolean;
  /** Mensagens opcionais por chave de selecção (`native:…` / `custom:uuid`). Vazio = usar `message`. */
  toolMessages: Record<string, string>;
  /**
   * Entrega forçada inteligente (stall/vazio → sintetizar a partir das tools / KB).
   * Default `true` quando o campo não existe — preserva o comportamento actual.
   */
  forceDeliveryEnabled: boolean;
  /**
   * Tools elegíveis para entrega forçada (`native:…` / `custom:…`).
   * `null` = todas; `[]` = nenhuma; lista = apenas essas.
   */
  forceDeliveryTools: string[] | null;
  /**
   * Resgate da base de conhecimento em stall (só perguntas de conhecimento).
   * Default `true` quando o campo não existe.
   */
  forceKnowledgeRescue: boolean;
} {
  const fallback = {
    enabled: false,
    message: DEFAULT_TOOL_CALL_NOTIFY_MESSAGE,
    selectedTools: [] as string[],
    ensureResultDelivered: false,
    toolMessages: {} as Record<string, string>,
    forceDeliveryEnabled: true,
    forceDeliveryTools: null as string[] | null,
    forceKnowledgeRescue: true,
  };
  if (!behaviorConfig || typeof behaviorConfig !== "object") return fallback;
  const raw = (behaviorConfig as Record<string, unknown>).toolCallNotify;
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const message =
    typeof o.message === "string" && o.message.trim()
      ? o.message.trim().slice(0, 500)
      : DEFAULT_TOOL_CALL_NOTIFY_MESSAGE;
  let selectedTools: string[] | null = null;
  if ("selectedTools" in o) {
    selectedTools = Array.isArray(o.selectedTools)
      ? o.selectedTools.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  }
  const toolMessages: Record<string, string> = {};
  const rawMsgs = o.toolMessages;
  if (rawMsgs && typeof rawMsgs === "object" && !Array.isArray(rawMsgs)) {
    for (const [k, v] of Object.entries(rawMsgs as Record<string, unknown>)) {
      const key = k.trim();
      if (!key || typeof v !== "string") continue;
      const msg = v.trim().slice(0, 500);
      if (msg) toolMessages[key] = msg;
    }
  }
  let forceDeliveryTools: string[] | null = null;
  if ("forceDeliveryTools" in o) {
    forceDeliveryTools = Array.isArray(o.forceDeliveryTools)
      ? o.forceDeliveryTools.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  }
  return {
    enabled: o.enabled === true,
    message,
    selectedTools,
    ensureResultDelivered: o.ensureResultDelivered === true,
    toolMessages,
    forceDeliveryEnabled: o.forceDeliveryEnabled !== false,
    forceDeliveryTools,
    forceKnowledgeRescue: o.forceKnowledgeRescue !== false,
  };
}

export type NativeToolRoundOutcome = {
  name: string;
  ok: boolean;
  preview: string;
  monitored: boolean;
};

export function parseToolCallOutcomeFromJson(name: string, out: string): Omit<NativeToolRoundOutcome, "monitored"> {
  try {
    const parsed = JSON.parse(out) as {
      ok?: boolean;
      found?: boolean;
      skipped?: boolean;
      bodyPreview?: string;
      error?: string | null;
    };
    const preview =
      (typeof parsed.bodyPreview === "string" && parsed.bodyPreview.trim()) ||
      (typeof parsed.error === "string" && parsed.error.trim()) ||
      out.slice(0, 400);
    const ok =
      parsed.ok === true ||
      parsed.found === true ||
      (parsed.skipped === true && parsed.ok !== false);
    return { name, ok, preview: preview.slice(0, 500) };
  } catch {
    return { name, ok: out.trim().length > 0 && !/error|failed|falhou/i.test(out), preview: out.slice(0, 500) };
  }
}

/** Ferramentas monitorizadas foram invocadas mas a resposta final não entrega resultado ao cliente. */
export function shouldEnsureToolResultFollowUp(input: {
  ensureResultDelivered: boolean;
  toolOutcomes: NativeToolRoundOutcome[];
  replyText: string;
}): boolean {
  if (!input.ensureResultDelivered) return false;
  const monitored = input.toolOutcomes.filter((t) => t.monitored);
  if (monitored.length === 0) return false;
  return !hasSubstantiveAgentReplyToCustomer(input.replyText);
}

/**
 * Quando o modelo falha (ex. 429) depois de tools já executadas, ainda assim o contacto
 * precisa de uma mensagem — mesmo sem `ensureResultDelivered` ou LLM de reforço.
 * Tools só de KB são tratadas por `shouldForceKnowledgeDelivery`.
 */
export function scopeForceDeliveryToolOutcomes(
  toolOutcomes: NativeToolRoundOutcome[],
  forceDeliveryTools: string[] | null | undefined,
): NativeToolRoundOutcome[] {
  if (forceDeliveryTools == null) {
    return toolOutcomes.filter((t) => t.name !== "buscar_conhecimento");
  }
  if (forceDeliveryTools.length === 0) return [];
  return toolOutcomes.filter((t) => {
    if (t.name === "buscar_conhecimento") return false;
    const sel = toolCallNotifySelectionKey(t.name);
    return Boolean(sel && forceDeliveryTools.includes(sel));
  });
}

export function shouldForceDeliveryAfterTools(input: {
  toolOutcomes: NativeToolRoundOutcome[];
  replyText: string;
  /** Default true (omitido = comportamento legado). */
  forceDeliveryEnabled?: boolean;
  /** `null`/omitido = todas; lista = filtrar por chave de selecção. */
  forceDeliveryTools?: string[] | null;
}): boolean {
  if (input.forceDeliveryEnabled === false) return false;
  const actionable = scopeForceDeliveryToolOutcomes(input.toolOutcomes, input.forceDeliveryTools);
  if (actionable.length === 0) return false;
  return !hasSubstantiveAgentReplyToCustomer(input.replyText);
}

function humanizeToolPreviewForCustomer(preview: string): string {
  const raw = preview.trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      for (const key of [
        "message",
        "mensagem",
        "summary",
        "resumo",
        "status",
        "result",
        "resultado",
        "guestName",
        "reservationCode",
        "confirmationCode",
      ]) {
        const v = o[key];
        if (typeof v === "string" && v.trim()) return v.trim().slice(0, 600);
      }
      if (typeof o.found === "boolean") {
        const bits: string[] = [];
        bits.push(o.found ? "Consulta concluída com registo encontrado." : "Consulta concluída — não encontramos o registo pedido.");
        for (const key of ["guestName", "name", "reservationCode", "code", "checkIn", "checkOut"]) {
          const v = o[key];
          if (typeof v === "string" && v.trim()) bits.push(`${key}: ${v.trim()}`);
        }
        return bits.join(" ").slice(0, 600);
      }
    }
  } catch {
    /* plain text */
  }
  return raw.replace(/\s+/g, " ").slice(0, 500);
}

/**
 * Resposta de última linha sem novo LLM — usa previews das tools já executadas.
 * Evita «texto vazio — sem envio» após rate limit / falha na síntese final.
 */
export function buildDeterministicReplyFromToolOutcomes(
  toolOutcomes: NativeToolRoundOutcome[],
): string {
  const preferred = [
    ...toolOutcomes.filter((t) => t.monitored && t.ok),
    ...toolOutcomes.filter((t) => t.ok && t.name !== "buscar_conhecimento"),
    ...toolOutcomes.filter((t) => t.ok),
    ...toolOutcomes,
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const t of preferred) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    if (t.name === "buscar_conhecimento") continue;
    const human = humanizeToolPreviewForCustomer(t.preview);
    if (!human) continue;
    lines.push(human);
    if (lines.length >= 2) break;
  }
  if (lines.length > 0) {
    return (
      "Segue o resultado da consulta:\n\n" +
      lines.join("\n\n") +
      "\n\nSe precisar de mais algum detalhe, é só dizer."
    ).slice(0, 3500);
  }
  if (toolOutcomes.some((t) => t.ok)) {
    return "Já consultei o sistema com base no seu pedido. Pode confirmar o próximo passo ou partilhar mais algum detalhe para eu avançar?";
  }
  return "Tentei consultar o sistema, mas não obtive um resultado útil ainda. Pode repetir o pedido ou partilhar mais um detalhe (por exemplo código ou nome)?";
}

const OPENAI_FUNCTION_TO_NOTIFY_KEY: Record<string, string> = {
  buscar_conhecimento: "native:knowledge_search",
  listar_equipas: "native:list_teams",
  transfer_to_team: "native:transfer_to_team",
  call_human: "native:call_human",
  set_conversation_status: "native:set_conversation_status",
  listar_etiquetas: "native:assign_contact_tags",
  atribuir_etiquetas: "native:assign_contact_tags",
};

export function toolCallNotifySelectionKey(functionName: string): string | null {
  const customId = parseAutomationToolIdFromOpenAiName(functionName);
  if (customId) return `custom:${customId}`;
  return OPENAI_FUNCTION_TO_NOTIFY_KEY[functionName] ?? null;
}

export function shouldNotifyBeforeToolCall(
  functionName: string,
  config: { enabled: boolean; selectedTools: string[] | null },
): boolean {
  if (!config.enabled) return false;
  const key = toolCallNotifySelectionKey(functionName);
  if (!key) return false;
  if (config.selectedTools === null) return true;
  const selected = config.selectedTools;
  if (selected.includes(key)) return true;
  if (key === "native:transfer_to_team" && selected.includes("native:assign_team_to_conversation")) {
    return true;
  }
  return false;
}

/** Texto intermédio quando o modelo invoca ferramentas sem resposta final ao cliente. */
export function resolveToolCallInterimMessage(
  assistantContent: string | null,
  configuredMessage: string,
): string {
  const assistantTrim = (assistantContent ?? "").trim();
  if (assistantTrim) return assistantTrim;
  return configuredMessage;
}

/**
 * Resolve a mensagem de aviso: texto do modelo → mensagem específica da 1.ª tool marcada → mensagem global.
 */
export function resolveToolCallNotifyBody(input: {
  assistantContent: string | null;
  toolNames: string[];
  defaultMessage: string;
  toolMessages: Record<string, string>;
}): string {
  const assistantTrim = (input.assistantContent ?? "").trim();
  if (assistantTrim) return assistantTrim;
  for (const name of input.toolNames) {
    const key = toolCallNotifySelectionKey(name);
    if (!key) continue;
    const perTool = input.toolMessages[key]?.trim();
    if (perTool) return perTool.slice(0, 500);
  }
  const globalMsg = input.defaultMessage.trim();
  return globalMsg || DEFAULT_TOOL_CALL_NOTIFY_MESSAGE;
}

export function hasSubstantiveAgentReplyToCustomer(
  text: string,
  configuredStallMessages?: string[],
): boolean {
  const t = text.trim();
  if (!t) return false;
  return !isLikelyStallOnlyReply(t, configuredStallMessages);
}

async function sendToolCallInterimNotify(input: {
  organizationId: string;
  botId: string;
  conversationId: string;
  contactId: string;
  body: string;
  log: FastifyBaseLogger;
  executionLog?: AutomationExecutionLogPort | null;
  toolNames: string[];
  round: number;
  usedAgentStallText: boolean;
}): Promise<void> {
  const tlog = input.executionLog?.child("tools");
  try {
    await deliverOutboundWhatsAppMessage({
      organizationId: input.organizationId,
      data: {
        contactId: input.contactId,
        conversationId: input.conversationId,
        type: "TEXT",
        body: input.body,
      },
      actor: { kind: "agent_bot", botId: input.botId },
      log: input.log,
      newConversation: { status: "PENDING", assignedToId: null },
    });
    tlog?.info(
      { id: "interim_notify", name: "Aviso intermédio" },
      "Mensagem enviada ao contacto — agente invocou ferramenta sem resposta final",
      {
        output: {
          round: input.round,
          toolNames: input.toolNames.slice(0, 8),
          usedAgentStallText: input.usedAgentStallText,
          messagePreview: input.body.slice(0, 240),
        },
      },
    );
  } catch (err) {
    input.log.warn({ err, botId: input.botId, toolNames: input.toolNames }, "tool call interim notify failed");
    tlog?.warn(
      { id: "interim_notify", name: "Aviso intermédio" },
      "Falha ao enviar aviso intermédio",
      { stack: err instanceof Error ? err.stack : undefined },
    );
  }
}

const STALL_RE =
  /\b(vou|irei)\s+.{0,48}?(verificar|consultar|buscar|pesquisar|checar|olhar|prosseguir|continuar|finalizar|concluir|processar)\b|\b(um\s+momento|só\s+um\s+momento|aguarde|já\s+volto|espere|momento\s+por\s+favor|momento\s+por\s+gentileza)\b|\b(enquanto)\s+.{0,40}?(finaliz|process|consult|verific)\b|\b(consultando|verificando|processando|finalizando)\b|\b(i'?ll|i\s+will)\s+.{0,32}?(check|look\s+up|search|proceed|finish)\b|\b(one\s+moment|just\s+a\s+moment|please\s+hold)\b/i;

const TOOL_ROUNDS_EXHAUSTED_RE =
  /não\s+foi\s+possível\s+concluir\s+as\s+ações\s+automáticas\s+a\s+tempo/i;

/** Resposta curta só a “vou verificar” / “um momento”, sem conteúdo útil — típico quando o modelo não invocou a KB. */
export function isLikelyStallOnlyReply(text: string, configuredStallMessages?: string[]): boolean {
  const t = text.trim();
  if (!t) return false;
  if (TOOL_ROUNDS_EXHAUSTED_RE.test(t) && t.length < 220) return true;
  if (/^só\s+um\s+momento(\s+por\s+gentileza)?[.!…]?\s*$/i.test(t)) return true;
  if (/^um\s+momento([,.]\s*.{0,60})?[.!…]?\s*$/i.test(t)) return true;
  for (const raw of configuredStallMessages ?? []) {
    const m = raw.trim();
    if (m.length < 6) continue;
    if (t.toLowerCase() === m.toLowerCase()) return true;
    if (t.length <= Math.max(m.length + 24, 120) && t.toLowerCase().includes(m.toLowerCase()) && t.length < 200) {
      return true;
    }
  }
  if (t.length < 8 || t.length > 280) return false;
  if (/[.!?][\s\S]{40,}/.test(t)) return false;
  return STALL_RE.test(t);
}

/** True quando a resposta ainda não entrega factos ao cliente (stall / fallback de teto de tools). */
export function isNonDeliveringAgentReply(text: string, configuredStallMessages?: string[]): boolean {
  const t = text.trim();
  if (!t) return true;
  return isLikelyStallOnlyReply(t, configuredStallMessages);
}

export function knowledgeToolFoundUsefulExcerpts(toolOutcomes: NativeToolRoundOutcome[]): boolean {
  return toolOutcomes.some((t) => {
    if (t.name !== "buscar_conhecimento") return false;
    if (t.ok && /"found"\s*:\s*true/i.test(t.preview)) return true;
    if (/"found"\s*:\s*true/i.test(t.preview) && !/"skipped"\s*:\s*true/i.test(t.preview)) return true;
    return false;
  });
}

/**
 * Mensagens que pedem factos da KB (endereço, Wi‑Fi, etc.) — não CPFs, localizadores ou respostas curtas de fluxo.
 */
export function userMessageLooksLikeKnowledgeSeekingQuery(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  const compact = t.replace(/\s+/g, "");
  // Documento / números (CPF, telefone, etc.)
  if (/^[\d.\-\/]+$/.test(compact) && compact.replace(/\D/g, "").length >= 8) return false;
  // Códigos tipo localizador (sem espaços, curtos)
  if (/^[A-Z0-9]{5,14}$/i.test(compact) && t.length <= 14) return false;
  // Respostas curtas de recolha de dados / confirmação
  if (
    t.length <= 48 &&
    /^(sim|n[aã]o|ok|okay|certo|correto|brasileiro|estrangeiro|yes|no|male|female|masculino|feminino)\b/i.test(t)
  ) {
    return false;
  }
  if (/\?/.test(t)) return true;
  if (
    /\b(qual|onde|como|quando|quanto|endere[cç]o|wifi|wi[\s-]?fi|senha|hor[aá]rio|pre[cç]o|estacionamento|pol[ií]tica|cancelamento|comodidade|what|where|how|when|address|password|parking)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Frase natural mais longa
  if (t.length >= 28 && /[\p{L}]{4,}/u.test(t)) return true;
  return false;
}

function hasNonKnowledgeToolsThisTurn(toolOutcomes: NativeToolRoundOutcome[]): boolean {
  return toolOutcomes.some((t) => t.name !== "buscar_conhecimento");
}

/**
 * Quando resgatar com KB (augment / entrega forçada).
 * Nunca despejar appendix proactivo sobre um turno de tools HTTP/fluxo (ex.: CPF → found:false).
 */
export function shouldForceKnowledgeDelivery(input: {
  replyText: string;
  kbHasUsefulExcerpts: boolean;
  toolOutcomes: NativeToolRoundOutcome[];
  configuredStallMessages?: string[];
  userMessage?: string;
  /** Master switch — default true. */
  forceDeliveryEnabled?: boolean;
  /** Resgate KB — default true. */
  forceKnowledgeRescue?: boolean;
}): boolean {
  if (input.forceDeliveryEnabled === false) return false;
  if (input.forceKnowledgeRescue === false) return false;

  const stallOnly = isNonDeliveringAgentReply(input.replyText, input.configuredStallMessages);
  const kbDeflect = isLikelyKbDeflectionOnlyReply(input.replyText);
  if (!stallOnly && !kbDeflect) return false;

  const kbToolOk = knowledgeToolFoundUsefulExcerpts(input.toolOutcomes);
  const nonKb = hasNonKnowledgeToolsThisTurn(input.toolOutcomes);
  const seeking = userMessageLooksLikeKnowledgeSeekingQuery(input.userMessage ?? "");

  // Turno de automação/HTTP: «não encontrei» pode ser correcto (found:false) — não substituir por artigos da KB.
  if (nonKb) {
    return kbToolOk && stallOnly;
  }

  // Só appendix proactivo: apenas se a pergunta parece de conhecimento.
  if (input.kbHasUsefulExcerpts) {
    return seeking || kbToolOk;
  }
  return kbToolOk;
}

/** Prefixo da entrega determinística KB — usado para não auto-aprovar dumps incorrectos. */
export const FORCED_KB_REPLY_PREFIX_RE = /^encontrei isto na nossa base de conhecimento/i;

function extractSnippetsFromKnowledgeToolPreview(preview: string): string[] {
  const snippets: string[] = [];
  const tryParse = (raw: string) => {
    try {
      return JSON.parse(raw) as {
        found?: boolean;
        articles?: Array<{ title?: string; excerpt?: string }>;
        bodyPreview?: string;
      };
    } catch {
      return null;
    }
  };
  let parsed = tryParse(preview);
  if (parsed?.bodyPreview && typeof parsed.bodyPreview === "string") {
    const inner = tryParse(parsed.bodyPreview);
    if (inner) parsed = inner;
  }
  if (parsed?.found && Array.isArray(parsed.articles)) {
    for (const a of parsed.articles.slice(0, 2)) {
      const title = typeof a.title === "string" ? a.title.trim() : "";
      const excerpt = typeof a.excerpt === "string" ? a.excerpt.trim() : "";
      if (!excerpt) continue;
      snippets.push((title ? `${title}\n` : "") + excerpt.slice(0, 900));
    }
  }
  return snippets;
}

function extractSnippetsFromProactiveAppendix(appendix: string): string[] {
  if (!kbAppendixHasRetrievedExcerpts(appendix)) return [];
  const withoutHeader = appendix.replace(
    /^[\s\S]*?###\s*Base de conhecimento \(excertos recuperados automaticamente\)\s*/i,
    "",
  );
  const withoutFooter = withoutHeader.replace(/\n\n\*\*Instruções:\*\*[\s\S]*$/i, "");
  const parts = withoutFooter.split(/\*\*\d+\.\s+/).slice(1);
  const snippets: string[] = [];
  for (const part of parts.slice(0, 2)) {
    const cleaned = part.replace(/\*\*/g, "").trim().slice(0, 900);
    if (cleaned.length >= 40) snippets.push(cleaned);
  }
  return snippets;
}

/**
 * Última linha sem novo LLM: monta resposta a partir de appendix / resultado de buscar_conhecimento.
 * Evita enviar «Só um momento» quando a KB já tem factos.
 */
export function buildDeterministicReplyFromKnowledge(input: {
  userMessage: string;
  proactiveAppendix?: string;
  toolOutcomes?: NativeToolRoundOutcome[];
}): string {
  const snippets: string[] = [];
  for (const t of input.toolOutcomes ?? []) {
    if (t.name !== "buscar_conhecimento") continue;
    snippets.push(...extractSnippetsFromKnowledgeToolPreview(t.preview));
    if (snippets.length >= 2) break;
  }
  if (snippets.length === 0 && input.proactiveAppendix) {
    snippets.push(...extractSnippetsFromProactiveAppendix(input.proactiveAppendix));
  }
  const unique = [...new Set(snippets.map((s) => s.trim()).filter(Boolean))].slice(0, 2);
  if (unique.length === 0) {
    return (
      "Consultei a base de conhecimento sobre o seu pedido, mas não consegui montar uma resposta clara neste momento. " +
      "Pode reformular a pergunta com um pouco mais de detalhe?"
    );
  }
  return (
    "Encontrei isto na nossa base de conhecimento:\n\n" +
    unique.join("\n\n---\n\n") +
    "\n\nSe precisar de mais algum detalhe, é só dizer."
  ).slice(0, 3500);
}

/** Resposta curta a negar informação quando já injectámos excertos da KB (modelo ignorou o contexto). */
function isLikelyKbDeflectionOnlyReply(text: string): boolean {
  const t = text.trim();
  if (t.length < 10 || t.length > 420) return false;
  if (/[.!?][\s\S]{110,}/.test(t)) return false;
  return /\b(não\s+(tenho|posso|sei|encontrei)\s+(essa\s+)?informa(c|ç)ão|não\s+há\s+informa(c|ç)ão|sem\s+informa(c|ç)ão\s+(sobre|disponível|n(a|ã)o\s+encontrad[ao])|não\s+consigo\s+(aceder|fornecer|confirmar|encontrar|localizar)|não\s+é\s+possível\s+(encontrar|localizar|obter|fornecer)|não\s+foi\s+possível\s+(encontrar|localizar|obter)|não\s+encontrei(\s+na\s+base)?|não\s+temos\s+(es[sa]ta\s+)?informa(c|ç)ão|infelizmente\s+não\s+(tenho|posso|consigo|encontro)|sem\s+dados\s+(sobre|suficientes)|não\s+está\s+disponível|i\s+don'?t\s+have\s+(that|this|the)\s+information|i\s+can'?t\s+find\s+(that|any))\b/i.test(
    t,
  );
}

function llmString(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "string" ? v.trim() : "";
}

export type NativeToolsFlags = {
  knowledge_search: boolean;
  transfer_to_team: boolean;
  list_teams: boolean;
  call_human: boolean;
  assign_contact_tags: boolean;
  set_conversation_status: boolean;
};

const defaultNativeTools = (): NativeToolsFlags => ({
  knowledge_search: true,
  transfer_to_team: false,
  list_teams: false,
  call_human: true,
  assign_contact_tags: false,
  set_conversation_status: false,
});

function applyFallbackNativeToolFlags(
  flags: NativeToolsFlags,
  fallbacks: InstructionFallback[],
): NativeToolsFlags {
  const next = { ...flags };
  for (const fb of fallbacks) {
    if (fb.action === "transfer_human") next.call_human = true;
    if (fb.action === "transfer_team") {
      next.transfer_to_team = true;
      next.list_teams = true;
    }
    if (fb.action === "set_pending") next.set_conversation_status = true;
  }
  return next;
}

function applyConnectedTagNativeToolFlags(flags: NativeToolsFlags, behavior: unknown): NativeToolsFlags {
  const next = { ...flags };
  for (const row of parseConnectedTagsFromBehavior(behavior)) {
    if (!row.enabled) continue;
    const ins = typeof row.agentInstruction === "string" ? row.agentInstruction.trim() : "";
    if (ins) {
      next.assign_contact_tags = true;
      break;
    }
  }
  return next;
}

export function parseNativeToolsFromBehavior(behavior: unknown): NativeToolsFlags {
  const base = defaultNativeTools();
  if (!behavior || typeof behavior !== "object") return base;
  const b = behavior as Record<string, unknown>;
  const raw = b.nativeTools;
  if (!raw || typeof raw !== "object") return base;
  const n = raw as Record<string, unknown>;
  const flag = (key: string, def: boolean): boolean => (key in n ? n[key] === true : def);
  const assignOn = flag("assign_team_to_conversation", false);
  const transferOn = flag("transfer_to_team", false);
  return {
    knowledge_search: flag("knowledge_search", base.knowledge_search),
    transfer_to_team: assignOn || transferOn,
    list_teams: flag("list_teams", false) || assignOn || transferOn,
    call_human: flag("call_human", base.call_human),
    assign_contact_tags: flag("assign_contact_tags", base.assign_contact_tags),
    set_conversation_status: flag("set_conversation_status", base.set_conversation_status),
  };
}

export type AgentConnectedTagRow = {
  tagId: string;
  enabled: boolean;
  agentInstruction?: string;
};

function parseConnectedTagsFromBehavior(behavior: unknown): AgentConnectedTagRow[] {
  if (!behavior || typeof behavior !== "object") return [];
  const raw = (behavior as Record<string, unknown>).connectedTags;
  if (!Array.isArray(raw)) return [];
  const out: AgentConnectedTagRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const tagId = typeof o.tagId === "string" ? o.tagId.trim() : "";
    if (!tagId) continue;
    out.push({
      tagId,
      enabled: o.enabled === true,
      agentInstruction: typeof o.agentInstruction === "string" ? o.agentInstruction : undefined,
    });
  }
  return out;
}

function parseConnectedTagAgentInstructions(behavior: unknown): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of parseConnectedTagsFromBehavior(behavior)) {
    if (!row.enabled) continue;
    const ins = typeof row.agentInstruction === "string" ? row.agentInstruction.trim() : "";
    if (ins) m.set(row.tagId, ins);
  }
  return m;
}

async function resolveAgentAssignableTagIds(
  _organizationId: string,
  behavior: unknown,
): Promise<string[]> {
  return parseConnectedTagsFromBehavior(behavior)
    .filter((x) => x.enabled)
    .map((x) => x.tagId);
}

function formatKnowledgeToolResult(
  ranked: Array<{ article: { id: string; title: string }; excerpt: string; score: number }>,
): string {
  if (!ranked.length) {
    return JSON.stringify({ found: false, message: "Nenhum artigo relevante na base de conhecimento." });
  }
  const items = ranked.slice(0, 6).map((r) => ({
    id: r.article.id,
    title: r.article.title,
    excerpt: r.excerpt,
    score: Math.round(r.score * 1000) / 1000,
  }));
  return JSON.stringify({ found: true, articles: items });
}

function buildOpenAiTools(
  flags: NativeToolsFlags,
  opts?: { omitBuscarConhecimento?: boolean; assignableTagsDescription?: string },
): OpenAiToolDefinition[] {
  const tools: OpenAiToolDefinition[] = [];
  if (flags.knowledge_search && !opts?.omitBuscarConhecimento) {
    tools.push({
      type: "function",
      function: {
        name: "buscar_conhecimento",
        description:
          "Pesquisa na base de conhecimento da organização. OBRIGATÓRIO usar esta função antes de dizer que vai ‘verificar’ ou ‘buscar’ informações factuais (endereços, preços, políticas, horários). Depois responda ao cliente com os dados retornados.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Consulta em linguagem natural (ex.: endereço da loja)" },
          },
          required: ["query"],
        },
      },
    });
  }
  if (flags.list_teams) {
    tools.push({
      type: "function",
      function: {
        name: "listar_equipas",
        description:
          "Lista equipas (times) da organização com id UUID e nome. Use para descobrir o teamId correto antes de transferir.",
        parameters: { type: "object", properties: {} },
      },
    });
  }
  if (flags.transfer_to_team) {
    tools.push({
      type: "function",
      function: {
        name: "transfer_to_team",
        description:
          "Transfere a conversa para uma equipa humana. O team_id deve ser o UUID exato da equipa (não use números como 1). Se não souber o UUID, chame listar_equipas primeiro.",
        parameters: {
          type: "object",
          properties: {
            team_id: { type: "string", description: "UUID da equipa (ex.: 0727f763-09b4-4aae-acb6-1e25a93b3a1c)" },
            reason: { type: "string", description: "Motivo curto para a equipa (nota interna, não vai ao cliente)" },
          },
          required: ["team_id"],
        },
      },
    });
  }
  if (flags.assign_contact_tags && opts?.assignableTagsDescription?.trim()) {
    const tagDesc = opts.assignableTagsDescription.trim();
    tools.push({
      type: "function",
      function: {
        name: "listar_etiquetas",
        description:
          "Lista etiquetas (tags) que este agente pode atribuir ao contacto da conversa, com id UUID e nome. Use antes de atribuir_etiquetas se precisar confirmar UUIDs.",
        parameters: { type: "object", properties: {} },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "atribuir_etiquetas",
        description:
          `Atribui etiquetas ao contacto desta conversa quando os critérios do system prompt se aplicarem. Siga as instruções por etiqueta. Só use tag_ids permitidos.\n${tagDesc}`,
        parameters: {
          type: "object",
          properties: {
            tag_ids: {
              type: "array",
              items: { type: "string" },
              description: "Lista de UUIDs de etiquetas (máx. 12)",
            },
            mode: {
              type: "string",
              enum: ["add", "replace"],
              description: "add = acrescenta; replace = substitui todas as etiquetas do contacto",
            },
          },
          required: ["tag_ids"],
        },
      },
    });
  }
  if (flags.call_human) {
    tools.push({
      type: "function",
      function: {
        name: "call_human",
        description:
          "Abre a conversa para atendimento humano (fila de agentes). Use quando o cliente pedir falar com pessoa / atendente. Indique sempre `reason` (motivo curto) para a equipa no painel.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Motivo da transferência (visível só na equipa, nota interna)" },
            team_id: { type: "string", description: "UUID opcional da equipa para encaminhar" },
          },
        },
      },
    });
  }
  if (flags.set_conversation_status) {
    tools.push({
      type: "function",
      function: {
        name: "set_conversation_status",
        description:
          "Altera o estado da conversa no CRM. Use PENDING quando precisar marcar como pendente (ex.: aguarda resposta interna).",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["OPEN", "PENDING", "RESOLVED"],
              description: "Novo estado da conversa",
            },
          },
          required: ["status"],
        },
      },
    });
  }
  return tools;
}

async function executeNativeTool(input: {
  name: string;
  argsJson: string;
  organizationId: string;
  botId: string;
  conversationId: string;
  flags: NativeToolsFlags;
  allowedTagIds: string[];
  log: FastifyBaseLogger;
  pinnedArticleIds: string[] | undefined;
  userMessage?: string;
}): Promise<string> {
  const {
    name,
    argsJson,
    organizationId,
    botId,
    conversationId,
    flags,
    allowedTagIds,
    log,
    pinnedArticleIds,
    userMessage,
  } = input;
  let args: Record<string, unknown> = {};
  try {
    const p = JSON.parse(argsJson || "{}");
    if (p && typeof p === "object") args = p as Record<string, unknown>;
  } catch {
    return JSON.stringify({ ok: false, error: "invalid_json_arguments" });
  }

  try {
    if (name === "buscar_conhecimento" && flags.knowledge_search) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return JSON.stringify({ ok: false, error: "missing_query" });
      const norm = query.toLowerCase().slice(0, 500);
      let ranked = (
        await rankedKnowledgeSearch({
          organizationId,
          normalizedQuery: norm,
          botId,
          limit: 8,
          debugLog: log,
        })
      ).ranked;
      ranked = await mergePinnedKnowledgeWhenRankedEmpty({
        organizationId,
        ranked,
        pinnedArticleIds,
        debugLog: log,
      });
      ranked = await mergeBotLinkedKnowledgeWhenRankedEmpty({
        organizationId,
        botId,
        ranked,
        debugLog: log,
      });
      ranked = ranked.slice(0, 8);
      return formatKnowledgeToolResult(ranked);
    }

    if (name === "listar_equipas" && flags.list_teams) {
      const teams = await prisma.team.findMany({
        where: { organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 80,
      });
      return JSON.stringify({ ok: true, teams });
    }

    if ((name === "transfer_to_team" || name === "assign_team_to_conversation") && flags.transfer_to_team) {
      const teamIdRaw = args.team_id ?? args.teamId;
      const teamId = typeof teamIdRaw === "string" ? teamIdRaw.trim() : "";
      if (!teamId) return JSON.stringify({ ok: false, error: "missing_team_id_uuid" });
      const r = await assignConversationTeamForOrg(prisma, {
        organizationId,
        conversationId,
        body: { teamId, assignedToId: null },
      });
      if (!r.ok) {
        return JSON.stringify({ ok: false, error: r.error.message });
      }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "OPEN", updatedAt: new Date() },
      });
      const reason = typeof args.reason === "string" ? args.reason : null;
      const snippet = (userMessage ?? "").trim();
      try {
        await recordNativeAgentTransferHandoff({
          organizationId,
          conversationId,
          toolName: name === "assign_team_to_conversation" ? "assign_team_to_conversation" : "transfer_to_team",
          reason,
          userMessageSnippet: snippet,
          teamName: r.payload.team?.name ?? null,
        });
      } catch (err) {
        log.warn({ err, conversationId }, "recordNativeAgentTransferHandoff failed after transfer_to_team");
      }
      return JSON.stringify({
        ok: true,
        teamId: r.payload.teamId,
        teamName: r.payload.team?.name ?? null,
        message: "Conversa atribuída à equipa e aberta para atendentes humanos.",
      });
    }

    if (name === "listar_etiquetas" && flags.assign_contact_tags) {
      const ids = allowedTagIds.length ? allowedTagIds : [];
      const tags = ids.length
        ? await prisma.tag.findMany({
            where: { organizationId, id: { in: ids } },
            select: { id: true, name: true, color: true },
            orderBy: { name: "asc" },
          })
        : [];
      return JSON.stringify({ ok: true, tags });
    }

    if (name === "atribuir_etiquetas" && flags.assign_contact_tags) {
      const rawIds = args.tag_ids ?? args.tagIds;
      const tagIds = Array.isArray(rawIds)
        ? rawIds.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
        : [];
      if (!tagIds.length) return JSON.stringify({ ok: false, error: "missing_tag_ids" });
      const allowed = new Set(allowedTagIds);
      const filtered = tagIds.filter((id) => allowed.has(id)).slice(0, 12);
      if (!filtered.length) {
        return JSON.stringify({ ok: false, error: "tag_ids_not_allowed_for_agent" });
      }
      const modeRaw = args.mode;
      const mode = modeRaw === "replace" ? "replace" : "add";
      const r = await assignTagsToConversationContact(prisma, {
        organizationId,
        conversationId,
        tagIds: filtered,
        mode,
      });
      if (!r.ok) {
        return JSON.stringify({ ok: false, error: r.error });
      }
      return JSON.stringify({
        ok: true,
        contactId: r.contactId,
        tags: r.tags,
        message: "Etiquetas atribuídas ao contacto da conversa.",
      });
    }

    if (name === "call_human" && flags.call_human) {
      const teamIdRaw = args.team_id ?? args.teamId;
      const teamId =
        typeof teamIdRaw === "string" && teamIdRaw.trim().length >= 32 ? teamIdRaw.trim() : null;
      let teamName: string | null = null;
      if (teamId) {
        const r = await assignConversationTeamForOrg(prisma, {
          organizationId,
          conversationId,
          body: { teamId, assignedToId: null },
        });
        if (!r.ok) {
          log.warn({ err: r.error }, "call_human team assign failed");
        } else {
          teamName = r.payload.team?.name ?? null;
        }
      }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "OPEN", assignedToId: null, updatedAt: new Date() },
      });
      const reason = typeof args.reason === "string" ? args.reason : null;
      const snippet = (userMessage ?? "").trim();
      try {
        await recordNativeAgentTransferHandoff({
          organizationId,
          conversationId,
          toolName: "call_human",
          reason,
          userMessageSnippet: snippet,
          teamName,
        });
      } catch (err) {
        log.warn({ err, conversationId }, "recordNativeAgentTransferHandoff failed after call_human");
      }
      return JSON.stringify({ ok: true, message: "Conversa aberta para atendimento humano." });
    }

    if (name === "set_conversation_status" && flags.set_conversation_status) {
      const statusRaw = args.status ?? args.conversationStatus;
      const status =
        typeof statusRaw === "string" ? statusRaw.trim().toUpperCase() : "";
      if (status !== "OPEN" && status !== "PENDING" && status !== "RESOLVED") {
        return JSON.stringify({ ok: false, error: "invalid_status" });
      }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status, updatedAt: new Date() },
      });
      return JSON.stringify({ ok: true, status, message: "Estado da conversa actualizado." });
    }
  } catch (err) {
    log.warn({ err, tool: name }, "native agent tool failed");
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "tool_error" });
  }

  return JSON.stringify({ ok: false, error: "unknown_or_disabled_tool", tool: name });
}

/** Ferramentas HTTP/WEBHOOK ligadas ao agente com `runMode` ≠ manual — expostas ao modelo nativo. */
function parseEnabledNativeHttpCustomToolIds(behavior: unknown): string[] {
  if (!behavior || typeof behavior !== "object") return [];
  const raw = (behavior as Record<string, unknown>).connectedTools;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.enabled !== true) continue;
    const id = typeof o.toolId === "string" ? o.toolId.trim() : "";
    if (!id) continue;
    if (o.runMode === "manual") continue;
    ids.push(id);
  }
  return ids;
}

/** Instruções por `toolId` a partir de `behavior.connectedTools[].agentInstruction`. */
function parseConnectedToolAgentInstructions(behavior: unknown): Map<string, string> {
  const m = new Map<string, string>();
  if (!behavior || typeof behavior !== "object") return m;
  const raw = (behavior as Record<string, unknown>).connectedTools;
  if (!Array.isArray(raw)) return m;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.enabled !== true) continue;
    const id = typeof o.toolId === "string" ? o.toolId.trim() : "";
    if (!id) continue;
    const ins = typeof o.agentInstruction === "string" ? o.agentInstruction.trim() : "";
    if (ins) m.set(id, ins);
  }
  return m;
}

async function augmentReplyWithToolOutcomes(params: {
  userMessage: string;
  draftReply: string;
  toolOutcomes: NativeToolRoundOutcome[];
  systemInstructions: string;
  history: PreviewChatTurn[];
  provider: string;
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
  log: FastifyBaseLogger;
}): Promise<string> {
  const monitored = params.toolOutcomes.filter((t) => t.monitored);
  if (!monitored.length) return params.draftReply.trim();
  const toolBlock = monitored
    .map((t, i) => `${i + 1}. ${t.name} — ${t.ok ? "ok" : "falhou"}: ${t.preview}`)
    .join("\n");
  const extra =
    "\n\n[OpenConduit — resultado de ferramentas]\n" +
    "O cliente ainda não recebeu uma resposta substantiva após consultas automáticas.\n" +
    "Use os resultados abaixo para responder de forma clara e completa (mesma língua do cliente).\n" +
    "Se alguma ferramenta falhou, explique o que falta ou peça só o necessário.\n" +
    "Não repita apenas «um momento» ou «vou verificar».\n\n" +
    toolBlock;
  try {
    if (params.provider === "google_gemini") {
      const r = await callGeminiGenerateContent({
        apiKey: params.apiKey,
        model: params.model,
        temperature: params.temperature,
        maxTokens: Math.max(16, Math.min(8192, params.maxTokens)),
        system: params.systemInstructions + extra,
        history: params.history,
        userMessage: params.userMessage,
        signal: params.signal,
      });
      return r.text.trim();
    }
    const r = await callOpenAiCompatibleChat({
      baseUrl: params.apiBaseUrl.replace(/\/+$/, ""),
      apiKey: params.apiKey,
      model: params.model,
      temperature: params.temperature,
      maxTokens: Math.max(16, Math.min(8192, params.maxTokens)),
      system: params.systemInstructions + extra,
      history: params.history,
      userMessage: params.userMessage,
      signal: params.signal,
    });
    return r.text.trim();
  } catch (err) {
    params.log.warn({ err }, "native tool outcome augment failed");
    return params.draftReply.trim();
  }
}

async function augmentStallWithKnowledge(params: {
  organizationId: string;
  botId: string;
  userMessage: string;
  systemInstructions: string;
  history: PreviewChatTurn[];
  provider: string;
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
  log: FastifyBaseLogger;
  pinnedArticleIds: string[] | undefined;
  /** Appendix proactivo já calculado — evita segunda pesquisa e acelera a correção. */
  proactiveAppendix?: string;
}): Promise<string> {
  const norm = params.userMessage.trim().toLowerCase().slice(0, 500);
  if (!norm) return "";
  try {
    let kbBlock = "";
    if (params.proactiveAppendix && kbAppendixHasRetrievedExcerpts(params.proactiveAppendix)) {
      kbBlock = params.proactiveAppendix;
    } else {
      let ranked = (
        await rankedKnowledgeSearch({
          organizationId: params.organizationId,
          normalizedQuery: norm,
          botId: params.botId,
          limit: 6,
          debugLog: params.log,
        })
      ).ranked;
      ranked = await mergePinnedKnowledgeWhenRankedEmpty({
        organizationId: params.organizationId,
        ranked,
        pinnedArticleIds: params.pinnedArticleIds,
        debugLog: params.log,
      });
      ranked = await mergeBotLinkedKnowledgeWhenRankedEmpty({
        organizationId: params.organizationId,
        botId: params.botId,
        ranked,
        debugLog: params.log,
      });
      ranked = ranked.slice(0, 6);
      kbBlock = formatKnowledgeToolResult(ranked);
    }
    const extra =
      "\n\n[OpenConduit — correção obrigatória]\n" +
      "A tua resposta anterior era só espera («um momento» / «vou verificar») ou deflexão sem factos.\n" +
      "Responde AGORA ao cliente com factos concretos dos excertos abaixo.\n" +
      "PROIBIDO responder só com frases de espera («um momento», «aguarde», «vou verificar») sem dados.\n" +
      "Se os excertos não cobrirem a pergunta, diga honestamente o que falta — sem inventar.\n\n" +
      kbBlock;
    const system = params.systemInstructions + extra;
    // Histórico curto: evita o modelo repetir o stall dos turnos anteriores.
    const shortHistory = params.history.slice(-4);
    let text = "";
    if (params.provider === "google_gemini") {
      const r = await callGeminiGenerateContent({
        apiKey: params.apiKey,
        model: params.model,
        temperature: Math.min(params.temperature, 0.4),
        maxTokens: Math.max(16, Math.min(8192, params.maxTokens)),
        system,
        history: shortHistory,
        userMessage: params.userMessage,
        signal: params.signal,
      });
      text = r.text.trim();
    } else {
      const r = await callOpenAiCompatibleChat({
        baseUrl: params.apiBaseUrl.replace(/\/+$/, ""),
        apiKey: params.apiKey,
        model: params.model,
        temperature: Math.min(params.temperature, 0.4),
        maxTokens: Math.max(16, Math.min(8192, params.maxTokens)),
        system,
        history: shortHistory,
        userMessage: params.userMessage,
        signal: params.signal,
      });
      text = r.text.trim();
    }
    if (!text || isNonDeliveringAgentReply(text)) return "";
    return text;
  } catch (err) {
    params.log.warn({ err }, "native stall knowledge augment failed");
    return "";
  }
}

/**
 * Gera resposta do agente nativo (tools + correção de “vou verificar” sem retorno).
 */
export async function generateNativeAgentReply(input: {
  organizationId: string;
  bot: Bot;
  conversation: Conversation;
  message: Message;
  log: FastifyBaseLogger;
  /** Opcional: registo de execução (Automação → Execuções) por mensagem inbound. */
  executionLog?: AutomationExecutionLogPort | null;
  /** Test-chat: histórico vindo do cliente em vez da BD. */
  historyOverride?: PreviewChatTurn[];
  /** Contacto da conversa — necessário para aviso pré-ferramenta outbound. */
  contactId?: string;
}): Promise<string> {
  const {
    organizationId,
    bot,
    conversation,
    message,
    log,
    executionLog: ex,
    historyOverride,
    contactId,
  } = input;
  if (message.direction !== "INBOUND") return "";
  const userMessageRaw = (message.body ?? "").trim();
  const hasInboundMedia =
    Boolean(message.mediaUrl?.trim()) &&
    (message.type === "IMAGE" || message.type === "DOCUMENT" || message.type === "VIDEO");
  if (!userMessageRaw && !hasInboundMedia) return "";
  const userMessage =
    userMessageRaw ||
    (message.type === "IMAGE"
      ? "[Imagem enviada pelo cliente]"
      : message.type === "DOCUMENT"
        ? "[Documento enviado pelo cliente]"
        : "[Ficheiro enviado pelo cliente]");

  const profile = await prisma.automationAgentProfile.findUnique({
    where: { botId: bot.id },
    select: { llmConfig: true, behaviorConfig: true },
  });
  if (!profile?.llmConfig || typeof profile.llmConfig !== "object") {
    log.warn({ botId: bot.id }, "Agent bot native fallback skipped: missing automation profile");
    ex?.warn({ id: "profile", name: "Perfil de automação" }, "Perfil em falta — geração abortada");
    if (isAgentKbDebugEnabled()) {
      logAgentKbDebug(log, {
        stage: "nativeAgentReply_skipped",
        reason: "missing_automation_agent_profile",
        botId: bot.id,
        conversationId: conversation.id,
        organizationId,
      });
    }
    return "";
  }

  const llm = profile.llmConfig as Record<string, unknown>;
  const provider = llmString(llm, "provider") || "openai";
  const model = llmString(llm, "model") || "gpt-4o-mini";
  const storedKey = llmString(llm, "apiKey");
  /** Mesma ordem que embeddings/playground: chave no perfil ou `OPENAI_PROMPT_PREVIEW_KEY` / `OPENAI_API_KEY` no servidor. */
  const apiKey =
    storedKey && storedKey !== "***"
      ? storedKey
      : provider === "openai"
        ? config.openAiPromptPreviewKey.trim()
        : provider === "google_gemini"
          ? config.geminiPromptPreviewKey.trim()
          : "";
  if (!apiKey) {
    log.warn(
      { botId: bot.id },
      "Agent bot native fallback skipped: API key not configured (perfil do agente ou OPENAI_API_KEY / OPENAI_PROMPT_PREVIEW_KEY / GEMINI_PROMPT_PREVIEW_KEY no servidor)",
    );
    ex?.warn({ id: "llm_keys", name: "Chaves API" }, "Chave API em falta no perfil ou env do servidor");
    if (isAgentKbDebugEnabled()) {
      logAgentKbDebug(log, {
        stage: "nativeAgentReply_skipped",
        reason: "missing_api_key",
        botId: bot.id,
        conversationId: conversation.id,
        organizationId,
        provider,
      });
    }
    return "";
  }
  const temperatureRaw = llm.temperature;
  const maxTokensRaw = llm.maxTokens;
  const temperature =
    typeof temperatureRaw === "number" && Number.isFinite(temperatureRaw) ? temperatureRaw : 0.7;
  const maxTokens =
    typeof maxTokensRaw === "number" && Number.isFinite(maxTokensRaw) ? Math.trunc(maxTokensRaw) : 1024;
  let systemInstructions =
    llmString(llm, "systemInstructions") ||
    "Você é um agente de atendimento útil, objetivo e cordial. Responda de forma curta e prática.";

  const pbNested = (() => {
    const beh = profile.behaviorConfig;
    if (!beh || typeof beh !== "object") return null;
    const pb = (beh as Record<string, unknown>).promptBuilder;
    return pb && typeof pb === "object" ? (pb as Record<string, unknown>) : null;
  })();
  let instructionFallbacks = parseInstructionFallbacks(pbNested?.instructionFallbacks);
  if (instructionFallbacks.some((f) => f.action === "transfer_team" && f.teamId)) {
    const teamIds = [
      ...new Set(
        instructionFallbacks
          .filter((f) => f.action === "transfer_team" && f.teamId)
          .map((f) => f.teamId as string),
      ),
    ];
    if (teamIds.length > 0) {
      const teamRows = await prisma.team.findMany({
        where: { organizationId, id: { in: teamIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(teamRows.map((t) => [t.id, t.name]));
      instructionFallbacks = instructionFallbacks.map((f) =>
        f.action === "transfer_team" && f.teamId
          ? { ...f, teamName: nameById.get(f.teamId) ?? f.teamName ?? f.teamId }
          : f,
      );
    }
  }
  systemInstructions = mergeInstructionFallbacksIntoSystemPrompt(systemInstructions, instructionFallbacks);
  systemInstructions = applyAgentPlaybookToSystemInstructions(systemInstructions, pbNested);

  let flags = applyConnectedTagNativeToolFlags(
    applyFallbackNativeToolFlags(parseNativeToolsFromBehavior(profile.behaviorConfig), instructionFallbacks),
    profile.behaviorConfig,
  );
  const apiBaseUrl = llmString(llm, "apiBaseUrl") || "https://api.openai.com/v1";
  const pinnedArticleIds = parseLinkedKnowledgeArticleIdsFromBehavior(profile.behaviorConfig);
  const toolCallNotify = parseToolCallNotifyFromBehavior(profile.behaviorConfig);
  /** Mensagens de espera do agente (config + default) — nunca válidas como resposta final. */
  const configuredStallMessages = [
    ...new Set(
      [
        toolCallNotify.message,
        DEFAULT_TOOL_CALL_NOTIFY_MESSAGE,
        ...Object.values(toolCallNotify.toolMessages),
      ]
        .map((m) => m.trim())
        .filter((m) => m.length >= 6),
    ),
  ];
  const effectiveContactId = contactId ?? conversation.contactId ?? undefined;
  const sandboxReply = historyOverride != null;
  type PendingToolCallInterim = {
    body: string;
    toolNames: string[];
    round: number;
    usedAgentStallText: boolean;
    sent: boolean;
  };
  const pendingToolCallInterim: { data: PendingToolCallInterim | null } = { data: null };

  const nativeHttpCustomToolIds = parseEnabledNativeHttpCustomToolIds(profile.behaviorConfig);
  let customHttpTools: AutomationHttpToolRow[] = [];
  if (nativeHttpCustomToolIds.length > 0) {
    const rows = await prisma.automationCustomTool.findMany({
      where: { organizationId, id: { in: nativeHttpCustomToolIds }, isActive: true },
      select: {
        id: true,
        organizationId: true,
        name: true,
        description: true,
        toolType: true,
        config: true,
        parametersSchema: true,
      },
    });
    const order = new Map(nativeHttpCustomToolIds.map((id, i) => [id, i]));
    customHttpTools = rows
      .filter((r) => r.toolType === "HTTP_API" || r.toolType === "WEBHOOK")
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  const agentInstructionByToolId = parseConnectedToolAgentInstructions(profile.behaviorConfig);
  const allowedTagIds = flags.assign_contact_tags
    ? await resolveAgentAssignableTagIds(organizationId, profile.behaviorConfig)
    : [];
  let assignableTagsDescription = "";
  if (flags.assign_contact_tags && allowedTagIds.length > 0) {
    const tagRows = await prisma.tag.findMany({
      where: { organizationId, id: { in: allowedTagIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const tagInstr = parseConnectedTagAgentInstructions(profile.behaviorConfig);
    assignableTagsDescription = tagRows
      .map((t) => {
        const ins = tagInstr.get(t.id);
        return ins ? `- ${t.name} (\`${t.id}\`): ${ins}` : `- ${t.name} (\`${t.id}\`)`;
      })
      .join("\n");
  }
  const customToolPreamble =
    customHttpTools.length > 0
      ? "\n- **Ferramentas HTTP da organização:** existem funções com nome `oc_tool_` + identificador. Use-as para consultar APIs externas (ex.: reservas, PMS) **antes** de `call_human` ou transferências, quando o pedido do cliente for compatível com o contrato de cada função.\n" +
        "- **Várias ferramentas na mesma ronda:** só invoque em paralelo ferramentas independentes. Respeite dependências do fluxo (ex.: concluir um passo antes de outro que precise do resultado).\n" +
        "- **Após ferramentas:** responda sempre ao cliente com o resultado concreto (sucesso, erro ou dados em falta) — não termine só com frases de espera.\n"
      : "";
  const toolRoundOutcomes: NativeToolRoundOutcome[] = [];
  let knowledgeSearchCallsThisTurn = 0;

  let kbProactiveAppendix = "";
  if (flags.knowledge_search) {
    try {
      kbProactiveAppendix = await fetchProactiveKnowledgeSystemAppendix({
        organizationId,
        botId: bot.id,
        userMessage,
        limit: 8,
        pinnedArticleIds,
        debugLog: log,
      });
    } catch (err) {
      log.warn({ err, botId: bot.id }, "proactive knowledge appendix failed");
      ex?.child("rag")?.error({ id: "proactive_kb", name: "RAG proactivo" }, "Falha ao montar appendix", {
        stack: err instanceof Error ? err.stack : undefined,
        input: { userMessage: userMessage.slice(0, 500) },
      });
    }
  }

  ex?.debug(
    { id: "rag", name: "Base de conhecimento" },
    "Appendix proactivo preparado",
    {
      output: {
        knowledgeSearch: flags.knowledge_search,
        appendixChars: kbProactiveAppendix.length,
        hasUsefulExcerpts: flags.knowledge_search && kbAppendixHasRetrievedExcerpts(kbProactiveAppendix),
      },
    },
  );

  const kbHasUsefulExcerpts =
    flags.knowledge_search && kbAppendixHasRetrievedExcerpts(kbProactiveAppendix);
  /**
   * Mantemos `buscar_conhecimento` registado quando `knowledge_search` está activo (prompts rígidos).
   * Limite de invocações no turno evita queimar TPM com 3–4 pesquisas idênticas após o appendix proactivo.
   */
  const omitBuscarConhecimento = false;

  const toolPreamble = kbHasUsefulExcerpts
    ? "\n\n### Ferramentas (complemento)\n" +
      "- **Base de conhecimento:** a secção acima **já contém excertos** recuperados para a última mensagem do cliente (pesquisa automática no servidor). Responda com factos concretos quando constarem aí.\n" +
      "- **PROIBIDO** como resposta final: frases de espera («um momento», «aguarde», «vou verificar») sem factos. Isso só pode ser aviso intermédio do sistema — a mensagem final tem de trazer a informação.\n" +
      "- **`buscar_conhecimento`:** no máximo **uma** chamada neste turno se o prompt exigir invocação explícita; depois responda ao cliente com os excertos (não repita a pesquisa).\n" +
      "- `transfer_to_team` / `listar_equipas`: apenas com UUID real de equipa.\n" +
      (allowedTagIds.length > 0
        ? "- `listar_etiquetas` / `atribuir_etiquetas`: atribua etiquetas ao contacto quando os critérios do prompt se aplicarem; use só UUIDs permitidos.\n"
        : "") +
      "- `call_human`: apenas se o cliente pedir humano/atendente **ou** se os excertos / resultado da busca forem claramente insuficientes." +
      customToolPreamble
    : "\n\n### Ferramentas (complemento)\n" +
      "- Use `buscar_conhecimento` para factos da organização antes de dizer que vai verificar — no máximo **duas** chamadas neste turno; depois responda.\n" +
      "- **PROIBIDO** como resposta final: frases de espera («um momento» / «vou verificar») sem dados da ferramenta.\n" +
      "- `transfer_to_team` / `listar_equipas`: use UUID real de equipa.\n" +
      (allowedTagIds.length > 0
        ? "- `listar_etiquetas` / `atribuir_etiquetas`: atribua etiquetas ao contacto quando as regras do agente o indicarem.\n"
        : "") +
      "- `call_human`: **apenas** se o cliente pedir humano/atendente **ou** se, depois de `buscar_conhecimento`, não for possível responder com verdade — **não** use para perguntas factuais que a base já cobre." +
      customToolPreamble;

  const serverKbGuard =
    (kbHasUsefulExcerpts
      ? "\n\n[OpenConduit — precedência sobre instruções conflituantes no prompt do agente]\n" +
        "A secção «Base de conhecimento» acima contém o resultado da pesquisa automática para a última mensagem do cliente. " +
        "Se os excertos contiverem dados sobre o que foi perguntado, responda com esses dados de forma directa. " +
        "A função `buscar_conhecimento` pode ser usada no máximo uma vez neste turno se as suas regras exigirem chamada explícita; isso **não** significa que a primeira pesquisa «falhou». " +
        "**Não** invoque `call_human` nem `transfer_to_team` só porque o prompt do agente diz «se buscar_conhecimento falhar» quando já há excertos ou JSON útil com a resposta. " +
        "Use `call_human` só se o cliente pedir atendente/humano **ou** se, depois de usar excertos e/ou `buscar_conhecimento`, a informação continuar insuficiente. " +
        "Esta precedência **não** anula restrições do playbook do tipo «nunca informar X sem consultar a ferramenta» — nesse caso chame a tool indicada antes de afirmar dados."
      : "") +
    (customHttpTools.length > 0
      ? "\n\n[OpenConduit — ferramentas HTTP da organização]\n" +
        "Existem funções com nome `oc_tool_` no catálogo: são integrações HTTP/Webhook configuradas para este agente. " +
        "Para consultas de reserva, estado de booking ou outros dados expostos por essas APIs, **chame primeiro** a função adequada com os argumentos do schema; só depois use `call_human` se a API falhar ou a resposta for insuficiente. " +
        "Respeite sempre as restrições e fluxos do playbook do agente ao decidir quando e como usar estas ferramentas."
      : "");

  const audioInboundHint =
    message.type === "AUDIO" || userMessage.includes(AUDIO_TRANSCRIPTION_PREFIX)
      ? "\n\n[OpenConduit — entrada de áudio]\n" +
        "Se o texto do cliente começar por «" +
        AUDIO_TRANSCRIPTION_PREFIX +
        "», trate o que segue como o conteúdo falado numa nota de voz do cliente."
      : "";

  const imageInboundHint =
    message.type === "IMAGE" ||
    message.type === "DOCUMENT" ||
    userMessage.includes(IMAGE_TRANSCRIPTION_PREFIX)
      ? "\n\n[OpenConduit — entrada de imagem/documento]\n" +
        "Se o texto incluir «" +
        IMAGE_TRANSCRIPTION_PREFIX +
        "», trata-o apenas como ajuda de compreensão (descrição/OCR). " +
        "O ficheiro binário original permanece disponível no servidor para ferramentas HTTP " +
        "(templates {{attachmentBase64}} / multipart) — **não** inventes base64 nem copies o JSON da transcrição como anexo. " +
        "Quando precisares de enviar a imagem/documento a uma API, invoca a tool de upload; o runtime injecta a mídia da mensagem actual."
      : "";

  const automationCtx = await loadAutomationConversationContext(conversation.id);
  const followUpPrompt = automationCtx.state.followUpCampaign
    ? buildFollowUpCampaignPromptBlock(automationCtx.state.followUpCampaign)
    : "";
  const flowStatePrompt = buildNativeFlowStatePromptBlock(automationCtx.state);

  const tagToolGuard =
    flags.assign_contact_tags && allowedTagIds.length > 0 && assignableTagsDescription.trim()
      ? "\n\n[OpenConduit — etiquetas de contacto]\n" +
        "Quando a mensagem do cliente cumprir os critérios da secção «Instruções por etiqueta» (ou equivalente) no system prompt, **deve invocar** `atribuir_etiquetas` com o `tag_id` correcto — não basta descrever a classificação na resposta sem chamar a ferramenta.\n" +
        "Etiquetas permitidas:\n" +
        assignableTagsDescription.trim()
      : "";

  const systemBase =
    systemInstructions +
    kbProactiveAppendix +
    toolPreamble +
    serverKbGuard +
    tagToolGuard +
    audioInboundHint +
    imageInboundHint +
    followUpPrompt +
    flowStatePrompt;

  const lastClearedAt = automationCtx.lastClearedAt;

  const history =
    historyOverride ??
    (
      await prisma.message.findMany({
        where: buildNativeAgentMessageWhere({
          conversationId: conversation.id,
          excludeMessageId: message.id,
          lastClearedAt,
        }),
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { direction: true, body: true },
      })
    )
      .reverse()
      .map((m) => ({
        role: m.direction === "INBOUND" ? ("user" as const) : ("assistant" as const),
        content: (m.body ?? "").trim(),
      }))
      .filter((m): m is PreviewChatTurn => Boolean(m.content));

  let replyText = "";
  let completedToolRounds = 0;

  const tools: OpenAiToolDefinition[] = [
    ...buildOpenAiTools(flags, { omitBuscarConhecimento, assignableTagsDescription }),
    ...customHttpTools.map((row) =>
      openAiToolDefinitionForAutomationTool(row, { agentInstruction: agentInstructionByToolId.get(row.id) }),
    ),
  ];
  const useTools = provider !== "google_gemini" && tools.length > 0;

  let httpToolRuntimeContext: Record<string, unknown> | undefined;
  let sessionFlowSlots: AutomationFlowSlots = { ...(automationCtx.state.flowSlots ?? {}) };
  if (customHttpTools.length > 0 && historyOverride == null) {
    const contactRow = effectiveContactId
      ? await prisma.contact.findFirst({
          where: { id: effectiveContactId, organizationId },
          select: { id: true, name: true, phone: true },
        })
      : null;
    httpToolRuntimeContext = await buildNativeAgentHttpToolRuntimeContext({
      organizationId,
      conversationId: conversation.id,
      lastClearedAt,
      message,
      contact: contactRow,
    });
    if (Object.keys(sessionFlowSlots).length > 0) {
      httpToolRuntimeContext = {
        ...httpToolRuntimeContext,
        flowSlots: sessionFlowSlots,
        conversation: {
          ...((httpToolRuntimeContext.conversation as Record<string, unknown>) ?? { id: conversation.id }),
          flowSlots: sessionFlowSlots,
          ...(automationCtx.state.flowStep ? { flowStep: automationCtx.state.flowStep } : {}),
        },
      };
    }
  }

  const signal = nativeAgentLlmAbortSignal();

  if (isAgentKbDebugEnabled()) {
    logAgentKbDebug(log, {
      stage: "nativeAgentReply_start",
      organizationId,
      botId: bot.id,
      conversationId: conversation.id,
      knowledge_search: flags.knowledge_search,
      pinnedArticleIdsCount: pinnedArticleIds.length,
      provider,
      useTools,
      omitBuscarConhecimento,
      kbHasUsefulExcerpts,
      openAiToolCount: tools.length,
      lastClearedAt: lastClearedAt?.toISOString() ?? null,
      historyTurns: history.length,
      apiKeySource:
        storedKey && storedKey !== "***"
          ? "profile"
          : provider === "openai" && config.openAiPromptPreviewKey.trim()
            ? "server_openai_env"
            : provider === "google_gemini" && config.geminiPromptPreviewKey.trim()
              ? "server_gemini_env"
              : "none",
    });
  }

  try {
    if (useTools) {
      try {
        ex?.info(
          { id: "llm", name: "Modelo + tools" },
          "Início da geração com ferramentas nativas",
          { input: { provider, model, toolCount: tools.length, historyTurns: history.length } },
        );
        const r = await callOpenAiCompatibleChatWithTools({
          baseUrl: apiBaseUrl.replace(/\/+$/, ""),
          apiKey,
          model,
          temperature,
          maxTokens: Math.max(16, Math.min(8192, maxTokens)),
          system: systemBase,
          history,
          userMessage,
          tools,
          maxToolRounds: 6,
          onAssistantToolRound: async ({ assistantContent, toolNames, round }) => {
            if (
              pendingToolCallInterim.data ||
              sandboxReply ||
              !effectiveContactId ||
              !toolCallNotify.enabled
            ) {
              return;
            }
            const matchesSelected = toolNames.some((name) =>
              shouldNotifyBeforeToolCall(name, toolCallNotify),
            );
            if (!matchesSelected) return;

            const assistantTrim = (assistantContent ?? "").trim();
            const body = resolveToolCallNotifyBody({
              assistantContent,
              toolNames,
              defaultMessage: toolCallNotify.message,
              toolMessages: toolCallNotify.toolMessages,
            });
            const usedAgentStallText = Boolean(assistantTrim);
            pendingToolCallInterim.data = {
              body,
              toolNames,
              round,
              usedAgentStallText,
              sent: false,
            };

            await sendToolCallInterimNotify({
              organizationId,
              botId: bot.id,
              conversationId: conversation.id,
              contactId: effectiveContactId,
              body,
              log,
              executionLog: ex,
              toolNames,
              round,
              usedAgentStallText,
            });
            pendingToolCallInterim.data.sent = true;
          },
          onToolCall: async (name, argsJson) => {
            const tlog = ex?.child("tools");
            const customId = parseAutomationToolIdFromOpenAiName(name);
            const customRow = customId ? customHttpTools.find((t) => t.id === customId) : undefined;
            const toolNodeName = customRow ? `Tool: ${customRow.name}` : `Tool: ${name}`;
            const logToolResult = (outputPreview: string) => {
              tlog?.info({ id: name, name: toolNodeName }, "Resultado da ferramenta", {
                output: { preview: outputPreview.slice(0, 4000) },
              });
            };
            tlog?.info({ id: name, name: toolNodeName }, "Chamada à ferramenta", {
              input: { argsPreview: argsJson.slice(0, 4000) },
            });
            const finishToolCall = (out: string) => {
              logToolResult(out);
              const parsed = parseToolCallOutcomeFromJson(name, out);
              toolRoundOutcomes.push({
                ...parsed,
                monitored: shouldNotifyBeforeToolCall(name, toolCallNotify),
              });
              return out;
            };
            if (name === "buscar_conhecimento") {
              knowledgeSearchCallsThisTurn += 1;
              const maxKbCalls = kbHasUsefulExcerpts ? 1 : 2;
              if (knowledgeSearchCallsThisTurn > maxKbCalls) {
                return finishToolCall(
                  JSON.stringify({
                    ok: true,
                    skipped: true,
                    reason: "knowledge_search_quota_this_turn",
                    bodyPreview:
                      kbHasUsefulExcerpts
                        ? "Já existem excertos úteis no contexto do sistema e uma pesquisa neste turno. Não repita buscar_conhecimento — responda agora ao cliente com os dados já obtidos."
                        : "Limite de pesquisas de conhecimento neste turno atingido. Responda ao cliente com os resultados já obtidos ou peça só o detalhe em falta.",
                  }),
                );
              }
            }
            if (customId) {
              const row = customRow;
              if (!row) {
                return finishToolCall(JSON.stringify({ ok: false, error: "tool_not_available_for_native_agent" }));
              }
              let args: Record<string, unknown> = {};
              try {
                const p = JSON.parse(argsJson || "{}");
                if (p && typeof p === "object" && !Array.isArray(p)) args = p as Record<string, unknown>;
              } catch {
                return finishToolCall(JSON.stringify({ ok: false, error: "invalid_json_arguments" }));
              }
              const exec = await runAutomationHttpLikeTool({
                tool: row,
                llmArgs: args,
                organizationId,
                botId: bot.id,
                conversationId: conversation.id,
                executionSource: "native_agent",
                runtimeSampleContext: httpToolRuntimeContext,
              });
              const extracted = extractFlowSlotsFromToolExchange({
                llmArgs: args,
                responseText: exec.responseText,
                ok: exec.ok,
              });
              if (Object.keys(extracted).length > 0) {
                sessionFlowSlots = { ...sessionFlowSlots, ...extracted };
                if (httpToolRuntimeContext) {
                  httpToolRuntimeContext = {
                    ...httpToolRuntimeContext,
                    flowSlots: sessionFlowSlots,
                    conversation: {
                      ...((httpToolRuntimeContext.conversation as Record<string, unknown>) ?? {
                        id: conversation.id,
                      }),
                      flowSlots: sessionFlowSlots,
                    },
                  };
                }
                if (historyOverride == null) {
                  try {
                    await mergeFlowSlotsAutomationContext({
                      organizationId,
                      conversationId: conversation.id,
                      botId: bot.id,
                      flowSlots: extracted,
                    });
                  } catch (err) {
                    log.warn({ err, conversationId: conversation.id }, "merge flow slots failed");
                  }
                }
              }
              return finishToolCall(
                JSON.stringify({
                  ok: exec.ok,
                  statusCode: exec.statusCode,
                  bodyPreview: exec.responseText.slice(0, 12_000),
                  error: exec.error,
                  ...(exec.autoFilledFields?.length
                    ? { autoFilledFields: exec.autoFilledFields.slice(0, 20) }
                    : {}),
                }),
              );
            }
            return finishToolCall(
              await executeNativeTool({
                name,
                argsJson,
                organizationId,
                botId: bot.id,
                conversationId: conversation.id,
                flags,
                allowedTagIds,
                log,
                pinnedArticleIds,
                userMessage,
              }),
            );
          },
          signal,
        });
        replyText = r.text.trim();
        completedToolRounds = r.toolRounds;
        ex?.info(
          { id: "llm", name: "Modelo + tools" },
          "Geração com ferramentas concluída",
          { output: { replyChars: replyText.length, toolRounds: completedToolRounds } },
        );
      } catch (err) {
        const timedOut =
          err instanceof Error &&
          (err.name === "TimeoutError" || err.name === "AbortError" || /timeout|aborted/i.test(err.message));
        log.warn(
          { err, botId: bot.id, timedOut, timeoutMs: NATIVE_AGENT_LLM_TIMEOUT_MS },
          "OpenAI tool chat failed; falling back to plain chat",
        );
        ex?.warn({ id: "llm", name: "Modelo + tools" }, "Falha com tools — fallback para chat simples", {
          stack: err instanceof Error ? err.stack : undefined,
          output: {
            toolsAlreadyRun: toolRoundOutcomes.length,
            rateLimitLikely: err instanceof Error && /HTTP 429|rate.?limit/i.test(err.message),
          },
        });
        try {
          const r = await callOpenAiCompatibleChat({
            baseUrl: apiBaseUrl.replace(/\/+$/, ""),
            apiKey,
            model,
            temperature,
            maxTokens: Math.max(16, Math.min(8192, maxTokens)),
            system: systemBase,
            history,
            userMessage,
            signal: nativeAgentLlmAbortSignal(),
          });
          replyText = r.text.trim();
          ex?.info({ id: "llm", name: "Modelo (fallback)" }, "Resposta após fallback sem tools", {
            output: { replyChars: replyText.length },
          });
        } catch (fallbackErr) {
          log.warn(
            { err: fallbackErr, botId: bot.id, toolsAlreadyRun: toolRoundOutcomes.length },
            "OpenAI plain chat fallback also failed",
          );
          ex?.warn(
            { id: "llm", name: "Modelo (fallback)" },
            "Fallback sem tools também falhou",
            {
              stack: fallbackErr instanceof Error ? fallbackErr.stack : undefined,
              output: { toolsAlreadyRun: toolRoundOutcomes.length },
            },
          );
          replyText = "";
        }
      }
    } else if (provider === "google_gemini") {
      ex?.info({ id: "llm", name: "Gemini" }, "Geração sem tools (Gemini)");
      const r = await callGeminiGenerateContent({
        apiKey,
        model,
        temperature,
        maxTokens: Math.max(16, Math.min(8192, maxTokens)),
        system: systemBase,
        history,
        userMessage,
        signal,
      });
      replyText = r.text.trim();
      ex?.info({ id: "llm", name: "Gemini" }, "Resposta Gemini", { output: { replyChars: replyText.length } });
    } else {
      ex?.info({ id: "llm", name: "OpenAI chat" }, "Geração sem tools (OpenAI)");
      const r = await callOpenAiCompatibleChat({
        baseUrl: apiBaseUrl.replace(/\/+$/, ""),
        apiKey,
        model,
        temperature,
        maxTokens: Math.max(16, Math.min(8192, maxTokens)),
        system: systemBase,
        history,
        userMessage,
        signal,
      });
      replyText = r.text.trim();
      ex?.info({ id: "llm", name: "OpenAI chat" }, "Resposta OpenAI", { output: { replyChars: replyText.length } });
    }
  } catch (err) {
    log.warn({ err, botId: bot.id, provider }, "Agent bot native fallback generation failed");
    ex?.error({ id: "llm", name: "Geração" }, err instanceof Error ? err.message : String(err), {
      stack: err instanceof Error ? err.stack : undefined,
      output: { toolsAlreadyRun: toolRoundOutcomes.length },
    });
    if (toolRoundOutcomes.length === 0) {
      return "";
    }
    replyText = "";
  }

  if (toolRoundOutcomes.length > 0) {
    completedToolRounds = Math.max(completedToolRounds, 1);
  }

  if (!replyText && toolRoundOutcomes.length > 0 && toolCallNotify.forceDeliveryEnabled) {
    const scoped = scopeForceDeliveryToolOutcomes(toolRoundOutcomes, toolCallNotify.forceDeliveryTools);
    if (scoped.length > 0) {
      replyText = buildDeterministicReplyFromToolOutcomes(scoped);
      if (replyText) {
        ex?.warn(
          { id: "llm", name: "Entrega determinística" },
          "Resposta vazia após tools — mensagem sintetizada a partir dos resultados",
          { output: { replyChars: replyText.length, toolCount: scoped.length } },
        );
      }
    }
  }

  if (
    flags.knowledge_search &&
    shouldForceKnowledgeDelivery({
      replyText,
      kbHasUsefulExcerpts,
      toolOutcomes: toolRoundOutcomes,
      configuredStallMessages,
      userMessage,
      forceDeliveryEnabled: toolCallNotify.forceDeliveryEnabled,
      forceKnowledgeRescue: toolCallNotify.forceKnowledgeRescue,
    })
  ) {
    ex?.warn({ id: "stall", name: "Correção de resposta" }, "Resposta parece stall ou deflexão — augment RAG");
    try {
      const fixed = await augmentStallWithKnowledge({
        organizationId,
        botId: bot.id,
        userMessage,
        systemInstructions,
        history,
        provider,
        apiKey,
        model,
        apiBaseUrl,
        temperature,
        maxTokens,
        signal,
        log,
        pinnedArticleIds,
        proactiveAppendix: kbProactiveAppendix,
      });
      if (fixed.trim() && hasSubstantiveAgentReplyToCustomer(fixed, configuredStallMessages)) {
        replyText = fixed.trim();
      }
    } catch (stallErr) {
      log.warn({ err: stallErr, botId: bot.id }, "augmentStallWithKnowledge failed after rate-limit path");
    }
  }

  if (
    shouldEnsureToolResultFollowUp({
      ensureResultDelivered: toolCallNotify.ensureResultDelivered,
      toolOutcomes: toolRoundOutcomes,
      replyText,
    })
  ) {
    ex?.warn(
      { id: "tool_delivery", name: "Entrega de resultado" },
      "Resposta final não entregou resultado das ferramentas — reforço automático",
      {
        input: {
          monitoredTools: toolRoundOutcomes.filter((t) => t.monitored).map((t) => t.name).slice(0, 8),
          replyChars: replyText.length,
        },
      },
    );
    const reinforced = await augmentReplyWithToolOutcomes({
      userMessage,
      draftReply: replyText,
      toolOutcomes: toolRoundOutcomes,
      systemInstructions: systemBase,
      history,
      provider,
      apiKey,
      model,
      apiBaseUrl,
      temperature,
      maxTokens,
      signal,
      log,
    });
    if (reinforced.trim() && hasSubstantiveAgentReplyToCustomer(reinforced, configuredStallMessages)) {
      replyText = reinforced.trim();
    }
  }

  if (
    shouldForceKnowledgeDelivery({
      replyText,
      kbHasUsefulExcerpts,
      toolOutcomes: toolRoundOutcomes,
      configuredStallMessages,
      userMessage,
      forceDeliveryEnabled: toolCallNotify.forceDeliveryEnabled,
      forceKnowledgeRescue: toolCallNotify.forceKnowledgeRescue,
    })
  ) {
    const kbForced = buildDeterministicReplyFromKnowledge({
      userMessage,
      proactiveAppendix: kbProactiveAppendix,
      toolOutcomes: toolRoundOutcomes,
    });
    if (kbForced.trim()) {
      replyText = kbForced.trim();
      ex?.warn(
        { id: "kb_delivery", name: "Entrega KB forçada" },
        "Stall/deflexão com base de conhecimento disponível — resposta montada a partir dos excertos",
        {
          output: {
            replyChars: replyText.length,
            fromTool: knowledgeToolFoundUsefulExcerpts(toolRoundOutcomes),
            fromAppendix: kbHasUsefulExcerpts,
          },
        },
      );
    }
  }

  if (
    shouldForceDeliveryAfterTools({
      toolOutcomes: toolRoundOutcomes,
      replyText,
      forceDeliveryEnabled: toolCallNotify.forceDeliveryEnabled,
      forceDeliveryTools: toolCallNotify.forceDeliveryTools,
    })
  ) {
    const scopedOutcomes = scopeForceDeliveryToolOutcomes(
      toolRoundOutcomes,
      toolCallNotify.forceDeliveryTools,
    );
    const forced = buildDeterministicReplyFromToolOutcomes(scopedOutcomes);
    if (forced.trim()) {
      replyText = forced.trim();
      ex?.warn(
        { id: "tool_delivery", name: "Entrega forçada" },
        "Ainda sem resposta substantiva após tools — entrega determinística",
        {
          output: {
            replyChars: replyText.length,
            scopedToolCount: scopedOutcomes.length,
          },
        },
      );
    }
  }

  if (toolRoundOutcomes.length > 0 && historyOverride == null) {
    try {
      await mergeNativeToolRoundAutomationContext({
        organizationId,
        conversationId: conversation.id,
        botId: bot.id,
        toolRound: {
          at: new Date().toISOString(),
          toolCount: toolRoundOutcomes.length,
          tools: toolRoundOutcomes.map(({ name, ok, preview }) => ({ name, ok, preview })),
          resultDeliveredToCustomer: hasSubstantiveAgentReplyToCustomer(replyText, configuredStallMessages),
        },
        ...(Object.keys(sessionFlowSlots).length > 0 ? { flowSlots: sessionFlowSlots } : {}),
      });
    } catch (err) {
      log.warn({ err, conversationId: conversation.id }, "merge native tool round context failed");
    }
  }

  const interimNotify = pendingToolCallInterim.data;
  if (
    interimNotify &&
    !interimNotify.sent &&
    !sandboxReply &&
    effectiveContactId &&
    toolCallNotify.enabled &&
    !hasSubstantiveAgentReplyToCustomer(replyText, configuredStallMessages)
  ) {
    await sendToolCallInterimNotify({
      organizationId,
      botId: bot.id,
      conversationId: conversation.id,
      contactId: effectiveContactId,
      body: interimNotify.body,
      log,
      executionLog: ex,
      toolNames: interimNotify.toolNames,
      round: interimNotify.round,
      usedAgentStallText: interimNotify.usedAgentStallText,
    });
    pendingToolCallInterim.data = null;
  }

  const priorAgentReplies = history
    .filter((h) => h.role === "assistant")
    .map((h) => h.content)
    .slice(-4);
  const qualitySignals = analyzeLiveExecutionQuality({
    userMessage,
    replyText,
    toolOutcomes: toolRoundOutcomes.map(({ name, ok, preview }) => ({ name, ok, preview })),
    outboundSent: false,
    priorAgentReplies,
  });
  if (qualitySignals.length > 0) {
    ex?.info(
      { id: "quality", name: "Análise de qualidade" },
      `${qualitySignals.length} sinal(is) de qualidade detectado(s)`,
      {
        output: {
          replyPreview: replyText.slice(0, 2000),
          signals: qualitySignals,
        },
      },
    );
    for (const signal of qualitySignals) {
      const logFn = signal.severity === "error" ? ex?.error.bind(ex) : ex?.warn.bind(ex);
      logFn?.(
        { id: "quality", name: signal.title },
        signal.detail,
        {
          output: {
            kind: signal.kind,
            toolName: signal.toolName,
            toolPreview: signal.toolPreview?.slice(0, 500),
            replyPreview: signal.replyPreview?.slice(0, 500),
            suggestedActions: signal.suggestedActions,
          },
        },
      );
    }
  }

  const agentSupervisor = parseAgentSupervisorFromBehavior(profile.behaviorConfig);
  if (agentSupervisor.enabled && replyText.trim()) {
    const successfulTools = toolRoundOutcomes.filter((t) => t.ok);
    const toolSummary =
      toolRoundOutcomes.length > 0
        ? toolRoundOutcomes.map((t) => `${t.name}: ${t.ok ? "ok" : "fail"} — ${t.preview.slice(0, 200)}`).join("\n")
        : "(nenhuma ferramenta invocada)";
    const supervisorPrompt =
      "És um supervisor de qualidade de atendimento. Responde em JSON com approved (boolean) e summary (string).\n" +
      "Critérios:\n" +
      "- Avalia coerência da resposta com o **resultado das ferramentas** (ok/fail e dados), não com a literalidade do texto OCR/transcrição.\n" +
      "- Se uma ou mais tools HTTP devolveram sucesso (ok/2xx) e a resposta do agente confirma o próximo passo natural do fluxo " +
      "(pedir próximo documento, confirmar envio, avançar etapa), approved=true.\n" +
      "- Não rejeites só porque a mensagem do cliente é uma transcrição de imagem/[Transcrição de imagem] ou porque a descrição visual " +
      "não «parece» o tipo de ficheiro esperado, quando a tool de upload/processamento já correu com sucesso.\n" +
      "- approved=false se a resposta for só espera («Só um momento», «Aguarde», «vou verificar») sem factos, " +
      "especialmente quando a base de conhecimento já tinha excertos ou buscar_conhecimento devolveu found=true.\n" +
      "- approved=false se a resposta contradisser factos das tools, inventar dados, ou for claramente insegura/incorrecta.\n" +
      "- Turnos de recolha de dados (perguntas do agente, pedidos de documento) sem tool necessária: approved=true se a pergunta for adequada.";
    const supervisorUser =
      `Cliente: ${userMessage.slice(0, 1500)}\n\n` +
      `KB proactiva com excertos úteis: ${kbHasUsefulExcerpts ? "sim" : "não"}\n` +
      `Tools com sucesso nesta ronda: ${successfulTools.length}/${toolRoundOutcomes.length}\n` +
      `Ferramentas:\n${toolSummary}\n\n` +
      `Resposta proposta:\n${replyText.slice(0, 2500)}`;
    try {
      let supervisorText = "";
      if (provider === "google_gemini") {
        const r = await callGeminiGenerateContent({
          apiKey,
          model,
          temperature: 0.2,
          maxTokens: 256,
          system: supervisorPrompt,
          history: [],
          userMessage: supervisorUser,
          signal,
        });
        supervisorText = r.text.trim();
      } else {
        const r = await callOpenAiCompatibleChat({
          baseUrl: apiBaseUrl.replace(/\/+$/, ""),
          apiKey,
          model,
          temperature: 0.2,
          maxTokens: 256,
          system: supervisorPrompt,
          history: [],
          userMessage: supervisorUser,
          signal,
        });
        supervisorText = r.text.trim();
      }
      let approved = true;
      let summary = supervisorText.slice(0, 500);
      try {
        const jsonMatch = supervisorText.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch?.[0] ?? supervisorText) as {
          approved?: boolean;
          summary?: string;
        };
        if (typeof parsed.approved === "boolean") approved = parsed.approved;
        if (typeof parsed.summary === "string" && parsed.summary.trim()) summary = parsed.summary.trim();
      } catch {
        approved = !/\b(não|nao|incorrect|wrong|hallucin|incorret|rejeit)\b/i.test(supervisorText);
      }
      // Stall final com KB relevante: resgatar só quando a política de KB o permitir (não em turnos HTTP/fluxo).
      if (
        shouldForceKnowledgeDelivery({
          replyText,
          kbHasUsefulExcerpts,
          toolOutcomes: toolRoundOutcomes,
          configuredStallMessages,
          userMessage,
          forceDeliveryEnabled: toolCallNotify.forceDeliveryEnabled,
          forceKnowledgeRescue: toolCallNotify.forceKnowledgeRescue,
        })
      ) {
        approved = false;
        summary = `${summary} [auto: stall com KB disponível — rejeitado]`.slice(0, 500);
        const kbForced = buildDeterministicReplyFromKnowledge({
          userMessage,
          proactiveAppendix: kbProactiveAppendix,
          toolOutcomes: toolRoundOutcomes,
        });
        if (kbForced.trim() && hasSubstantiveAgentReplyToCustomer(kbForced, configuredStallMessages)) {
          replyText = kbForced.trim();
          approved = true;
          summary = `${summary} [auto: substituído por entrega KB]`.slice(0, 500);
        }
      }
      // Override defensivo: tools OK + resposta substantiva → não marcar falso negativo por OCR
      // Não forçar aprovação se a resposta é dump de KB irrelevante ou contradiz found:false.
      const toolReportsNotFound = toolRoundOutcomes.some((t) => /"found"\s*:\s*false/i.test(t.preview));
      const isForcedKbDump = FORCED_KB_REPLY_PREFIX_RE.test(replyText);
      if (
        !approved &&
        successfulTools.length > 0 &&
        hasSubstantiveAgentReplyToCustomer(replyText, configuredStallMessages) &&
        !(isForcedKbDump && (toolReportsNotFound || hasNonKnowledgeToolsThisTurn(toolRoundOutcomes)))
      ) {
        approved = true;
        summary = `${summary} [auto: tools OK — aprovado por coerência com resultado da ferramenta]`.slice(0, 500);
      }
      const supLog = approved ? ex?.info.bind(ex) : ex?.warn.bind(ex);
      supLog?.(
        { id: "supervisor", name: "Agente supervisor" },
        approved ? "Supervisor aprovou a resposta" : "Supervisor sinalizou possível problema",
        { output: { approved, summary, replyPreview: replyText.slice(0, 500) } },
      );
    } catch (err) {
      log.warn({ err, botId: bot.id }, "agent supervisor review failed");
      ex?.warn({ id: "supervisor", name: "Agente supervisor" }, "Revisão do supervisor falhou", {
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  // Rede final: nunca devolver stall se ainda houver KB utilizável
  if (
    shouldForceKnowledgeDelivery({
      replyText,
      kbHasUsefulExcerpts,
      toolOutcomes: toolRoundOutcomes,
      configuredStallMessages,
      userMessage,
      forceDeliveryEnabled: toolCallNotify.forceDeliveryEnabled,
      forceKnowledgeRescue: toolCallNotify.forceKnowledgeRescue,
    })
  ) {
    const last = buildDeterministicReplyFromKnowledge({
      userMessage,
      proactiveAppendix: kbProactiveAppendix,
      toolOutcomes: toolRoundOutcomes,
    });
    if (last.trim()) replyText = last.trim();
  }

  return replyText;
}
