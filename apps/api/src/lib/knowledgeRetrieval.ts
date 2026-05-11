import { prisma } from "../db.js";
import { config } from "../config.js";
import { queryTerms, rankArticles } from "./knowledgeSearchRanking.js";
import { rankedSemanticKnowledgeSearch } from "./knowledgeSemanticSearch.js";

/**
 * Quando o bot tem pelo menos um artigo (activo, syncToAi) ligado em `automation_knowledge_article_bots`,
 * a pesquisa restringe-se a esses artigos. Se não houver nenhum vínculo, usa-se toda a KB da organização —
 * caso contrário artigos sem vínculo nunca apareciam e o agente dizia que não havia informação.
 */
export async function effectiveKnowledgeSearchBotId(
  organizationId: string,
  botId: string | undefined,
): Promise<string | undefined> {
  const id = typeof botId === "string" ? botId.trim() : "";
  if (!id) return undefined;
  const linkedCount = await prisma.automationKnowledgeArticleBot.count({
    where: {
      botId: id,
      article: { organizationId, isActive: true, syncToAi: true },
    },
  });
  return linkedCount > 0 ? id : undefined;
}

export type RankedKnowledgeRow = {
  article: {
    id: string;
    title: string;
    content: string;
    category: string | null;
    tags: string[];
    isActive: boolean;
    syncToAi: boolean;
    createdAt: Date;
    updatedAt: Date;
    organizationId: string;
  };
  score: number;
  excerpt: string;
};

export async function rankedLexicalKnowledgeSearch(params: {
  organizationId: string;
  normalizedQuery: string;
  botId: string | undefined;
  limit: number;
}): Promise<RankedKnowledgeRow[]> {
  const { organizationId, normalizedQuery: norm, botId, limit } = params;
  const terms = queryTerms(norm);
  const orClause =
    terms.length > 0
      ? terms.flatMap((term) => [
          { title: { contains: term, mode: "insensitive" as const } },
          { content: { contains: term, mode: "insensitive" as const } },
        ])
      : [
          { title: { contains: norm, mode: "insensitive" as const } },
          { content: { contains: norm, mode: "insensitive" as const } },
        ];

  const whereBase = {
    organizationId,
    isActive: true,
    syncToAi: true,
    OR: orClause,
  };
  const where = botId != null ? { ...whereBase, botLinks: { some: { botId } } } : whereBase;

  let candidates = await prisma.automationKnowledgeArticle.findMany({
    where,
    take: 160,
  });

  if (candidates.length === 0 && terms.length > 1) {
    const fbBase = {
      organizationId,
      isActive: true,
      syncToAi: true,
      OR: [
        { title: { contains: norm, mode: "insensitive" as const } },
        { content: { contains: norm, mode: "insensitive" as const } },
      ],
    };
    const fbWhere = botId != null ? { ...fbBase, botLinks: { some: { botId } } } : fbBase;
    candidates = await prisma.automationKnowledgeArticle.findMany({ where: fbWhere, take: 160 });
  }

  const ranked = rankArticles(candidates, norm);
  return ranked.slice(0, limit).map((r) => ({
    article: r.article,
    score: r.score,
    excerpt: r.excerpt,
  }));
}

/**
 * Pesquisa na base de conhecimento (semântica + lexical), mesma lógica usada no painel de automação.
 */
export async function rankedKnowledgeSearch(params: {
  organizationId: string;
  normalizedQuery: string;
  botId: string | undefined;
  limit: number;
}): Promise<{ ranked: RankedKnowledgeRow[]; mode: "lexical" | "semantic" | "hybrid" }> {
  const { organizationId, normalizedQuery: norm, limit } = params;
  const botId = await effectiveKnowledgeSearchBotId(organizationId, params.botId);
  const hasKey = Boolean(config.openAiPromptPreviewKey);
  const chunkCount = hasKey
    ? await prisma.automationKnowledgeChunk.count({ where: { organizationId } })
    : 0;

  let semantic: RankedKnowledgeRow[] = [];
  if (hasKey && chunkCount > 0) {
    try {
      semantic = await rankedSemanticKnowledgeSearch({
        organizationId,
        normalizedQuery: norm,
        botId,
        limit: Math.max(limit, 14),
        apiKey: config.openAiPromptPreviewKey,
        embeddingModel: config.openAiEmbeddingModel,
      });
    } catch {
      semantic = [];
    }
  }

  const lexical = await rankedLexicalKnowledgeSearch(params);

  if (!semantic.length) {
    return { ranked: lexical.slice(0, limit), mode: "lexical" };
  }

  const semTop = semantic.slice(0, limit);
  const seen = new Set(semTop.map((r) => r.article.id));
  const merged: RankedKnowledgeRow[] = [...semTop];
  for (const r of lexical) {
    if (merged.length >= limit) break;
    if (!seen.has(r.article.id)) {
      seen.add(r.article.id);
      merged.push({
        ...r,
        score: Math.min(0.995, r.score * 0.42),
      });
    }
  }

  const mode: "semantic" | "hybrid" = merged.length > semTop.length ? "hybrid" : "semantic";
  return { ranked: merged.slice(0, limit), mode };
}

/** Texto a anexar ao system prompt do agente nativo (RAG proactivo). */
export function formatRankedKnowledgeForSystemPrompt(ranked: RankedKnowledgeRow[]): string {
  if (!ranked.length) {
    return (
      "\n\n### Base de conhecimento (pesquisa automática na última mensagem do cliente)\n" +
      "Não foi encontrado nenhum trecho indexado relevante. Não invente factos (moradas, preços, Wi‑Fi, quartos). " +
      "Só ofereça transferência para humano se o cliente pedir atendente/humano ou se, honestamente, não existir informação útil em lado nenhum."
    );
  }
  const parts = ranked.slice(0, 8).map((r, i) => {
    const sc = Math.round(r.score * 1000) / 1000;
    return `**${i + 1}. ${r.article.title}** (relevância ${sc})\n${r.excerpt}`;
  });
  return (
    "\n\n### Base de conhecimento (excertos recuperados automaticamente)\n" +
    parts.join("\n\n") +
    "\n\n**Instruções:** use estes excertos para responder à pergunta actual quando forem pertinentes. " +
    "Não diga que não tem a informação se ela constar acima. " +
    "Não encaminhe para humano nem use call_human só por precaução: primeiro responda com base nos excertos. " +
    "Chame buscar_conhecimento apenas se precisar de uma consulta diferente da já reflectida acima."
  );
}

/** Recuperação lexical/semântica para injectar no system prompt (independente de function calling). */
export async function fetchProactiveKnowledgeSystemAppendix(params: {
  organizationId: string;
  botId: string;
  userMessage: string;
  limit?: number;
}): Promise<string> {
  const norm = params.userMessage.trim().toLowerCase().slice(0, 500);
  if (!norm) return "";
  const { ranked } = await rankedKnowledgeSearch({
    organizationId: params.organizationId,
    normalizedQuery: norm,
    botId: params.botId,
    limit: params.limit ?? 8,
  });
  return formatRankedKnowledgeForSystemPrompt(ranked);
}
