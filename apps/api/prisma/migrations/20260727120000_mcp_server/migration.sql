-- OpenNexo MCP Server: tokens de acesso e auditoria

CREATE TABLE "mcp_access_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "token_prefix" VARCHAR(16) NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role" VARCHAR(32) NOT NULL DEFAULT 'developer',
    "permissions" JSONB,
    "allowed_bot_ids" JSONB,
    "environment" VARCHAR(32),
    "debug_mode" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "token_id" UUID,
    "client_name" VARCHAR(120),
    "action" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(64),
    "resource_id" VARCHAR(120),
    "ip_address" VARCHAR(64),
    "duration_ms" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mcp_access_tokens_organization_id_idx" ON "mcp_access_tokens"("organization_id");
CREATE INDEX "mcp_access_tokens_token_prefix_idx" ON "mcp_access_tokens"("token_prefix");

CREATE INDEX "mcp_audit_logs_organization_id_created_at_idx" ON "mcp_audit_logs"("organization_id", "created_at" DESC);
CREATE INDEX "mcp_audit_logs_token_id_created_at_idx" ON "mcp_audit_logs"("token_id", "created_at" DESC);

ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mcp_audit_logs" ADD CONSTRAINT "mcp_audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_audit_logs" ADD CONSTRAINT "mcp_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mcp_audit_logs" ADD CONSTRAINT "mcp_audit_logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "mcp_access_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
