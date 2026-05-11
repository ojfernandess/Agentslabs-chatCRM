import type { FastifyBaseLogger } from "fastify";
import type { Bot, Conversation, Message } from "@prisma/client";
import { prisma } from "../db.js";
import {
  callGeminiGenerateContent,
  callOpenAiCompatibleChat,
  callOpenAiCompatibleChatWithTools,
  type OpenAiToolDefinition,
  type PreviewChatTurn,
} from "./promptModulePreviewLlm.js";
import {
  fetchProactiveKnowledgeSystemAppendix,
  mergePinnedKnowledgeWhenRankedEmpty,
  parseLinkedKnowledgeArticleIdsFromBehavior,
  rankedKnowledgeSearch,
} from "./knowledgeRetrieval.js";
import { assignConversationTeamForOrg } from "./conversationTeamAssignment.js";

const STALL_RE =
  /\b(vou|irei)\s+.{0,48}?(verificar|consultar|buscar|pesquisar|checar|olhar)\b|\b(um\s+momento|só\s+um\s+momento|aguarde|já\s+volto|espere|momento\s+por\s+favor)\b|\b(i'?ll|i\s+will)\s+.{0,32}?(check|look\s+up|search)\b|\b(one\s+moment|just\s+a\s+moment|please\s+hold)\b/i;

/** Resposta curta só a “vou verificar” / “um momento”, sem conteúdo útil — típico quando o modelo não invocou a KB. */
export function isLikelyStallOnlyReply(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 280) return false;
  if (/[.!?][\s\S]{40,}/.test(t)) return false;
  return STALL_RE.test(t);
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
};

const defaultNativeTools = (): NativeToolsFlags => ({
  knowledge_search: true,
  transfer_to_team: false,
  list_teams: false,
  call_human: true,
});

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
  };
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

