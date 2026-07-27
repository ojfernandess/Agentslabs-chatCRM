import { prisma } from "../../../db.js";
import { parseAgentEngineConfig } from "../../agent-engine/config/parseAgentEngineConfig.js";
import { requirePermission } from "../access/permissions.js";
import { assertBotAccess } from "../auth/resolveMcpAuth.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

const LANGGRAPH_NODES = [
  "classify_intent",
  "load_memory",
  "select_tool",
  "execute_tool",
  "validate_result",
  "supervisor",
  "reply",
];

export const workflowProvider: McpProvider = {
  domain: "workflow",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "workflow:read");
    const bots = await prisma.bot.findMany({
      where: {
        organizationId: ctx.organizationId,
        automationProfile: { isNot: null },
        ...(params?.botId ? { id: params.botId } : {}),
      },
      take: params?.limit ?? 30,
      select: { id: true, name: true },
    });
    return bots.map((b) => ({
      uri: `opennexo://workflow/${b.id}`,
      name: `Workflow ${b.name}`,
      description: `Agent workflow graph for ${b.name}`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "workflow:read");
    const botId = uri.replace("opennexo://workflow/", "");
    assertBotAccess(ctx, botId);

    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId, organizationId: ctx.organizationId },
      include: { bot: { select: { name: true } } },
    });
    if (!profile) throw new Error("Workflow not found");

    const beh =
      profile.behaviorConfig && typeof profile.behaviorConfig === "object"
        ? (profile.behaviorConfig as Record<string, unknown>)
        : {};
    const engine = parseAgentEngineConfig(beh);

    const nodes = LANGGRAPH_NODES.map((id) => ({
      id,
      type: "agent_node",
    }));
    const edges = LANGGRAPH_NODES.slice(0, -1).map((from, i) => ({
      from,
      to: LANGGRAPH_NODES[i + 1]!,
      type: "sequential",
    }));

    return sanitizeForMcp({
      botId,
      botName: profile.bot.name,
      runtime: engine.runtime,
      supervisorEnabled: engine.supervisorEnabled,
      strictMode: engine.strictMode,
      checkpointStore: engine.checkpointStore,
      streamingEnabled: engine.streamingEnabled,
      humanInTheLoopEnabled: engine.humanInTheLoopEnabled,
      nodes,
      edges,
      conditionalEdges: engine.runtime === "langgraph" ? [{ from: "select_tool", condition: "tool_required" }] : [],
      parallel: [{ nodes: ["load_memory", "prefetch_kb"], when: "langgraph" }],
      ...(ctx.debugMode ? { behaviorConfig: beh } : {}),
    });
  },
};

export const langgraphProvider: McpProvider = {
  domain: "langgraph",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "langgraph:read");
    const executions = await prisma.automationExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        workflowKey: { contains: "langgraph" },
        ...(params?.botId ? { botId: params.botId } : {}),
      },
      take: params?.limit ?? 20,
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true },
    });
    return executions.map((e) => ({
      uri: `opennexo://langgraph/${e.id}`,
      name: `LangGraph run ${e.id.slice(0, 8)}`,
      description: `LangGraph execution — ${e.status}`,
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "langgraph:read");
    const executionId = uri.replace("opennexo://langgraph/", "");
    const execution = await prisma.automationExecution.findFirst({
      where: { id: executionId, organizationId: ctx.organizationId },
      include: {
        logEntries: { orderBy: { sequence: "asc" } },
        bot: { select: { name: true } },
      },
    });
    if (!execution) throw new Error("LangGraph execution not found");

    const graphEvents = execution.logEntries
      .filter((e) => e.nodeId.startsWith("lg_") || /langgraph/i.test(e.nodeName))
      .map((e) => ({
        nodeId: e.nodeId,
        nodeName: e.nodeName,
        level: e.level,
        message: e.message,
        sequence: e.sequence,
        at: e.createdAt,
      }));

    const interrupts = execution.logEntries.filter((e) =>
      /interrupt|hitl|human.in.the.loop/i.test(e.message),
    );

    return sanitizeForMcp({
      executionId,
      botName: execution.bot.name,
      status: execution.status,
      checkpointThreadId: execution.conversationId,
      graph: { nodes: LANGGRAPH_NODES, runtime: "langgraph" },
      history: graphEvents,
      interrupts: interrupts.map((e) => ({
        nodeId: e.nodeId,
        message: e.message,
        at: e.createdAt,
      })),
      streaming: graphEvents.length > 0,
      ...(ctx.debugMode
        ? {
            fullLog: execution.logEntries.map((e) => ({
              nodeId: e.nodeId,
              message: e.message,
              inputContext: e.inputContext,
              outputContext: e.outputContext,
            })),
          }
        : {}),
    });
  },
};
