-- User profile API access token (Chatwoot-like personal token)
ALTER TABLE "users"
ADD COLUMN "api_access_token_prefix" VARCHAR(16),
ADD COLUMN "api_access_token_hash" TEXT,
ADD COLUMN "api_access_token_last_used_at" TIMESTAMP(3);

CREATE INDEX "users_api_access_token_prefix_idx" ON "users"("api_access_token_prefix");
