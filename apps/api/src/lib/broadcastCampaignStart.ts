import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import {
  assignAbVariant,
  listBroadcastAudienceContactIdsAdvanced,
} from "./broadcastSegmentation.js";
import { parseAbConfig, parseSegmentRules } from "./broadcastTypes.js";
import { scheduleBroadcastCampaignRun } from "./broadcastRunner.js";

export async function materializeAndStartCampaign(
  app: FastifyInstance,
  organizationId: string,
  campaignId: string,
): Promise<Awaited<ReturnType<typeof prisma.broadcastCampaign.update>>> {
  let started: Awaited<ReturnType<typeof prisma.broadcastCampaign.update>> | undefined;

  await prisma.$transaction(async (tx) => {
    const campaign = await tx.broadcastCampaign.findFirst({
      where: { id: campaignId, organizationId },
      include: { tags: true },
    });
    if (!campaign) throw new Error("not_found");
    if (campaign.status !== "DRAFT") throw new Error("invalid_status");

    if (campaign.requiresApproval && campaign.approvalStatus !== "APPROVED") {
      throw new Error("approval_required");
    }

    if (campaign.scheduleType === "SCHEDULED" && campaign.scheduledAt && campaign.scheduledAt > new Date()) {
      throw new Error("not_scheduled_yet");
    }

    const tagIds = campaign.tags.map((t) => t.tagId);
    const segmentRules = parseSegmentRules(campaign.segmentRules);
    const contactIds = await listBroadcastAudienceContactIdsAdvanced(
      organizationId,
      tagIds,
      segmentRules,
    );
    if (contactIds.length === 0) throw new Error("no_recipients");

    const ab = parseAbConfig(campaign.abConfig);
    const splitA = ab?.enabled ? (ab.splitPercentA ?? 50) : 100;

    await tx.broadcastCampaignRecipient.deleteMany({ where: { campaignId } });
    await tx.broadcastCampaignRecipient.createMany({
      data: contactIds.map((contactId, idx) => ({
        campaignId,
        contactId,
        abVariant: ab?.enabled ? assignAbVariant(idx, splitA) : null,
      })),
    });

    started = await tx.broadcastCampaign.update({
      where: { id: campaignId },
      data: {
        status: "RUNNING",
        totalRecipients: contactIds.length,
        sentCount: 0,
        failedCount: 0,
        startedAt: new Date(),
        lastError: null,
      },
    });
  });

  if (!started) throw new Error("start_failed");
  scheduleBroadcastCampaignRun(app, campaignId);
  return started;
}
