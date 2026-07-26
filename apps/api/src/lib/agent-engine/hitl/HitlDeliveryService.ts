import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../../db.js";
import { deliverOutboundWhatsAppMessage } from "../../outboundMessage.js";
import type { HitlPendingApproval } from "./HumanInTheLoopStore.js";
import { getHitlPendingAsync, resolveHitlPending } from "./HumanInTheLoopStore.js";
import { resumeLangGraphFromHitl } from "./HitlGraphResumeService.js";

export type HitlResolveResult = {
  row: HitlPendingApproval;
  delivered: boolean;
  outboundMessageId?: string;
  graphResumed?: boolean;
};

export async function resolveHitlWithActions(input: {
  id: string;
  organizationId: string;
  decision: "approved" | "rejected";
  deliverOnApprove?: boolean;
  resumeGraph?: boolean;
  log: FastifyBaseLogger;
}): Promise<HitlResolveResult | null> {
  const pending = await getHitlPendingAsync(input.id, input.organizationId);
  if (!pending || pending.organizationId !== input.organizationId || pending.status !== "pending") {
    return null;
  }

  const row = resolveHitlPending(input.id, input.organizationId, input.decision);
  if (!row) return null;

  let delivered = false;
  let outboundMessageId: string | undefined;
  let graphResumed = false;

  if (input.decision === "approved" && input.deliverOnApprove !== false && row.replyPreview.trim()) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: row.conversationId, organizationId: input.organizationId },
      select: { id: true, contactId: true },
    });
    if (conversation?.contactId) {
      try {
        const { message } = await deliverOutboundWhatsAppMessage({
          organizationId: input.organizationId,
          data: {
            contactId: conversation.contactId,
            conversationId: row.conversationId,
            type: "TEXT",
            body: row.replyPreview,
          },
          actor: { kind: "agent_bot", botId: row.botId },
          log: input.log,
          newConversation: { status: "PENDING", assignedToId: null },
        });
        delivered = true;
        outboundMessageId = message.id;
        row.deliveredMessageId = message.id;
      } catch (err) {
        input.log.warn({ err, hitlId: row.id }, "HITL approve delivery failed");
      }
    }
  }

  if (
    input.decision === "approved" &&
    input.resumeGraph !== false &&
    row.humanInTheLoopNative &&
    row.threadId
  ) {
    try {
      graphResumed = await resumeLangGraphFromHitl({
        organizationId: input.organizationId,
        threadId: row.threadId,
        checkpointStore: row.checkpointStore ?? "memory",
        decision: "approved",
        log: input.log,
      });
    } catch (err) {
      input.log.warn({ err, hitlId: row.id, threadId: row.threadId }, "HITL graph resume failed");
    }
  }

  return { row, delivered, outboundMessageId, graphResumed };
}
