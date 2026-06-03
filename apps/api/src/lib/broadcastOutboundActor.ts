import { getAgentBotDispatchContextForInbox } from "./agentBotTriage.js";
import { parseSegmentRules, type OutboundSenderMode } from "./broadcastTypes.js";
import type { OutboundActor } from "./outboundMessage.js";

export function parseOutboundSenderMode(segmentRules: unknown): OutboundSenderMode {
  const rules = parseSegmentRules(segmentRules);
  const mode = rules?.outboundSender;
  if (mode === "agent" || mode === "bot") return mode;
  return "default";
}

export async function resolveBroadcastOutboundActor(options: {
  organizationId: string;
  segmentRules: unknown;
  createdById: string;
  inboxId: string;
}): Promise<OutboundActor> {
  const mode = parseOutboundSenderMode(options.segmentRules);

  if (mode === "bot") {
    const ctx = await getAgentBotDispatchContextForInbox(options.organizationId, options.inboxId);
    if (ctx) return { kind: "agent_bot", botId: ctx.agentBotId };
  }

  return {
    kind: "user",
    userId: options.createdById,
    ...(mode === "agent" ? { forceNamePrefix: true as const } : {}),
  };
}
