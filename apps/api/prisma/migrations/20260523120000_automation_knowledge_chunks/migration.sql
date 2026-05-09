-- CreateTable
CREATE TABLE "automation_knowledge_chunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding_model" VARCHAR(80) NOT NULL DEFAULT 'text-embedding-3-small',
    "dimensions" INTEGER NOT NULL DEFAULT 1536,
    "embedding" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_knowledge_chunks_organization_id_idx" ON "automation_knowledge_chunks"("organization_id");

-- CreateIndex
CREATE INDEX "automation_knowledge_chunks_article_id_idx" ON "automation_knowledge_chunks"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_knowledge_chunks_article_id_chunk_index_key" ON "automation_knowledge_chunks"("article_id", "chunk_index");

-- AddForeignKey
ALTER TABLE "automation_knowledge_chunks" ADD CONSTRAINT "automation_knowledge_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_knowledge_chunks" ADD CONSTRAINT "automation_knowledge_chunks_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "automation_knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
