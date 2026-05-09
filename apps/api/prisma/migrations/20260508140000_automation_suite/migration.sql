-- Automação: base de conhecimento, perfis de agente, ferramentas, prompts, interações, contexto

CREATE TABLE "automation_knowledge_articles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "category" VARCHAR(120),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sync_to_ai" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_knowledge_articles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_knowledge_article_bots" (
    "article_id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,

    CONSTRAINT "automation_knowledge_article_bots_pkey" PRIMARY KEY ("article_id","bot_id")
);

CREATE TABLE "automation_knowledge_revisions" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "editor_user_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_knowledge_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kb_search_cache" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "query_hash" VARCHAR(64) NOT NULL,
    "article_ids" JSONB NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_search_cache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kb_search_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "query_normalized" VARCHAR(512) NOT NULL,
    "results_count" INTEGER NOT NULL,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_search_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_prompt_modules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "labels" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_prompt_modules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_agent_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "llm_config" JSONB NOT NULL,
    "behavior_config" JSONB NOT NULL,
    "prompt_module_ids" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_agent_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_custom_tools" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bot_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "tool_type" VARCHAR(32) NOT NULL,
    "config" JSONB NOT NULL,
    "parameters_schema" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_custom_tools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_interactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "conversation_id" UUID,
    "user_message" TEXT NOT NULL,
    "assistant_message" TEXT NOT NULL,
    "metadata" JSONB,
    "knowledge_article_ids" JSONB,
    "escalated_to_human" BOOLEAN NOT NULL DEFAULT false,
    "response_type" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_interactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_conversation_contexts" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "state" JSONB NOT NULL,
    "clear_policy" JSONB,
    "last_cleared_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_conversation_contexts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_agent_profiles_bot_id_key" ON "automation_agent_profiles"("bot_id");
CREATE UNIQUE INDEX "automation_conversation_contexts_conversation_id_key" ON "automation_conversation_contexts"("conversation_id");
CREATE UNIQUE INDEX "kb_search_cache_organization_id_query_hash_key" ON "kb_search_cache"("organization_id", "query_hash");
CREATE UNIQUE INDEX "automation_prompt_modules_organization_id_slug_key" ON "automation_prompt_modules"("organization_id", "slug");

CREATE INDEX "automation_knowledge_articles_organization_id_idx" ON "automation_knowledge_articles"("organization_id");
CREATE INDEX "automation_knowledge_articles_organization_id_is_active_idx" ON "automation_knowledge_articles"("organization_id", "is_active");
CREATE INDEX "automation_knowledge_article_bots_bot_id_idx" ON "automation_knowledge_article_bots"("bot_id");
CREATE INDEX "automation_knowledge_revisions_article_id_idx" ON "automation_knowledge_revisions"("article_id");
CREATE INDEX "automation_prompt_modules_organization_id_idx" ON "automation_prompt_modules"("organization_id");
CREATE INDEX "automation_agent_profiles_organization_id_idx" ON "automation_agent_profiles"("organization_id");
CREATE INDEX "automation_custom_tools_organization_id_idx" ON "automation_custom_tools"("organization_id");
CREATE INDEX "automation_custom_tools_bot_id_idx" ON "automation_custom_tools"("bot_id");
CREATE INDEX "automation_interactions_organization_id_created_at_idx" ON "automation_interactions"("organization_id", "created_at");
CREATE INDEX "automation_interactions_bot_id_created_at_idx" ON "automation_interactions"("bot_id", "created_at");
CREATE INDEX "automation_conversation_contexts_organization_id_idx" ON "automation_conversation_contexts"("organization_id");
CREATE INDEX "kb_search_logs_organization_id_created_at_idx" ON "kb_search_logs"("organization_id", "created_at");

ALTER TABLE "automation_knowledge_articles" ADD CONSTRAINT "automation_knowledge_articles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_knowledge_article_bots" ADD CONSTRAINT "automation_knowledge_article_bots_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "automation_knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_knowledge_article_bots" ADD CONSTRAINT "automation_knowledge_article_bots_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_knowledge_revisions" ADD CONSTRAINT "automation_knowledge_revisions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "automation_knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_knowledge_revisions" ADD CONSTRAINT "automation_knowledge_revisions_editor_user_id_fkey" FOREIGN KEY ("editor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kb_search_cache" ADD CONSTRAINT "kb_search_cache_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kb_search_logs" ADD CONSTRAINT "kb_search_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_prompt_modules" ADD CONSTRAINT "automation_prompt_modules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_agent_profiles" ADD CONSTRAINT "automation_agent_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_agent_profiles" ADD CONSTRAINT "automation_agent_profiles_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_custom_tools" ADD CONSTRAINT "automation_custom_tools_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_custom_tools" ADD CONSTRAINT "automation_custom_tools_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_interactions" ADD CONSTRAINT "automation_interactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_interactions" ADD CONSTRAINT "automation_interactions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_interactions" ADD CONSTRAINT "automation_interactions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_conversation_contexts" ADD CONSTRAINT "automation_conversation_contexts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_conversation_contexts" ADD CONSTRAINT "automation_conversation_contexts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_conversation_contexts" ADD CONSTRAINT "automation_conversation_contexts_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
