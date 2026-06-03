import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { deliverBroadcastToContact, resolvePayloadForRecipient } from "./broadcastChannelDelivery.js";
import { runPreSendFlowSteps } from "./broadcastFlowExecutor.js";
import { syncBroadcastCampaignEngagement } from "./broadcastMetrics.js";
import { finalizeBroadcastCampaignIfDone } from "./broadcastRunner.js";

export async function processBroadcastRecipient(
  app: FastifyInstance,
  campaignId: string,
  recipientId: string,
): Promise<void> {
  const rec = await prisma.broadcastCampaignRecipient.findFirst({
    where: { id: recipientId, campaignId, status: "PENDING" },
    include: { contact: true, campaign: true },
  });
  if (!rec) return;

  const campaign = rec.campaign;
  if (campaign.status !== "RUNNING" || campaign.pausedAt) return;

  const { skipSend } = await runPreSendFlowSteps({ campaign, contactId: rec.contactId });
  if (skipSend) {
    await prisma.broadcastCampaignRecipient.update({
      where: { id: rec.id },
      data: { status: "FAILED", error: "Skipped by flow condition" },
    });
    await incrementFailed(campaignId);
    await finalizeBroadcastCampaignIfDone(campaignId);
    return;
  }

  const payload = resolvePayloadForRecipient(campaign, rec.abVariant);

  try {
    await deliverBroadcastToContact({
      campaign,
      contact: rec.contact,
      payload,
      actorUserId: campaign.createdById,
      log: app.log,
    });
    await prisma.broadcastCampaignRecipient.update({
      where: { id: rec.id },
      data: { status: "SENT", sentAt: new Date(), error: null },
    });
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: 1 } },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.broadcastCampaignRecipient.update({
      where: { id: rec.id },
      data: { status: "FAILED", error: msg },
    });
    await incrementFailed(campaignId);
  }

  await finalizeBroadcastCampaignIfDone(campaignId);
  void syncBroadcastCampaignEngagement(campaignId).catch((e) =>
    app.log.warn({ err: e, campaignId }, "sync broadcast metrics failed"),
  );
}

async function incrementFailed(campaignId: string): Promise<void> {
  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: { failedCount: { increment: 1 } },
  });
}
