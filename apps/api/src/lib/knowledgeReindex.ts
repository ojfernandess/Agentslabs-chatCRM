import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { chunkText } from "./knowledgeChunking.js";
import { embedTextsBatched } from "./openaiEmbeddings.js";
import { embeddingToVectorLiteral } from "./pgvectorEmbedding.js";

const MAX_CHUNKS_PER_ARTICLE = 80;
const DEFAULT_CHUNK_CHARS = 1500;
const DEFAULT_OVERLAP = 200;
const EMBED_BATCH = 16;

export async function reindexKnowledgeArticle(articleId: string): Promise<{ chunks: number } | { skipped: true; reason: string }> {
  const article = await prisma.automationKnowledgeArticle.findUnique({
    where: { id: articleId },
  });
  if (!article) {
    return { skipped: true, reason: "not_found" };
  }

  await prisma.automationKnowledgeChunk.deleteMany({ where: { articleId } });

  const apiKey = config.openAiPromptPreviewKey;
  if (!apiKey) {
    return { skipped: true, reason: "no_openai_key" };
  }

  if (!article.syncToAi || !article.isActive || !article.content.trim()) {
    return { chunks: 0 };
  }

  const pieces = chunkText(article.content, DEFAULT_CHUNK_CHARS, DEFAULT_OVERLAP).slice(0, MAX_CHUNKS_PER_ARTICLE);
  if (!pieces.length) {
    return { chunks: 0 };
  }

  const model = config.openAiEmbeddingModel;
  const embedInputs = pieces.map((text) => `${article.title}\n\n${text}`);

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
      const text = batchPieces[j];
      const vec = vectors[j];
      const lit = embeddingToVectorLiteral(vec);
      await prisma.$executeRawUnsafe(
        `INSERT INTO automation_knowledge_chunks (
           id, organization_id, article_id, chunk_index, text, embedding_model, dimensions, embedding_vector, created_at, updated_at
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, $6::varchar, $7::int, $8::vector, NOW(), NOW()
         )`,
        randomUUID(),
        article.organizationId,
        article.id,
        i + j,
        text,
        model,
        vec.length,
        lit,
      );
    }
  }

  return { chunks: pieces.length };
}

export async function reindexAllKnowledgeArticlesForOrg(organizationId: string): Promise<{ articles: number; errors: number }> {
  const articles = await prisma.automationKnowledgeArticle.findMany({
    where: { organizationId },
    select: { id: true },
  });
  let errors = 0;
  for (const a of articles) {
    try {
      await reindexKnowledgeArticle(a.id);
    } catch {
      errors += 1;
    }
  }
  return { articles: articles.length, errors };
}
