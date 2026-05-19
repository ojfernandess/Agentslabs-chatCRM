import { prisma } from "../db.js";
import { Prisma } from "@prisma/client";

export async function syncBroadcastCampaignEngagement(campaignId: string): Promise<void> {
  const campaign = await prisma.broadcastCampaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        where: { status: "SENT" },
        select: { id: true, contactId: true, sentAt: true, respondedAt: true, convertedAt: true },
      },
    },
  });
  if (!campaign) return;

  const since = campaign.startedAt ?? campaign.createdAt;
  let responseCount = 0;
  let conversionCount = 0;

  for (const rec of campaign.recipients) {
    const sentAt = rec.sentAt ?? since;

    const inbound = await prisma.message.findFirst({
      where: {
        direction: "INBOUND",
        createdAt: { gte: sentAt },
        conversation: { contactId: rec.contactId, organizationId: campaign.organizationId },
      },
      orderBy: { createdAt: "asc" },
    });

    if (inbound) {
      responseCount += 1;
      if (!rec.respondedAt) {
        await prisma.broadcastCampaignRecipient.update({
          where: { id: rec.id },
          data: { respondedAt: inbound.createdAt },
        });
      }
    }

    const wonDeal = await prisma.deal.findFirst({
      where: {
        organizationId: campaign.organizationId,
        primaryContactId: rec.contactId,
        status: "WON",
        updatedAt: { gte: sentAt },
      },
    });

    if (wonDeal) {
      conversionCount += 1;
      if (!rec.convertedAt) {
        await prisma.broadcastCampaignRecipient.update({
          where: { id: rec.id },
          data: { convertedAt: wonDeal.updatedAt },
        });
      }
    }
  }

  const revenuePer = campaign.revenuePerConversion
    ? Number(campaign.revenuePerConversion)
    : 0;
  const roiValue =
    revenuePer > 0 ? new Prisma.Decimal(conversionCount * revenuePer) : campaign.roiValue;

  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      responseCount,
      conversionCount,
      roiValue,
    },
  });
}

export function computeRates(sent: number, failed: number, responses: number, conversions: number) {
  const attempted = sent + failed;
  const deliveryRate = attempted > 0 ? Math.round((sent / attempted) * 1000) / 10 : null;
  const responseRate = sent > 0 ? Math.round((responses / sent) * 1000) / 10 : null;
  const conversionRate = sent > 0 ? Math.round((conversions / sent) * 1000) / 10 : null;
  return { deliveryRate, responseRate, conversionRate };
}
