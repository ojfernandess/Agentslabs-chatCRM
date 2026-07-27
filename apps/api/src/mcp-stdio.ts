/**
 * OpenNexo MCP Server — ponto de entrada stdio para clientes locais (Cursor, Claude Desktop, VS Code).
 *
 * Uso:
 *   OPENNEXO_MCP_TOKEN=ocm_... npx tsx apps/api/src/mcp-stdio.ts
 *
 * Ou configure no Cursor (.cursor/mcp.json):
 *   { "mcpServers": { "opennexo": { "command": "npx", "args": ["tsx", "apps/api/src/mcp-stdio.ts"], "env": { "OPENNEXO_MCP_TOKEN": "ocm_..." } } } }
 */
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initMcpProviders } from "./lib/mcp/providers/index.js";
import { verifyMcpToken } from "./lib/mcp/auth/mcpTokenService.js";
import { createOpenNexoMcpServer } from "./lib/mcp/server/createMcpServer.js";
import type { McpAuthContext } from "./lib/mcp/types.js";

async function main(): Promise<void> {
  const token = process.env.OPENNEXO_MCP_TOKEN?.trim();
  if (!token) {
    console.error("OPENNEXO_MCP_TOKEN is required for stdio MCP server");
    process.exit(1);
  }

  const record = await verifyMcpToken(token);
  if (!record) {
    console.error("Invalid or expired OPENNEXO_MCP_TOKEN");
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
    clientName: "stdio",
    ipAddress: null,
  };

  initMcpProviders();
  const server = createOpenNexoMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
