import { prisma } from "../db.js";
import { embedTextsBatched } from "./openaiEmbeddings.js";
import { embeddingToVectorLiteral } from "./pgvectorEmbedding.js";
import { excerptAround, queryTerms } from "./knowledgeSearchRanking.js";

export type KnowledgeArticleRow = {
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

function excerptFromChunk(text: string, maxLen = 220): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/** Termos muito curtos / stopwords PT levam `excerptAround` a ancorar no sítio errado. */
const LEXICAL_STOPWORDS = new Set([
  "da",
  "de",
  "do",
  "das",
  "dos",
  "em",
  "na",
  "no",
  "nas",
  "nos",
  "um",
  "uma",
  "uns",
  "umas",
  "o",
  "a",
  "os",
  "as",
  "e",
  "ou",
  "com",
  "por",
  "ao",
  "à",
  "aos",
  "às",
]);

function meaningfulQueryTermsForExcerpt(normalizedQuery: string): string[] {
  const raw = queryTerms(normalizedQuery);
  const filtered = raw.filter((t) => t.length >= 4 || (t.length === 3 && !LEXICAL_STOPWORDS.has(t)));
  return [...new Set(filtered)].sort((a, b) => b.length - a.length);
}

/**
 * O melhor chunk por embedding nem sempre contém o facto pedido (ex.: morada num doc longo de hotel).
 * Juntamos vários chunks do mesmo artigo + uma janela lexical no corpo completo centrada nos termos da pergunta.
 */
function buildRichSemanticExcerpt(
  chunkTexts: string[],
  article: KnowledgeArticleRow,
  normalizedQuery: string,
): string {
  const mergedChunks = chunkTexts
    .map((x) => x.trim())
    .filter(Boolean)
    .join("\n\n—\n\n");
  const fromChunks = excerptFromChunk(mergedChunks, 780);

  const terms = meaningfulQueryTermsForExcerpt(normalizedQuery);
  if (!terms.length) return fromChunks;

  const fromLexical = excerptAround(
    { id: article.id, title: article.title, content: article.content },
    terms,
    520,
  ).trim();
  if (fromLexical.length < 35) return fromChunks;

  const a = fromChunks.toLowerCase();
  const b = fromLexical.toLowerCase();
  const anchor = b.slice(0, Math.min(96, b.length));
  if (anchor.length >= 48 && a.includes(anchor.slice(0, 48))) {
    return fromChunks.length >= fromLexical.length ? fromChunks : `${fromChunks}\n\n${fromLexical}`.slice(0, 1500);
  }

  const combined = `${fromChunks}\n\n[Trecho do artigo alinhado à pergunta]\n${fromLexical}`;
  return combined.length > 1500 ? `${combined.slice(0, 1499)}…` : combined;
}

type ChunkSimRow = {
  articleId: string;
  text: string;
  score: number;
};

/**
 * Recuperação por similaridade (coseno) via pgvector (`<=>` + índice HNSW).
 */
export async function rankedSemanticKnowledgeSearch(params: {
  organizationId: string;
  normalizedQuery: string;
  botId: string | undefined;
  limit: number;
  apiKey: string;
  embeddingModel: string;
  /** Máximo de linhas candidatas (ORDER BY distance); o índice acelera o scan. */
  chunkFetchCap?: number;
}): Promise<Array<{ article: KnowledgeArticleRow; score: number; excerpt: string }>> {
  const q = params.normalizedQuery.trim();
  if (!q) return [];

  const queryVectors = await embedTextsBatched({
    apiKey: params.apiKey,
    model: params.embeddingModel,
    inputs: [q],
    batchSize: 1,
  });
  const qv = queryVectors[0];
  if (!qv?.length) return [];

  const qLiteral = embeddingToVectorLiteral(qv);
  const take = Math.min(500, Math.max(40, params.chunkFetchCap ?? 160, params.limit * 14));

  const rows = await prisma.$queryRawUnsafe<ChunkSimRow[]>(
    `SELECT c.article_id AS "articleId",
            c.text,
            (1 - (c.embedding_vector <=> $1::vector))::float AS score
     FROM automation_knowledge_chunks c
     INNER JOIN automation_knowledge_articles a ON a.id = c.article_id
     WHERE c.organization_id = $2::uuid
       AND a.is_active = true
       AND a.sync_to_ai = true
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM automation_knowledge_article_bots ab
         WHERE ab.article_id = a.id AND ab.bot_id = $3::uuid
       ))
     ORDER BY c.embedding_vector <=> $1::vector
     LIMIT $4`,
    qLiteral,
    params.organizationId,
    params.botId ?? null,
    take,
  );

  if (!rows.length) return [];

  const topN = Math.min(rows.length, Math.max(params.limit * 10, 40));
  const topChunks = rows.slice(0, topN);

  const byArticle = new Map<string, { best: number; chunkTexts: string[] }>();
  for (const row of topChunks) {
    const sc = Number(row.score);
    const txt = row.text.trim();
    let agg = byArticle.get(row.articleId);
    if (!agg) {
      agg = { best: sc, chunkTexts: [] };
      byArticle.set(row.articleId, agg);
    }
    agg.best = Math.max(agg.best, sc);
    if (txt && agg.chunkTexts.length < 4 && !agg.chunkTexts.includes(txt)) {
      agg.chunkTexts.push(txt);
    }
  }

  const rankedPairs = [...byArticle.entries()].sort((a, b) => b[1].best - a[1].best).slice(0, params.limit);
  if (!rankedPairs.length) return [];

  const ids = rankedPairs.map(([id]) => id);
  const articles = await prisma.automationKnowledgeArticle.findMany({
    where: { id: { in: ids }, organizationId: params.organizationId },
  });
  const order = new Map(rankedPairs.map(([id], i) => [id, i]));
  articles.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));

  return articles.map((article) => {
    const meta = byArticle.get(article.id)!;
    const excerpt = buildRichSemanticExcerpt(meta.chunkTexts, article, q);
    return {
      article,
      score: meta.best,
      excerpt,
    };
  });
}
