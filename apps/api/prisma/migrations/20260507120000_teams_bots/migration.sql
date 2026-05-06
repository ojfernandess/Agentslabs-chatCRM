-- Times, bots, transferência de conversas para time, histórico mínimo de bot.

CREATE TYPE "TeamMemberRole" AS ENUM ('TEAM_ADMIN', 'SUPERVISOR', 'MEMBER');
CREATE TYPE "BotType" AS ENUM ('WEBHOOK', 'DIALOGFLOW', 'CUSTOM');

CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" VARCHAR(2048),
    "business_hours" JSONB,
    "notification_settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "teams_organization_id_idx" ON "teams"("organization_id");
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_members_team_id_user_id_key" ON "team_members"("team_id", "user_id");
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" VARCHAR(2048),
    "type" "BotType" NOT NULL DEFAULT 'WEBHOOK',
    "webhook_url" VARCHAR(2048),
    "config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bots_organization_id_idx" ON "bots"("organization_id");
ALTER TABLE "bots" ADD CONSTRAINT "bots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD COLUMN "team_id" UUID;
CREATE INDEX "conversations_team_id_idx" ON "conversations"("team_id");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "bot_interactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bot_id" UUID NOT NULL,
    "conversation_id" UUID,
    "direction" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_interactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bot_interactions_bot_id_created_at_idx" ON "bot_interactions"("bot_id", "created_at");
CREATE INDEX "bot_interactions_conversation_id_idx" ON "bot_interactions"("conversation_id");
ALTER TABLE "bot_interactions" ADD CONSTRAINT "bot_interactions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_interactions" ADD CONSTRAINT "bot_interactions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
