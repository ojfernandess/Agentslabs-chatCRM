-- Mural de avisos da plataforma. Isolado de conversas, CRM e notificações de atendimento.

CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'CRITICAL');
CREATE TYPE "AnnouncementTargetType" AS ENUM ('ALL', 'ORGANIZATION', 'PLAN');

CREATE TABLE "announcement_categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(40) NOT NULL DEFAULT 'Info',
    "tone" VARCHAR(24) NOT NULL DEFAULT 'slate',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "announcement_categories_slug_key" ON "announcement_categories"("slug");

CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "cover_url" VARCHAR(2048),
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "notify_users" BOOLEAN NOT NULL DEFAULT true,
    "requires_acknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "cta_label" VARCHAR(80),
    "cta_url" VARCHAR(2048),
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "published_by" UUID,
    "archived_by" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "announcements_slug_key" ON "announcements"("slug");
CREATE INDEX "announcements_status_published_at_idx" ON "announcements"("status", "published_at");
CREATE INDEX "announcements_scheduled_at_idx" ON "announcements"("scheduled_at");
CREATE INDEX "announcements_deleted_at_idx" ON "announcements"("deleted_at");
CREATE INDEX "announcements_category_id_idx" ON "announcements"("category_id");

CREATE TABLE "announcement_targets" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "target_type" "AnnouncementTargetType" NOT NULL,
    "target_id" VARCHAR(64) NOT NULL DEFAULT '',

    CONSTRAINT "announcement_targets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "announcement_targets_announcement_id_target_type_target_id_key" ON "announcement_targets"("announcement_id", "target_type", "target_id");
CREATE INDEX "announcement_targets_target_type_target_id_idx" ON "announcement_targets"("target_type", "target_id");

CREATE TABLE "announcement_reads" (
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcement_id","user_id")
);

CREATE INDEX "announcement_reads_user_id_idx" ON "announcement_reads"("user_id");

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "announcement_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "announcement_targets" ADD CONSTRAINT "announcement_targets_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "announcement_categories" ("id", "slug", "name", "description", "icon", "tone", "sort_order", "is_active", "created_at", "updated_at")
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'novelty', 'Novidade', 'Nova funcionalidade ou recurso.', 'Sparkles', 'brand', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000002', 'update', 'Atualização', 'Melhoria ou alteração na plataforma.', 'ArrowUp', 'sky', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000003', 'notice', 'Aviso', 'Informação geral.', 'Info', 'slate', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000004', 'important', 'Importante', 'Comunicado que merece maior atenção.', 'AlertTriangle', 'amber', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000005', 'maintenance', 'Manutenção', 'Manutenção programada ou informação técnica.', 'Wrench', 'rose', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('a1000000-0000-4000-8000-000000000006', 'tip', 'Dica', 'Orientação sobre utilização da plataforma.', 'Lightbulb', 'emerald', 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
