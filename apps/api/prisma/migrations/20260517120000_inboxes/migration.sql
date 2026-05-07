-- CreateTable
CREATE TABLE "inboxes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_members" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inbox_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "inbox_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inbox_members_inbox_id_user_id_key" UNIQUE ("inbox_id", "user_id")
);

ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_members" ADD CONSTRAINT "inbox_members_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_members" ADD CONSTRAINT "inbox_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD COLUMN "inbox_id" UUID;

INSERT INTO "inboxes" ("id", "name", "description", "is_default", "created_at", "updated_at", "organization_id")
SELECT gen_random_uuid(), 'Caixa principal', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, o.id
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "inboxes" i WHERE i.organization_id = o.id AND i.is_default = true
);

UPDATE "conversations" c
SET "inbox_id" = i.id
FROM "inboxes" i
WHERE i.organization_id = c.organization_id AND i.is_default = true;

ALTER TABLE "conversations" ALTER COLUMN "inbox_id" SET NOT NULL;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "inbox_members" ("id", "created_at", "inbox_id", "user_id")
SELECT gen_random_uuid(), CURRENT_TIMESTAMP, i.id, u.id
FROM "inboxes" i
INNER JOIN "users" u ON u.organization_id = i.organization_id
WHERE i.is_default = true
ON CONFLICT ("inbox_id", "user_id") DO NOTHING;

CREATE INDEX "inboxes_organization_id_idx" ON "inboxes"("organization_id");

CREATE UNIQUE INDEX "inboxes_one_default_per_org" ON "inboxes"("organization_id") WHERE ("is_default" = true);

CREATE INDEX "inbox_members_user_id_idx" ON "inbox_members"("user_id");

CREATE INDEX "conversations_inbox_id_idx" ON "conversations"("inbox_id");
