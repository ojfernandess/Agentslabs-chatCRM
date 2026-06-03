import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  assignAbVariant,
  listBroadcastAudienceContactIdsAdvanced,
} from "./broadcastSegmentation.js";
import { parseAbConfig, parseSegmentRules } from "./broadcastTypes.js";
import { scheduleBroadcastCampaignRun } from "./broadcastRunner.js";

const RECIPIENT_BATCH_SIZE = 500;

async function createRecipientsBatched(
  tx: Prisma.TransactionClient,
  campaignId: string,
  contactIds: string[],
  splitA: number,
  abEnabled: boolean,
): Promise<void> {
  for (let i = 0; i < contactIds.length; i += RECIPIENT_BATCH_SIZE) {
    const slice = contactIds.slice(i, i + RECIPIENT_BATCH_SIZE);
    await tx.broadcastCampaignRecipient.createMany({
      data: slice.map((contactId, idx) => ({
        campaignId,
        contactId,
        abVariant: abEnabled ? assignAbVariant(i + idx, splitA) : null,
      })),
      skipDuplicates: true,
    });
  }
}

export async function materializeAndStartCampaign(
  app: FastifyInstance,
  organizationId: string,
  campaignId: string,
): Promise<Awaited<ReturnType<typeof prisma.broadcastCampaign.update>>> {
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { tags: true },
  });
  if (!campaign) throw new Error("not_found");
  if (campaign.status !== "DRAFT") throw new Error("invalid_status");
  if (campaign.pausedAt) throw new Error("campaign_paused");

  if (campaign.requiresApproval && campaign.approvalStatus !== "APPROVED") {
    throw new Error("approval_required");
  }

  const dueTypes = new Set(["SCHEDULED", "RECURRING"]);
  if (dueTypes.has(campaign.scheduleType) && campaign.nextRunAt && campaign.nextRunAt > new Date()) {
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
  const abEnabled = Boolean(ab?.enabled);

  let started: Awaited<ReturnType<typeof prisma.broadcastCampaign.update>> | undefined;

  await prisma.$transaction(
    async (tx) => {
      const locked = await tx.broadcastCampaign.findFirst({
        where: { id: campaignId, organizationId, status: "DRAFT" },
      });
      if (!locked) throw new Error("invalid_status");

      await tx.broadcastCampaignRecipient.deleteMany({ where: { campaignId } });
      await createRecipientsBatched(tx, campaignId, contactIds, splitA, abEnabled);

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
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  if (!started) throw new Error("start_failed");
  scheduleBroadcastCampaignRun(app, campaignId);
  return started;
}
