-- CreateTable
CREATE TABLE "user_presence_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_key" VARCHAR(64) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "disconnected_at" TIMESTAMP(3),
    "source" VARCHAR(16) NOT NULL DEFAULT 'http',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_presence_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_presence_sessions_user_id_session_key_key" ON "user_presence_sessions"("user_id", "session_key");

-- CreateIndex
CREATE INDEX "user_presence_sessions_organization_id_user_id_disconnected_idx" ON "user_presence_sessions"("organization_id", "user_id", "disconnected_at", "last_seen_at");

-- CreateIndex
CREATE INDEX "user_presence_sessions_disconnected_at_last_seen_at_idx" ON "user_presence_sessions"("disconnected_at", "last_seen_at");

-- AddForeignKey
ALTER TABLE "user_presence_sessions" ADD CONSTRAINT "user_presence_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_presence_sessions" ADD CONSTRAINT "user_presence_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
