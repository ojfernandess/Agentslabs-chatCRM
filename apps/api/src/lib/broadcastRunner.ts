import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import type { SendMessageInput } from "./messagePayload.js";

/** Espaçamento entre envios para reduzir risco de limitação pelo WhatsApp. */
const THROTTLE_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function scheduleBroadcastCampaignRun(app: FastifyInstance, campaignId: string): void {
  void runBroadcastCampaign(app, campaignId).catch((err) => {
    app.log.error({ err, campaignId }, "broadcast campaign runner error");
  });
}

export async function runBroadcastCampaign(app: FastifyInstance, campaignId: string): Promise<void> {
  const campaign = await prisma.broadcastCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign || campaign.status !== "RUNNING") return;

  const pending = await prisma.broadcastCampaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) {
    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return;
  }

  let sent = campaign.sentCount;
  let failed = campaign.failedCount;

  for (const rec of pending) {
    const state = await prisma.broadcastCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!state || state.status !== "RUNNING") return;

    let payload: SendMessageInput;
    if (campaign.messageType === "TEMPLATE") {
      if (!campaign.templateId) {
        await prisma.broadcastCampaignRecipient.update({
          where: { id: rec.id },
          data: { status: "FAILED", error: "Campaign missing templateId" },
        });
        failed += 1;
        await prisma.broadcastCampaign.update({
          where: { id: campaignId },
          data: { sentCount: sent, failedCount: failed },
        });
        await sleep(THROTTLE_MS);
        continue;
      }
      payload = {
        contactId: rec.contactId,
        type: "TEMPLATE",
        templateId: campaign.templateId,
      };
    } else {
      payload = {
        contactId: rec.contactId,
        type: "TEXT",
        body: campaign.body ?? "",
      };
    }

    try {
      await deliverOutboundWhatsAppMessage({
        organizationId: campaign.organizationId,
        data: payload,
        actor: { kind: "user", userId: campaign.createdById },
        log: app.log,
        newConversation: { status: "OPEN", assignedToId: campaign.createdById },
      });
      await prisma.broadcastCampaignRecipient.update({
        where: { id: rec.id },
        data: { status: "SENT", sentAt: new Date(), error: null },
      });
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.broadcastCampaignRecipient.update({
        where: { id: rec.id },
        data: { status: "FAILED", error: msg },
      });
      failed += 1;
    }

    await prisma.broadcastCampaign.update({
      where: { id: campaignId },
      data: { sentCount: sent, failedCount: failed },
    });

    await sleep(THROTTLE_MS);
  }

  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      sentCount: sent,
      failedCount: failed,
    },
  });
}
