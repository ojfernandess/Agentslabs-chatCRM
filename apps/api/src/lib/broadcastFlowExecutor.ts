import type { BroadcastCampaign } from "@prisma/client";
import type { BroadcastFlowDefinition } from "./broadcastTypes.js";
import { parseFlowDefinition } from "./broadcastTypes.js";

export interface FlowExecutionContext {
  campaign: BroadcastCampaign;
  contactId: string;
}

/** Executa nós de fluxo antes do envio principal (wait/condition simplificados). */
export async function runPreSendFlowSteps(ctx: FlowExecutionContext): Promise<{ skipSend: boolean }> {
  const flow = parseFlowDefinition(ctx.campaign.flowDefinition);
  if (!flow?.nodes?.length) return { skipSend: false };

  const start =
    flow.nodes.find((n) => n.type === "start" || n.id === "start") ?? flow.nodes[0];
  if (!start) return { skipSend: false };

  let currentId: string | null = start.id;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = flow.nodes.find((n) => n.id === currentId);
    if (!node) break;

    if (node.type === "wait") {
      const minutes = Number(node.data?.minutes ?? 0);
      if (minutes > 0 && minutes <= 60 * 24) {
        await new Promise((r) => setTimeout(r, Math.min(minutes * 60_000, 5_000)));
      }
    }

    if (node.type === "condition") {
      const field = String(node.data?.field ?? "");
      const value = String(node.data?.value ?? "");
      const pass = field && value ? true : true;
      const edge = flow.edges.find(
        (e) => e.source === node.id && (pass ? e.id.includes("yes") || !e.id.includes("no") : e.id.includes("no")),
      );
      currentId = edge?.target ?? flow.edges.find((e) => e.source === node.id)?.target ?? null;
      continue;
    }

    if (node.type === "end" || node.type === "stop") {
      return { skipSend: node.type === "stop" };
    }

    const nextEdge = flow.edges.find((e) => e.source === currentId);
    currentId = nextEdge?.target ?? null;
  }

  return { skipSend: false };
}

export function defaultFlowDefinition(): BroadcastFlowDefinition {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "send", type: "send_message", position: { x: 0, y: 80 }, data: {} },
      { id: "end", type: "end", position: { x: 0, y: 160 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "send" },
      { id: "e2", source: "send", target: "end" },
    ],
  };
}
