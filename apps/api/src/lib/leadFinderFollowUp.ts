import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { materializeAndStartCampaign } from "./broadcastCampaignStart.js";
import { parseSegmentRules } from "./broadcastTypes.js";
import { computeNextRunAt, parseFollowUpRecurrence } from "./broadcastRecurrence.js";

export interface LeadFinderFollowUpInput {
  tagIds: string[];
  name: string;
  inboxId: string;
  messageType: "TEXT" | "TEMPLATE";
  body?: string;
  templateId?: string;
  scheduleType: "IMMEDIATE" | "SCHEDULED" | "RECURRING";
  scheduledAt?: string;
  segmentRules?: Record<string, unknown>;
  cronExpression?: string;
  autoStart?: boolean;
  createdById: string;
}

export async function createLeadFinderFollowUp(
  app: FastifyInstance,
  organizationId: string,
  input: LeadFinderFollowUpInput,
): Promise<{ campaignId: string; started: boolean; startError: string | null }> {
  const inbox = await prisma.inbox.findFirst({ where: { id: input.inboxId, organizationId } });
  if (!inbox) throw new Error("Invalid inboxId");

  const tagCount = await prisma.tag.count({ where: { organizationId, id: { in: input.tagIds } } });
  if (tagCount !== input.tagIds.length) throw new Error("Invalid tagIds");

  const segmentRules = {
    tagLogic: "ANY" as const,
    campaignKind: "followup" as const,
    ...(parseSegmentRules(input.segmentRules) ?? {}),
  };

  let scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  let cronExpression = input.cronExpression ?? null;
  let nextRunAt: Date | null = null;

  if (input.scheduleType === "SCHEDULED" && scheduledAt) {
    nextRunAt = scheduledAt;
  } else if (input.scheduleType === "RECURRING") {
    const recurrence = parseFollowUpRecurrence(segmentRules);
    if (recurrence) {
      nextRunAt = computeNextRunAt(new Date(), recurrence);
      scheduledAt = scheduledAt ?? nextRunAt;
    }
  }

  const campaign = await prisma.broadcastCampaign.create({
    data: {
      organizationId,
      name: input.name,
      channel: "WHATSAPP",
      inboxId: input.inboxId,
      messageType: input.messageType,
      body: input.messageType === "TEXT" ? input.body?.trim() : null,
      templateId: input.messageType === "TEMPLATE" ? input.templateId : null,
      segmentRules: segmentRules as object,
      scheduleType: input.scheduleType,
      scheduledAt,
      cronExpression,
      nextRunAt,
      status: "DRAFT",
      createdById: input.createdById,
      tags: { create: input.tagIds.map((tagId) => ({ tagId })) },
    },
  });

  let started = false;
  let startError: string | null = null;
  if (input.autoStart === true && input.scheduleType === "IMMEDIATE") {
    try {
      await materializeAndStartCampaign(app, organizationId, campaign.id);
      started = true;
    } catch (err) {
      startError = err instanceof Error ? err.message : "Start failed";
    }
  }

  return { campaignId: campaign.id, started, startError };
}
