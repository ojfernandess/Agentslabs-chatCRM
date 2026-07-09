-- Pastas personalizadas de e-mail e estado por utilizador (favorito / pasta)

CREATE TABLE "inbox_email_folders" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,
    "inbox_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "inbox_email_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_user_email_states" (
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "email_folder_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_user_email_states_pkey" PRIMARY KEY ("user_id","conversation_id")
);

CREATE UNIQUE INDEX "inbox_email_folders_inbox_id_user_id_name_key" ON "inbox_email_folders"("inbox_id", "user_id", "name");
CREATE INDEX "inbox_email_folders_inbox_id_user_id_idx" ON "inbox_email_folders"("inbox_id", "user_id");
CREATE INDEX "conversation_user_email_states_user_id_email_folder_id_idx" ON "conversation_user_email_states"("user_id", "email_folder_id");
CREATE INDEX "conversation_user_email_states_user_id_is_starred_idx" ON "conversation_user_email_states"("user_id", "is_starred");

ALTER TABLE "inbox_email_folders" ADD CONSTRAINT "inbox_email_folders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_email_folders" ADD CONSTRAINT "inbox_email_folders_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_email_folders" ADD CONSTRAINT "inbox_email_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_user_email_states" ADD CONSTRAINT "conversation_user_email_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_user_email_states" ADD CONSTRAINT "conversation_user_email_states_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_user_email_states" ADD CONSTRAINT "conversation_user_email_states_email_folder_id_fkey" FOREIGN KEY ("email_folder_id") REFERENCES "inbox_email_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
