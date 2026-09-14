/**
 * Ponte stdio → HTTP para o Nvoip MCP remoto (Bearer token, sem DB local).
 *
 * Token via OPENNEXO_MCP_TOKEN ou NVOIP_MCP_TOKEN:
 *   - variável de ambiente do Windows (recomendado para Cursor), ou
 *   - ficheiro .env na raiz do projecto (gitignored)
 *
 * Uso:
 *   OPENNEXO_MCP_TOKEN=ocm_... npx tsx apps/api/src/mcp-nvoip-http-bridge.ts
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const DEFAULT_OPENNEXO_URL = "https://chat.agentslabs.cloud/api/v1/super/mcp";
const DEFAULT_NVOIP_URL = `${DEFAULT_OPENNEXO_URL}/nvoip`;

const projectRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
loadEnv({ path: resolve(projectRoot, ".env") });

async function main(): Promise<void> {
  const token =
    process.env.NVOIP_MCP_TOKEN?.trim() || process.env.OPENNEXO_MCP_TOKEN?.trim();
  if (!token) {
    console.error(
      "NVOIP_MCP_TOKEN or OPENNEXO_MCP_TOKEN is required.\n" +
        "  Opção A — variável Windows (User): OPENNEXO_MCP_TOKEN=ocm_...\n" +
        "  Opção B — ficheiro .env na raiz: OPENNEXO_MCP_TOKEN=ocm_...\n" +
        "  Depois: feche e reabra o Cursor.",
    );
    process.exit(1);
  }

  const opennexoBase = process.env.OPENNEXO_MCP_URL?.trim()?.replace(/\/$/, "");
  const remoteUrl = (
    process.env.NVOIP_MCP_URL?.trim() ||
    (opennexoBase ? `${opennexoBase}/nvoip` : DEFAULT_NVOIP_URL)
  ).replace(/\/$/, "");

  const local = new StdioServerTransport();
  const remote = new StreamableHTTPClientTransport(new URL(remoteUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  let localClosed = false;
  let remoteClosed = false;

  local.onmessage = (message) => {
    void remote.send(message).catch((err) => {
      console.error("[nvoip-bridge] remote send failed:", err);
    });
  };
  remote.onmessage = (message) => {
    void local.send(message).catch((err) => {
      console.error("[nvoip-bridge] local send failed:", err);
    });
  };
  local.onclose = () => {
    if (remoteClosed) return;
    localClosed = true;
    void remote.close();
  };
  remote.onclose = () => {
    if (localClosed) return;
    remoteClosed = true;
    void local.close();
  };
  local.onerror = (err) => console.error("[nvoip-bridge] local error:", err);
  remote.onerror = (err) => console.error("[nvoip-bridge] remote error:", err);

  await local.start();
  await remote.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
