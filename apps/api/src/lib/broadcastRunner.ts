import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { enqueueBroadcastRecipientJob, isBroadcastQueueAvailable } from "./broadcastQueue.js";
import { processBroadcastRecipient } from "./broadcastRecipientProcessor.js";
import { syncBroadcastCampaignEngagement } from "./broadcastMetrics.js";
import { computeNextRunAt, DEFAULT_FOLLOW_UP_TIME_ZONE } from "./broadcastRecurrence.js";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { parseSegmentRules } from "./broadcastTypes.js";

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
    select: { status: true, scheduleType: true, segmentRules: true, pausedAt: true },
  });
  if (!campaign || campaign.status !== "RUNNING") return;

  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  if (campaign.scheduleType === "RECURRING" && !campaign.pausedAt) {
    const rules = parseSegmentRules(campaign.segmentRules);
    const rec = rules?.followUpRecurrence;
    const next = rec ? computeNextRunAt(new Date(), rec) : fallbackRecurringNextRun();
    await prisma.broadcastCampaignRecipient.deleteMany({ where: { campaignId } });
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: {
        status: "DRAFT",
        nextRunAt: next,
        scheduledAt: next,
        sentCount: 0,
        failedCount: 0,
        totalRecipients: 0,
        startedAt: null,
        completedAt: null,
      },
    });
  }
}

function fallbackRecurringNextRun(): Date {
  const timeZone = DEFAULT_FOLLOW_UP_TIME_ZONE;
  const zNow = toZonedTime(new Date(), timeZone);
  const nextDay = new Date(zNow);
  nextDay.setDate(nextDay.getDate() + 1);
  return fromZonedTime(
    new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate(), 9, 0, 0, 0),
    timeZone,
  );
}

export async function runBroadcastCampaign(app: FastifyInstance, campaignId: string): Promise<void> {
  const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "RUNNING" || campaign.pausedAt) return;

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
    let queued = 0;
    for (const rec of pending) {
      const jobId = await enqueueBroadcastRecipientJob(campaignId, rec.id, delay);
      if (jobId) {
        queued += 1;
        await prisma.broadcastCampaignRecipient.update({
          where: { id: rec.id },
          data: { queueJobId: jobId },
        });
      } else {
        await processBroadcastRecipient(app, campaignId, rec.id);
        const state = await prisma.broadcastCampaign.findUnique({
          where: { id: campaignId },
          select: { status: true, pausedAt: true },
        });
        if (!state || state.status !== "RUNNING" || state.pausedAt) return;
      }
      delay += throttleMs;
    }
    if (queued > 0) return;
    await finalizeBroadcastCampaignIfDone(campaignId);
    await syncBroadcastCampaignEngagement(campaignId);
    return;
  }

  for (const rec of pending) {
    const state = await prisma.broadcastCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true, pausedAt: true },
    });
    if (!state || state.status !== "RUNNING" || state.pausedAt) return;

    await processBroadcastRecipient(app, campaignId, rec.id);
    await sleep(throttleMs);
  }

  await finalizeBroadcastCampaignIfDone(campaignId);
  await syncBroadcastCampaignEngagement(campaignId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
