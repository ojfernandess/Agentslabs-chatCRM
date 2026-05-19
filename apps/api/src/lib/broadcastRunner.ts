import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { enqueueBroadcastRecipientJob, isBroadcastQueueAvailable } from "./broadcastQueue.js";
import { processBroadcastRecipient } from "./broadcastRecipientProcessor.js";
import { syncBroadcastCampaignEngagement } from "./broadcastMetrics.js";

export function scheduleBroadcastCampaignRun(app: FastifyInstance, campaignId: string): void {
  void runBroadcastCampaign(app, campaignId).catch((err) => {
    app.log.error({ err, campaignId }, "broadcast campaign runner error");
  });
}

export async function finalizeBroadcastCampaignIfDone(campaignId: string): Promise<void> {
  const pending = await prisma.broadcastCampaignRecipient.count({
    where: { campaignId, status: "PENDING" },
  });
  if (pending > 0) return;

  const campaign = await prisma.broadcastCampaign.findUnique({
    where: { id: campaignId },
    select: { status: true, scheduleType: true },
  });
  if (!campaign || campaign.status !== "RUNNING") return;

  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  if (campaign.scheduleType === "RECURRING") {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    await prisma.broadcastCampaignRecipient.deleteMany({ where: { campaignId } });
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: {
        status: "DRAFT",
        nextRunAt: next,
        sentCount: 0,
        failedCount: 0,
        totalRecipients: 0,
        startedAt: null,
        completedAt: null,
      },
    });
  }
}

export async function runBroadcastCampaign(app: FastifyInstance, campaignId: string): Promise<void> {
  const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "RUNNING") return;

  const pending = await prisma.broadcastCampaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) {
    await finalizeBroadcastCampaignIfDone(campaignId);
    return;
  }

  const throttleMs = Math.max(200, campaign.throttleMs ?? 750);
  const useQueue = campaign.useDistributedQueue && isBroadcastQueueAvailable();

  if (useQueue) {
    let delay = 0;
    for (const rec of pending) {
      const jobId = await enqueueBroadcastRecipientJob(campaignId, rec.id, delay);
      if (jobId) {
        await prisma.broadcastCampaignRecipient.update({
          where: { id: rec.id },
          data: { queueJobId: jobId },
        });
      } else {
        await processBroadcastRecipient(app, campaignId, rec.id);
      }
      delay += throttleMs;
    }
    return;
  }

  for (const rec of pending) {
    const state = await prisma.broadcastCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!state || state.status !== "RUNNING") return;

    await processBroadcastRecipient(app, campaignId, rec.id);
    await sleep(throttleMs);
  }

  await finalizeBroadcastCampaignIfDone(campaignId);
  await syncBroadcastCampaignEngagement(campaignId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
