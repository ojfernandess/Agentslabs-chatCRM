import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { DEFAULT_KNOWLEDGE_CHUNKING } from "./agent-engine/knowledge/knowledgeEngineTypes.js";
import { chunkKnowledgeDocumentContent } from "./knowledgeMarkdownChunking.js";
import { embedTextsBatched } from "./openaiEmbeddings.js";
import { embeddingToVectorLiteral } from "./pgvectorEmbedding.js";

const MAX_CHUNKS_PER_ARTICLE = 80;
const EMBED_BATCH = 16;

export type ReindexChunkOptions = {
  chunkSize?: number;
  overlap?: number;
  maxChunks?: number;
};

export type ReindexArticleResult =
  | { chunks: number; skipped?: false }
  | { skipped: true; reason: string; chunks?: number };

export type ReindexOrgSummary = {
  /** Artigos elegíveis (activos + syncToAi + conteúdo). */
  articles: number;
  articlesIndexed: number;
  articlesSkipped: number;
  articlesCleared: number;
  chunksTotal: number;
  errors: number;
  skippedReasons: Record<string, number>;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string | null;
};

type PreparedChunkRow = {
  chunkIndex: number;
  text: string;
  vector: number[];
};

function resolveChunkOptions(opts?: ReindexChunkOptions): Required<ReindexChunkOptions> {
  return {
    chunkSize: opts?.chunkSize ?? DEFAULT_KNOWLEDGE_CHUNKING.chunkSize,
    overlap: opts?.overlap ?? DEFAULT_KNOWLEDGE_CHUNKING.chunkOverlap,
    maxChunks: opts?.maxChunks ?? MAX_CHUNKS_PER_ARTICLE,
  };
}

function defaultChunkOptions(): Required<ReindexChunkOptions> {
  return resolveChunkOptions();
}

async function clearArticleChunks(articleId: string): Promise<void> {
  await prisma.automationKnowledgeChunk.deleteMany({ where: { articleId } });
}

async function insertChunkRows(params: {
  organizationId: string;
  articleId: string;
  title: string;
  model: string;
  rows: PreparedChunkRow[];
}): Promise<void> {
  for (const row of params.rows) {
    const lit = embeddingToVectorLiteral(row.vector);
    await prisma.$executeRawUnsafe(
      `INSERT INTO automation_knowledge_chunks (
         id, organization_id, article_id, chunk_index, text, embedding_model, dimensions, embedding_vector, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, $6::varchar, $7::int, $8::vector, NOW(), NOW()
       )`,
      randomUUID(),
      params.organizationId,
      params.articleId,
      row.chunkIndex,
      row.text,
      params.model,
      row.vector.length,
      lit,
    );
  }
}

/**
 * Reindexa um artigo: embeddings novos + chunking por secção markdown.
 * Não apaga chunks existentes até os novos embeddings estarem prontos.
 */
export async function reindexKnowledgeArticle(
  articleId: string,
  opts?: ReindexChunkOptions,
): Promise<ReindexArticleResult> {
  const article = await prisma.automationKnowledgeArticle.findUnique({
    where: { id: articleId },
  });
  if (!article) {
    return { skipped: true, reason: "not_found" };
  }

  const chunkOpts = resolveChunkOptions(opts);

  if (!article.syncToAi || !article.isActive || !article.content.trim()) {
    await clearArticleChunks(articleId);
    return { chunks: 0 };
  }

  const apiKey = config.openAiPromptPreviewKey;
  if (!apiKey) {
    return { skipped: true, reason: "no_openai_key" };
  }

  const pieces = chunkKnowledgeDocumentContent(article.content, {
    chunkSize: chunkOpts.chunkSize,
    overlap: chunkOpts.overlap,
    maxChunks: chunkOpts.maxChunks,
  });
  if (!pieces.length) {
    await clearArticleChunks(articleId);
    return { chunks: 0 };
  }

  const model = config.openAiEmbeddingModel;
  const embedInputs = pieces.map((text) => `${article.title}\n\n${text}`);
  const prepared: PreparedChunkRow[] = [];

  for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
    const batchPieces = pieces.slice(i, i + EMBED_BATCH);
    const batchInputs = embedInputs.slice(i, i + EMBED_BATCH);
    const vectors = await embedTextsBatched({
      apiKey,
      model,
      inputs: batchInputs,
      batchSize: EMBED_BATCH,
    });
    for (let j = 0; j < batchPieces.length; j++) {
      prepared.push({
        chunkIndex: i + j,
        text: batchPieces[j]!,
        vector: vectors[j]!,
      });
    }
  }

  await clearArticleChunks(articleId);
  await insertChunkRows({
    organizationId: article.organizationId,
    articleId: article.id,
    title: article.title,
    model,
    rows: prepared,
  });

  return { chunks: prepared.length };
}

export async function reindexAllKnowledgeArticlesForOrg(organizationId: string): Promise<ReindexOrgSummary> {
  const chunkOpts = defaultChunkOptions();
  const embeddingModel = config.openAiPromptPreviewKey ? config.openAiEmbeddingModel : null;

  const eligible = await prisma.automationKnowledgeArticle.findMany({
    where: {
      organizationId,
      isActive: true,
      syncToAi: true,
      NOT: { content: "" },
    },
    select: { id: true },
  });

  const ineligible = await prisma.automationKnowledgeArticle.findMany({
    where: {
      organizationId,
      OR: [{ isActive: false }, { syncToAi: false }, { content: "" }],
    },
    select: { id: true },
  });

  let articlesIndexed = 0;
  let articlesSkipped = 0;
  let chunksTotal = 0;
  let errors = 0;
  const skippedReasons: Record<string, number> = {};

  for (const a of eligible) {
    try {
      const result = await reindexKnowledgeArticle(a.id, chunkOpts);
      if ("skipped" in result && result.skipped) {
        articlesSkipped += 1;
        skippedReasons[result.reason] = (skippedReasons[result.reason] ?? 0) + 1;
      } else {
        chunksTotal += result.chunks ?? 0;
        if ((result.chunks ?? 0) > 0) articlesIndexed += 1;
      }
    } catch {
      errors += 1;
    }
  }

  let articlesCleared = 0;
  for (const a of ineligible) {
    try {
      const deleted = await prisma.automationKnowledgeChunk.deleteMany({ where: { articleId: a.id } });
      if (deleted.count > 0) articlesCleared += 1;
    } catch {
      errors += 1;
    }
  }

  return {
    articles: eligible.length,
    articlesIndexed,
    articlesSkipped,
    articlesCleared,
    chunksTotal,
    errors,
    skippedReasons,
    chunkSize: chunkOpts.chunkSize,
    chunkOverlap: chunkOpts.overlap,
    embeddingModel,
  };
}
