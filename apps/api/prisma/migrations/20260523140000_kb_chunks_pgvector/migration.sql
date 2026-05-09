CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "automation_knowledge_chunks" ADD COLUMN "embedding_vector" vector(1536);

UPDATE "automation_knowledge_chunks" c
SET "embedding_vector" = (
  SELECT ('[' || string_agg(sub.elem, ',' ORDER BY sub.ord) || ']')::vector
  FROM (
    SELECT elem AS elem, ordinality AS ord
    FROM jsonb_array_elements_text(c.embedding::jsonb) WITH ORDINALITY AS x(elem, ordinality)
  ) sub
)
WHERE c.embedding IS NOT NULL
  AND jsonb_typeof(c.embedding::jsonb) = 'array'
  AND jsonb_array_length(c.embedding::jsonb) = 1536;

DELETE FROM "automation_knowledge_chunks" WHERE "embedding_vector" IS NULL;

ALTER TABLE "automation_knowledge_chunks" DROP COLUMN "embedding";

CREATE INDEX "automation_knowledge_chunks_embedding_vector_hnsw"
ON "automation_knowledge_chunks"
USING hnsw ("embedding_vector" vector_cosine_ops);
