/**
 * Nvoip MCP Server — ponto de entrada stdio com DB local (Docker / dev com Postgres).
 *
 * Para Cursor no host Windows/macOS, use o bridge HTTP (sem DB local):
 *   apps/api/src/mcp-nvoip-http-bridge.ts
 *
 * Token: OPENNEXO_MCP_TOKEN=ocm_... ou NVOIP_MCP_TOKEN=ocm_...
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { verifyMcpToken } from "./lib/mcp/auth/mcpTokenService.js";
import { nvoipProvider } from "./lib/mcp/providers/nvoipProvider.js";
import { registerMcpProvider } from "./lib/mcp/providers/ProviderRegistry.js";
import { createNvoipMcpServer } from "./lib/mcp/server/createNvoipMcpServer.js";
import type { McpAuthContext } from "./lib/mcp/types.js";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../../..");
loadEnv({ path: resolve(projectRoot, ".env") });

async function main(): Promise<void> {
  const token = process.env.OPENNEXO_MCP_TOKEN?.trim() || process.env.NVOIP_MCP_TOKEN?.trim();
  if (!token) {
    console.error(
      "OPENNEXO_MCP_TOKEN (or NVOIP_MCP_TOKEN) is required.\n" +
        "  Crie um token em Super Admin → MCP Server e defina no .env:\n" +
        "    OPENNEXO_MCP_TOKEN=ocm_...\n" +
        "  Depois reinicie o Cursor.",
    );
    process.exit(1);
  }

  const record = await verifyMcpToken(token);
  if (!record) {
    console.error("Invalid or expired MCP token");
    process.exit(1);
  }

  const ctx: McpAuthContext = {
    organizationId: record.organizationId,
    userId: record.userId,
    tokenId: record.id,
    role: record.role,
    permissions: record.permissions as McpAuthContext["permissions"],
    allowedBotIds: record.allowedBotIds,
    environment: record.environment,
    debugMode: record.debugMode,
    authMethod: "mcp_token",
    clientName: "nvoip-stdio",
    ipAddress: null,
  };

  registerMcpProvider(nvoipProvider);
  const server = createNvoipMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
