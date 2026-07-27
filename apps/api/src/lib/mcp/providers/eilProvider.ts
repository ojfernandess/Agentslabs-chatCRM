import { prisma } from "../../../db.js";
import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

function tryParseJson(message: string): unknown {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

/** Extrai snapshot EIL de logs de execução / agent_engine_trace. */
function extractEilFromLogMessages(messages: string[]): unknown {
  for (const msg of [...messages].reverse()) {
    const parsed = tryParseJson(msg);
    if (parsed && typeof parsed === "object" && "eil" in (parsed as object)) {
      return (parsed as { eil: unknown }).eil;
    }
  }
  return null;
}

export const eilProvider: McpProvider = {
  domain: "eil",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "eil:read");
    const executions = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(params?.botId ? { botId: params.botId } : {}),
      },
      take: params?.limit ?? 20,
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true },
    });
    return executions.map((e) => ({
      uri: `opennexo://eil/${e.id}`,
      name: `EIL ${e.id.slice(0, 8)}`,
      description: "Execution Intelligence Layer snapshot",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "eil:read");
    const executionId = uri.replace("opennexo://eil/", "");
    const entries = await prisma.automationExecutionLogEntry.findMany({
      where: {
        executionId,
        OR: [
          { nodeId: { contains: "agent_engine" } },
          { nodeId: { contains: "eil" } },
          { message: { contains: "eil", mode: "insensitive" } },
          { message: { contains: "F-EIL" } },
        ],
      },
      orderBy: { sequence: "asc" },
      include: {
        execution: { select: { organizationId: true, botId: true, status: true } },
      },
    });

    const traceEntries =
      entries.length > 0
        ? entries
        : await prisma.automationExecutionLogEntry.findMany({
            where: {
              executionId,
              OR: [
                { nodeId: "agent_engine_trace" },
                { nodeName: { contains: "Trace", mode: "insensitive" } },
              ],
            },
            orderBy: { sequence: "desc" },
            take: 5,
            include: {
              execution: { select: { organizationId: true, botId: true, status: true } },
            },
          });

    if (!traceEntries.length || traceEntries[0]!.execution.organizationId !== ctx.organizationId) {
      throw new Error("EIL data not found for execution");
    }

    const messages = traceEntries.map((e) => e.message);
    let eilSnapshot = extractEilFromLogMessages(messages);
    for (const msg of messages) {
      const parsed = tryParseJson(msg);
      if (parsed && typeof parsed === "object" && (parsed as { eil?: unknown }).eil) {
        eilSnapshot = (parsed as { eil: unknown }).eil;
        break;
      }
    }

    return sanitizeForMcp({
      executionId,
      status: traceEntries[0]!.execution.status,
      eil: eilSnapshot,
      logHits: traceEntries.map((e) => ({
        sequence: e.sequence,
        nodeId: e.nodeId,
        nodeName: e.nodeName,
        level: e.level,
        messagePreview: e.message.slice(0, 500),
      })),
      workflowValidatorEil: messages.filter((m) => /F-EIL|eil_/i.test(m)).slice(0, 20),
    });
  },

  async search(ctx, params: McpProviderSearchParams) {
    requirePermission(ctx, "eil:read");
    if (params.executionId) {
      return this.readResource(ctx, `opennexo://eil/${params.executionId}`);
    }
    const resources = await this.listResources(ctx, params);
    return { items: resources, count: resources.length };
  },
};
