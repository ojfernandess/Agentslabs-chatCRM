-- CreateEnum
CREATE TYPE "TeamChannelKind" AS ENUM ('GENERAL', 'ANNOUNCEMENTS', 'OPS');

-- CreateEnum
CREATE TYPE "TeamWorkspaceItemType" AS ENUM ('NOTE', 'WIKI', 'SNIPPET', 'FILE_LINK');

-- CreateTable
CREATE TABLE "team_channels" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "TeamChannelKind" NOT NULL DEFAULT 'GENERAL',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,

    CONSTRAINT "team_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_channel_messages" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,

    CONSTRAINT "team_channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_workspace_items" (
    "id" UUID NOT NULL,
    "item_type" "TeamWorkspaceItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "file_url" VARCHAR(2048),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "team_workspace_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_channels_team_id_name_key" ON "team_channels"("team_id", "name");

-- CreateIndex
CREATE INDEX "team_channels_organization_id_idx" ON "team_channels"("organization_id");

-- CreateIndex
CREATE INDEX "team_channel_messages_channel_id_created_at_idx" ON "team_channel_messages"("channel_id", "created_at");

-- CreateIndex
CREATE INDEX "team_workspace_items_team_id_item_type_idx" ON "team_workspace_items"("team_id", "item_type");

-- CreateIndex
CREATE INDEX "team_workspace_items_organization_id_idx" ON "team_workspace_items"("organization_id");

-- AddForeignKey
ALTER TABLE "team_channels" ADD CONSTRAINT "team_channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_channels" ADD CONSTRAINT "team_channels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_channel_messages" ADD CONSTRAINT "team_channel_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "team_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_channel_messages" ADD CONSTRAINT "team_channel_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_workspace_items" ADD CONSTRAINT "team_workspace_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_workspace_items" ADD CONSTRAINT "team_workspace_items_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_workspace_items" ADD CONSTRAINT "team_workspace_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
