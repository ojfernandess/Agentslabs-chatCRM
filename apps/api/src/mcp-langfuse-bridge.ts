/**
 * Ponte stdio → HTTP para o Langfuse MCP remoto (Basic Auth).
 *
 * Credenciais via .env na raiz (mesmas vars da API):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL (ou LANGFUSE_HOST)
 *
 * Uso:
 *   npx tsx apps/api/src/mcp-langfuse-bridge.ts
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const DEFAULT_HOST = "https://cloud.langfuse.com";

const projectRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
loadEnv({ path: resolve(projectRoot, ".env") });

function readLangfuseMcpUrl(): string {
  const host = (
    process.env.LANGFUSE_BASE_URL?.trim() ||
    process.env.LANGFUSE_HOST?.trim() ||
    DEFAULT_HOST
  ).replace(/\/+$/, "");
  return `${host}/api/public/mcp`;
}

function readBasicAuthHeader(): string {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    console.error(
      "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required.\n" +
        "  Defina no .env na raiz do projecto (mesmas vars do Agent Engine):\n" +
        "    LANGFUSE_PUBLIC_KEY=pk-lf-...\n" +
        "    LANGFUSE_SECRET_KEY=sk-lf-...\n" +
        "    LANGFUSE_BASE_URL=https://cloud.langfuse.com\n" +
        "  Depois: reinicie o Cursor ou toggle o MCP em Settings → Tools & MCP.",
    );
    process.exit(1);
  }
  const token = Buffer.from(`${publicKey}:${secretKey}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function main(): Promise<void> {
  const remoteUrl = readLangfuseMcpUrl();
  const local = new StdioServerTransport();
  const remote = new StreamableHTTPClientTransport(new URL(remoteUrl), {
    requestInit: {
      headers: {
        Authorization: readBasicAuthHeader(),
      },
    },
  });

  let localClosed = false;
  let remoteClosed = false;

  local.onmessage = (message) => {
    void remote.send(message).catch((err) => {
      console.error("[langfuse-bridge] remote send failed:", err);
    });
  };
  remote.onmessage = (message) => {
    void local.send(message).catch((err) => {
      console.error("[langfuse-bridge] local send failed:", err);
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
  local.onerror = (err) => console.error("[langfuse-bridge] local error:", err);
  remote.onerror = (err) => console.error("[langfuse-bridge] remote error:", err);

  await local.start();
  await remote.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
