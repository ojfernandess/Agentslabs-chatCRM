import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { fireCrmFlowTriggers } from "./crmFlowHooks.js";
import type { CrmFlowTriggerConfig } from "./crmFlowTriggerFilters.js";

type NoReplyTriggerConfig = CrmFlowTriggerConfig & {
  noReplyHours?: number;
};

/** Detecta conversas sem resposta do cliente e dispara fluxos com trigger `contact_no_reply`. */
export async function runCrmFlowNoReplyScannerTick(app: FastifyInstance): Promise<void> {
  const flows = await prisma.crmFlow.findMany({
    where: { status: "ACTIVE", isPublished: true },
    select: { id: true, organizationId: true, triggerConfig: true },
  });

  const noReplyFlows = flows.filter((f) => {
    const cfg = f.triggerConfig as NoReplyTriggerConfig | null;
    return (cfg?.type ?? "") === "contact_no_reply";
  });

  if (noReplyFlows.length === 0) return;

  for (const flow of noReplyFlows) {
    const cfg = flow.triggerConfig as NoReplyTriggerConfig;
    const hours = Math.max(1, Number(cfg.noReplyHours ?? 24));
    const threshold = new Date(Date.now() - hours * 3_600_000);

    const conversations = await prisma.conversation.findMany({
      where: {
        organizationId: flow.organizationId,
        status: { in: ["OPEN", "PENDING"] },
        ...(cfg.inboxId ? { inboxId: cfg.inboxId } : {}),
      },
      select: {
        id: true,
        contactId: true,
        inboxId: true,
        messages: {
          where: { isPrivate: false },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, direction: true, createdAt: true, body: true },
        },
      },
      take: 80,
    });

    const recentExecs = await prisma.crmFlowExecution.findMany({
      where: {
        crmFlowId: flow.id,
        triggerType: "contact_no_reply",
        startedAt: { gte: threshold },
      },
      select: { triggerPayload: true },
      take: 200,
    });
    const firedConversationIds = new Set(
      recentExecs
        .map((e) => (e.triggerPayload as { conversationId?: string } | null)?.conversationId)
        .filter(Boolean) as string[],
    );

    for (const conv of conversations) {
      if (firedConversationIds.has(conv.id)) continue;

      const last = conv.messages[0];
      if (!last || last.direction !== "OUTBOUND") continue;
      if (last.createdAt > threshold) continue;

      const lastInbound = await prisma.message.findFirst({
        where: {
          conversationId: conv.id,
          direction: "INBOUND",
          isPrivate: false,
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (lastInbound && lastInbound.createdAt > last.createdAt) continue;

      fireCrmFlowTriggers(
        flow.organizationId,
        "contact_no_reply",
        {
          conversationId: conv.id,
          contactId: conv.contactId,
          inboxId: conv.inboxId,
          lastOutboundAt: last.createdAt.toISOString(),
          lastOutboundBody: last.body ?? "",
          noReplyHours: hours,
        },
        app.log,
      );
      firedConversationIds.add(conv.id);
    }
  }
}
