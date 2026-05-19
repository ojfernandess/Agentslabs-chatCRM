import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { materializeAndStartCampaign } from "./broadcastCampaignStart.js";

/** Campanhas agendadas / recorrentes com nextRunAt vencido. */
export async function runBroadcastSchedulerTick(app: FastifyInstance): Promise<void> {
  const now = new Date();

  const due = await prisma.broadcastCampaign.findMany({
    where: {
      status: "DRAFT",
      scheduleType: { in: ["SCHEDULED", "RECURRING"] },
      nextRunAt: { lte: now },
      OR: [{ requiresApproval: false }, { approvalStatus: "APPROVED" }],
    },
    take: 10,
  });

  for (const campaign of due) {
    try {
      await materializeAndStartCampaign(app, campaign.organizationId, campaign.id);
    } catch (err) {
      app.log.error({ err, campaignId: campaign.id }, "scheduled campaign start failed");
    }
  }
}

export async function triggerEventCampaigns(
  app: FastifyInstance,
  organizationId: string,
  eventTrigger: string,
  eventPayload: Record<string, unknown>,
): Promise<void> {
  const campaigns = await prisma.broadcastCampaign.findMany({
    where: {
      organizationId,
      scheduleType: "EVENT",
      eventTrigger,
      status: "DRAFT",
      OR: [{ requiresApproval: false }, { approvalStatus: "APPROVED" }],
    },
    take: 5,
  });

  for (const c of campaigns) {
    const cfg = (c.eventConfig ?? {}) as Record<string, unknown>;
    if (cfg.pipelineStageId && eventPayload.pipelineStageId !== cfg.pipelineStageId) continue;
    if (cfg.tagId && eventPayload.tagId !== cfg.tagId) continue;
    try {
      await materializeAndStartCampaign(app, organizationId, c.id);
    } catch (err) {
      app.log.warn({ err, campaignId: c.id }, "event campaign trigger failed");
    }
  }
}