function buildOpenAiTools(flags: NativeToolsFlags): OpenAiToolDefinition[] {
  const tools: OpenAiToolDefinition[] = [];
  if (flags.knowledge_search) {
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
            reason: { type: "string", description: "Motivo curto (opcional)" },
          },
          required: ["team_id"],
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
          "Abre a conversa para atendimento humano (fila de agentes). Use quando o cliente pedir falar com pessoa / atendente.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string" },
            team_id: { type: "string", description: "UUID opcional da equipa para encaminhar" },
          },
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
  log: FastifyBaseLogger;
  pinnedArticleIds: string[] | undefined;
}): Promise<string> {
  const { name, argsJson, organizationId, botId, conversationId, flags, log, pinnedArticleIds } = input;
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
        })
      ).ranked;
      ranked = await mergePinnedKnowledgeWhenRankedEmpty({
        organizationId,
        ranked,
        pinnedArticleIds,
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
      return JSON.stringify({
        ok: true,
        teamId: r.payload.teamId,
        teamName: r.payload.team?.name ?? null,
        message: "Conversa atribuída à equipa e aberta para atendentes humanos.",
      });
    }

    if (name === "call_human" && flags.call_human) {
      const teamIdRaw = args.team_id ?? args.teamId;
      const teamId =
        typeof teamIdRaw === "string" && teamIdRaw.trim().length >= 32 ? teamIdRaw.trim() : null;
      if (teamId) {
        const r = await assignConversationTeamForOrg(prisma, {
          organizationId,
          conversationId,
          body: { teamId, assignedToId: null },
        });
        if (!r.ok) {
          log.warn({ err: r.error }, "call_human team assign failed");
        }
      }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "OPEN", assignedToId: null, updatedAt: new Date() },
      });
      return JSON.stringify({ ok: true, message: "Conversa aberta para atendimento humano." });
    }
  } catch (err) {
    log.warn({ err, tool: name }, "native agent tool failed");
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "tool_error" });
  }

  return JSON.stringify({ ok: false, error: "unknown_or_disabled_tool", tool: name });
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
      })
    ).ranked;
    ranked = await mergePinnedKnowledgeWhenRankedEmpty({
      organizationId: params.organizationId,
      ranked,
      pinnedArticleIds: params.pinnedArticleIds,
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
}): Promise<string> {
  const { organizationId, bot, conversation, message, log } = input;
  if (message.direction !== "INBOUND") return "";
  const userMessage = (message.body ?? "").trim();
  if (!userMessage) return "";

  const profile = await prisma.automationAgentProfile.findUnique({
    where: { botId: bot.id },
    select: { llmConfig: true, behaviorConfig: true },
  });
  if (!profile?.llmConfig || typeof profile.llmConfig !== "object") {
    log.warn({ botId: bot.id }, "Agent bot native fallback skipped: missing automation profile");
    return "";
  }

  const llm = profile.llmConfig as Record<string, unknown>;
  const provider = llmString(llm, "provider") || "openai";
  const model = llmString(llm, "model") || "gpt-4o-mini";
  const apiKey = llmString(llm, "apiKey");
  if (!apiKey || apiKey === "***") {
    log.warn({ botId: bot.id }, "Agent bot native fallback skipped: API key not configured");
    return "";
  }
  const temperatureRaw = llm.temperature;
  const maxTokensRaw = llm.maxTokens;
  const temperature =
    typeof temperatureRaw === "number" && Number.isFinite(temperatureRaw) ? temperatureRaw : 0.7;
  const maxTokens =
    typeof maxTokensRaw === "number" && Number.isFinite(maxTokensRaw) ? Math.trunc(maxTokensRaw) : 1024;
  const systemInstructions =
    llmString(llm, "systemInstructions") ||
    "Você é um agente de atendimento útil, objetivo e cordial. Responda de forma curta e prática.";
  const apiBaseUrl = llmString(llm, "apiBaseUrl") || "https://api.openai.com/v1";

  const toolPreamble =
    "\n\n### Ferramentas (complemento)\n" +
    "- Os excertos da base podem já estar na secção «Base de conhecimento» acima: responda com base neles.\n" +
    "- `buscar_conhecimento`: use só se precisar de outra consulta além dos excertos já injectados.\n" +
    "- `transfer_to_team` / `listar_equipas`: use UUID real de equipa.\n" +
    "- `call_human`: **apenas** se o cliente pedir humano/atendente **ou** se, depois de usar os excertos, não for possível responder com verdade — **não** use para perguntas factuais que os excertos já respondem.";

  const flags = parseNativeToolsFromBehavior(profile.behaviorConfig);
  const pinnedArticleIds = parseLinkedKnowledgeArticleIdsFromBehavior(profile.behaviorConfig);

  let kbProactiveAppendix = "";
  if (flags.knowledge_search) {
    try {
      kbProactiveAppendix = await fetchProactiveKnowledgeSystemAppendix({
        organizationId,
        botId: bot.id,
        userMessage,
        limit: 8,
        pinnedArticleIds,
      });
    } catch (err) {
      log.warn({ err, botId: bot.id }, "proactive knowledge appendix failed");
    }
  }

  const systemBase = systemInstructions + kbProactiveAppendix + toolPreamble;

  const recent = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 12,
    select: { direction: true, body: true },
  });
  const history = recent
    .map((m) => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: (m.body ?? "").trim(),
    }))
    .filter((m): m is PreviewChatTurn => Boolean(m.content));

  const signal = AbortSignal.timeout(28_000);
  let replyText = "";
  let completedToolRounds = 0;

  const tools = buildOpenAiTools(flags);
  const useTools = provider !== "google_gemini" && tools.length > 0;

  try {
    if (useTools) {
      try {
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
          onToolCall: (name, argsJson) =>
            executeNativeTool({
              name,
              argsJson,
              organizationId,
              botId: bot.id,
              conversationId: conversation.id,
              flags,
              log,
              pinnedArticleIds,
            }),
          signal,
        });
        replyText = r.text.trim();
        completedToolRounds = r.toolRounds;
      } catch (err) {
        log.warn({ err, botId: bot.id }, "OpenAI tool chat failed; falling back to plain chat");
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
      }
    } else if (provider === "google_gemini") {
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
    } else {
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
    }
  } catch (err) {
    log.warn({ err, botId: bot.id, provider }, "Agent bot native fallback generation failed");
    return "";
  }

  if (!replyText && completedToolRounds > 0) {
    replyText =
      "Já tratei do seu pedido no sistema. Um agente humano irá continuar o atendimento em breve, se necessário.";
  }

  if (flags.knowledge_search && isLikelyStallOnlyReply(replyText)) {
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
