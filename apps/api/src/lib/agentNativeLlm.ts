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
import { assignConversationTeamForOrg } from "./conversationTeamAssignment.js";
import type { AutomationExecutionLogPort } from "./automationExecutionLog.js";
import {
  openAiToolDefinitionForAutomationTool,
  parseAutomationToolIdFromOpenAiName,
  runAutomationHttpLikeTool,
  type AutomationHttpToolRow,
} from "./automationHttpToolExecute.js";

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

function buildOpenAiTools(
  flags: NativeToolsFlags,
  opts?: { omitBuscarConhecimento?: boolean },
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
}): Promise<string> {
  const { organizationId, bot, conversation, message, log, executionLog: ex } = input;
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
  const systemInstructions =
    llmString(llm, "systemInstructions") ||
    "Você é um agente de atendimento útil, objetivo e cordial. Responda de forma curta e prática.";
  const apiBaseUrl = llmString(llm, "apiBaseUrl") || "https://api.openai.com/v1";

  const flags = parseNativeToolsFromBehavior(profile.behaviorConfig);
  const pinnedArticleIds = parseLinkedKnowledgeArticleIdsFromBehavior(profile.behaviorConfig);

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
      "- `call_human`: apenas se o cliente pedir humano/atendente **ou** se os excertos / resultado da busca forem claramente insuficientes." +
      customToolPreamble
    : "\n\n### Ferramentas (complemento)\n" +
      "- Use `buscar_conhecimento` para factos da organização (moradas, preços, políticas, horários) antes de dizer que vai verificar.\n" +
      "- `transfer_to_team` / `listar_equipas`: use UUID real de equipa.\n" +
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

  const systemBase = systemInstructions + kbProactiveAppendix + toolPreamble + serverKbGuard;

  const automationCtxRow = await prisma.automationConversationContext.findUnique({
    where: { conversationId: conversation.id },
    select: { lastClearedAt: true },
  });
  const lastClearedAt = automationCtxRow?.lastClearedAt ?? null;

  const recent = await prisma.message.findMany({
    where: buildNativeAgentMessageWhere({
      conversationId: conversation.id,
      excludeMessageId: message.id,
      lastClearedAt,
    }),
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { direction: true, body: true },
  });
  const history = recent
    .reverse()
    .map((m) => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: (m.body ?? "").trim(),
    }))
    .filter((m): m is PreviewChatTurn => Boolean(m.content));

  const signal = AbortSignal.timeout(28_000);
  let replyText = "";
  let completedToolRounds = 0;

  const tools: OpenAiToolDefinition[] = [
    ...buildOpenAiTools(flags, { omitBuscarConhecimento }),
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
            tlog?.info({ id: name, name: `Tool: ${name}` }, "Chamada à ferramenta", {
              input: { argsPreview: argsJson.slice(0, 4000) },
            });
            const customId = parseAutomationToolIdFromOpenAiName(name);
            if (customId) {
              const row = customHttpTools.find((t) => t.id === customId);
              if (!row) {
                const out = JSON.stringify({ ok: false, error: "tool_not_available_for_native_agent" });
                tlog?.info({ id: name, name: `Tool: ${name}` }, "Resultado da ferramenta", {
                  output: { preview: out },
                });
                return out;
              }
              let args: Record<string, unknown> = {};
              try {
                const p = JSON.parse(argsJson || "{}");
                if (p && typeof p === "object" && !Array.isArray(p)) args = p as Record<string, unknown>;
              } catch {
                const out = JSON.stringify({ ok: false, error: "invalid_json_arguments" });
                tlog?.info({ id: name, name: `Tool: ${name}` }, "Resultado da ferramenta", {
                  output: { preview: out },
                });
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
              tlog?.info({ id: name, name: `Tool: ${name}` }, "Resultado da ferramenta", {
                output: { preview: out.slice(0, 4000) },
              });
              return out;
            }
            const out = await executeNativeTool({
              name,
              argsJson,
              organizationId,
              botId: bot.id,
              conversationId: conversation.id,
              flags,
              log,
              pinnedArticleIds,
            });
            tlog?.info({ id: name, name: `Tool: ${name}` }, "Resultado da ferramenta", {
              output: { preview: out.slice(0, 4000) },
            });
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
