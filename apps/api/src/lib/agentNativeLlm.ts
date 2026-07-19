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
  loadAutomationConversationContext,
} from "./automationConversationContextLib.js";
import { recordNativeAgentTransferHandoff } from "./agentConversationHandoff.js";
import { assignConversationTeamForOrg } from "./conversationTeamAssignment.js";
import { assignTagsToConversationContact } from "./assignContactTags.js";
import type { AutomationExecutionLogPort } from "./automationExecutionLog.js";
import {
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

const DEFAULT_TOOL_CALL_NOTIFY_MESSAGE = "Um momento, estou a consultar isso para si…";

export function parseToolCallNotifyFromBehavior(behaviorConfig: unknown): {
  enabled: boolean;
  message: string;
  /** `null` = perfis antigos (avisar em qualquer ferramenta). */
  selectedTools: string[] | null;
} {
  const fallback = { enabled: false, message: DEFAULT_TOOL_CALL_NOTIFY_MESSAGE, selectedTools: [] as string[] };
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
  return { enabled: o.enabled === true, message, selectedTools };
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
  return config.selectedTools.includes(key);
}

const STALL_RE =
  /\b(vou|irei)\s+.{0,48}?(verificar|consultar|buscar|pesquisar|checar|olhar)\b|\b(um\s+momento|só\s+um\s+momento|aguarde|já\s+volto|espere|momento\s+por\s+favor)\b|\b(i'?ll|i\s+will)\s+.{0,32}?(check|look\s+up|search)\b|\b(one\s+moment|just\s+a\s+moment|please\s+hold)\b/i;

/** Resposta curta só a “vou verificar” / “um momento”, sem conteúdo útil — típico quando o modelo não invocou a KB. */
export function isLikelyStallOnlyReply(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 280) return false;
  if (/[.!?][\s\S]{40,}/.test(t)) return false;
  return STALL_RE.test(t);
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
}): Promise<string> {
  const norm = params.userMessage.trim().toLowerCase().slice(0, 500);
  if (!norm) return "";
  try {
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
    const kbBlock = formatKnowledgeToolResult(ranked);
    const extra =
      "\n\n[Instrução do sistema: A tua resposta anterior era só ‘vou verificar’ sem dados. Usa OBRIGATORIAMENTE os excertos abaixo da base de conhecimento para responder de forma completa ao cliente. Se não houver dados úteis, diz honestamente que não encontraste e oferece transferência para humano. Não repitas frases vazias de espera.]\n" +
      kbBlock;
    const system = params.systemInstructions + extra;
    if (params.provider === "google_gemini") {
      const r = await callGeminiGenerateContent({
        apiKey: params.apiKey,
        model: params.model,
        temperature: params.temperature,
        maxTokens: Math.max(16, Math.min(8192, params.maxTokens)),
        system,
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
      system,
      history: params.history,
      userMessage: params.userMessage,
      signal: params.signal,
    });
    return r.text.trim();
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
  const userMessage = (message.body ?? "").trim();
  if (!userMessage) return "";

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

  let flags = applyConnectedTagNativeToolFlags(
    applyFallbackNativeToolFlags(parseNativeToolsFromBehavior(profile.behaviorConfig), instructionFallbacks),
    profile.behaviorConfig,
  );
  const apiBaseUrl = llmString(llm, "apiBaseUrl") || "https://api.openai.com/v1";
  const pinnedArticleIds = parseLinkedKnowledgeArticleIdsFromBehavior(profile.behaviorConfig);
  const toolCallNotify = parseToolCallNotifyFromBehavior(profile.behaviorConfig);
  const effectiveContactId = contactId ?? conversation.contactId ?? undefined;
  const sandboxReply = historyOverride != null;
  let toolCallNotifySent = false;

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
      ? "\n- **Ferramentas HTTP da organização:** existem funções com nome `oc_tool_` + identificador. Use-as para consultar APIs externas (ex.: reservas, PMS) **antes** de `call_human` ou transferências, quando o pedido do cliente for compatível com o contrato de cada função.\n"
      : "";

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
   * Mantemos `buscar_conhecimento` sempre registado quando `knowledge_search` está activo.
   * Prompts de clientes exigem «executar buscar_conhecimento antes» — omitir a tool fazia o modelo
   * achar que não cumpria a regra (apesar da pesquisa proactiva já ter corrido). Chamada duplicada
   * à BD é aceitável para alinhar prompts rígidos e observabilidade.
   */
  const omitBuscarConhecimento = false;

  const toolPreamble = kbHasUsefulExcerpts
    ? "\n\n### Ferramentas (complemento)\n" +
      "- **Base de conhecimento:** a secção acima **já contém excertos** recuperados para a última mensagem do cliente (pesquisa automática no servidor). Responda com factos concretos (morada, Wi‑Fi, horários, preços) quando constarem aí.\n" +
      "- **`buscar_conhecimento`:** continua disponível. Se o seu prompt interno exigir uma chamada explícita à função antes de responder, invoque‑a com `query` adequada; se os excertos acima já bastarem, pode responder sem nova chamada.\n" +
      "- `transfer_to_team` / `listar_equipas`: apenas com UUID real de equipa.\n" +
      (allowedTagIds.length > 0
        ? "- `listar_etiquetas` / `atribuir_etiquetas`: atribua etiquetas ao contacto quando os critérios do prompt se aplicarem; use só UUIDs permitidos.\n"
        : "") +
      "- `call_human`: apenas se o cliente pedir humano/atendente **ou** se os excertos / resultado da busca forem claramente insuficientes." +
      customToolPreamble
    : "\n\n### Ferramentas (complemento)\n" +
      "- Use `buscar_conhecimento` para factos da organização (moradas, preços, políticas, horários) antes de dizer que vai verificar.\n" +
      "- `transfer_to_team` / `listar_equipas`: use UUID real de equipa.\n" +
      (allowedTagIds.length > 0
        ? "- `listar_etiquetas` / `atribuir_etiquetas`: atribua etiquetas ao contacto quando as regras do agente o indicarem.\n"
        : "") +
      "- `call_human`: **apenas** se o cliente pedir humano/atendente **ou** se, depois de `buscar_conhecimento`, não for possível responder com verdade — **não** use para perguntas factuais que a base já cobre." +
      customToolPreamble;

  const serverKbGuard =
    (kbHasUsefulExcerpts
      ? "\n\n[OpenConduit — precedência sobre instruções conflituantes no prompt do agente]\n" +
        "A secção «Base de conhecimento» acima contém o resultado da pesquisa automática para a última mensagem do hóspede. " +
        "Se os excertos contiverem dados sobre o que foi perguntado, responda com esses dados de forma directa. " +
        "A função `buscar_conhecimento` está disponível para uma segunda consulta ou se as suas regras exigirem chamada explícita; isso **não** significa que a primeira pesquisa «falhou». " +
        "**Não** invoque `call_human` nem `transfer_to_team` só porque o prompt do hotel diz «se buscar_conhecimento falhar» quando já há excertos ou JSON útil com a resposta. " +
        "Use `call_human` só se o hóspede pedir atendente/humano **ou** se, depois de usar excertos e/ou `buscar_conhecimento`, a informação continuar insuficiente."
      : "") +
    (customHttpTools.length > 0
      ? "\n\n[OpenConduit — ferramentas HTTP da organização]\n" +
        "Existem funções com nome `oc_tool_` no catálogo: são integrações HTTP/Webhook configuradas para este agente. " +
        "Para consultas de reserva, estado de booking ou outros dados expostos por essas APIs, **chame primeiro** a função adequada com os argumentos do schema; só depois use `call_human` se a API falhar ou a resposta for insuficiente."
      : "");

  const audioInboundHint =
    message.type === "AUDIO" || userMessage.includes(AUDIO_TRANSCRIPTION_PREFIX)
      ? "\n\n[OpenConduit — entrada de áudio]\n" +
        "Se o texto do cliente começar por «" +
        AUDIO_TRANSCRIPTION_PREFIX +
        "», trate o que segue como o conteúdo falado numa nota de voz do cliente."
      : "";

  const imageInboundHint =
    message.type === "IMAGE" || userMessage.includes(IMAGE_TRANSCRIPTION_PREFIX)
      ? "\n\n[OpenConduit — entrada de imagem]\n" +
        "Se o texto incluir «" +
        IMAGE_TRANSCRIPTION_PREFIX +
        "», trata-o como transcrição automática (descrição e textos extraídos) de uma imagem enviada pelo cliente."
      : "";

  const automationCtx = await loadAutomationConversationContext(conversation.id);
  const followUpPrompt = automationCtx.state.followUpCampaign
    ? buildFollowUpCampaignPromptBlock(automationCtx.state.followUpCampaign)
    : "";

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
    followUpPrompt;

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

  const signal = AbortSignal.timeout(28_000);
  let replyText = "";
  let completedToolRounds = 0;

  const tools: OpenAiToolDefinition[] = [
    ...buildOpenAiTools(flags, { omitBuscarConhecimento, assignableTagsDescription }),
    ...customHttpTools.map((row) =>
      openAiToolDefinitionForAutomationTool(row, { agentInstruction: agentInstructionByToolId.get(row.id) }),
    ),
  ];
  const useTools = provider !== "google_gemini" && tools.length > 0;

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
          onToolCall: async (name, argsJson) => {
            const tlog = ex?.child("tools");
            if (
              !toolCallNotifySent &&
              !sandboxReply &&
              effectiveContactId &&
              shouldNotifyBeforeToolCall(name, toolCallNotify)
            ) {
              toolCallNotifySent = true;
              try {
                await deliverOutboundWhatsAppMessage({
                  organizationId,
                  data: {
                    contactId: effectiveContactId,
                    conversationId: conversation.id,
                    type: "TEXT",
                    body: toolCallNotify.message,
                  },
                  actor: { kind: "agent_bot", botId: bot.id },
                  log,
                  newConversation: { status: "PENDING", assignedToId: null },
                });
                tlog?.info(
                  { id: name, name: "Aviso pré-ferramenta" },
                  "Mensagem enviada ao contacto antes da ferramenta",
                  { output: { messagePreview: toolCallNotify.message.slice(0, 240) } },
                );
              } catch (err) {
                log.warn({ err, botId: bot.id, toolFunctionName: name }, "tool call pre-notify outbound failed");
                tlog?.warn(
                  { id: name, name: "Aviso pré-ferramenta" },
                  "Falha ao enviar aviso pré-ferramenta",
                  { stack: err instanceof Error ? err.stack : undefined },
                );
              }
            }
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
            if (customId) {
              const row = customRow;
              if (!row) {
                const out = JSON.stringify({ ok: false, error: "tool_not_available_for_native_agent" });
                logToolResult(out);
                return out;
              }
              let args: Record<string, unknown> = {};
              try {
                const p = JSON.parse(argsJson || "{}");
                if (p && typeof p === "object" && !Array.isArray(p)) args = p as Record<string, unknown>;
              } catch {
                const out = JSON.stringify({ ok: false, error: "invalid_json_arguments" });
                logToolResult(out);
                return out;
              }
              const exec = await runAutomationHttpLikeTool({
                tool: row,
                llmArgs: args,
                organizationId,
                botId: bot.id,
                conversationId: conversation.id,
                executionSource: "native_agent",
              });
              const out = JSON.stringify({
                ok: exec.ok,
                statusCode: exec.statusCode,
                bodyPreview: exec.responseText.slice(0, 12_000),
                error: exec.error,
              });
              logToolResult(out);
              return out;
            }
            const out = await executeNativeTool({
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
            });
            logToolResult(out);
            return out;
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
        log.warn({ err, botId: bot.id }, "OpenAI tool chat failed; falling back to plain chat");
        ex?.warn({ id: "llm", name: "Modelo + tools" }, "Falha com tools — fallback para chat simples", {
          stack: err instanceof Error ? err.stack : undefined,
        });
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
        ex?.info({ id: "llm", name: "Modelo (fallback)" }, "Resposta após fallback sem tools", {
          output: { replyChars: replyText.length },
        });
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
    });
    return "";
  }

  if (!replyText && completedToolRounds > 0) {
    replyText =
      "Já tratei do seu pedido no sistema. Um agente humano irá continuar o atendimento em breve, se necessário.";
  }

  if (
    flags.knowledge_search &&
    (isLikelyStallOnlyReply(replyText) ||
      (kbHasUsefulExcerpts && isLikelyKbDeflectionOnlyReply(replyText)))
  ) {
    ex?.warn({ id: "stall", name: "Correção de resposta" }, "Resposta parece stall ou deflexão — augment RAG");
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
    });
    if (fixed.trim()) replyText = fixed.trim();
  }

  return replyText;
}
