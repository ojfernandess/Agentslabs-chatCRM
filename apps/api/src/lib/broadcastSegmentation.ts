import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { assertTagsBelongToOrganization } from "./broadcastAudience.js";
import { segmentHasAudienceFilters, type BroadcastSegmentRules } from "./broadcastTypes.js";

export function buildSegmentWhere(
  organizationId: string,
  tagIds: string[],
  segmentRules: BroadcastSegmentRules | null,
): Prisma.ContactWhereInput {
  const rules = segmentRules ?? {};
  const effectiveTagIds = rules.tagIds?.length ? rules.tagIds : tagIds;
  const tagLogic = rules.tagLogic ?? "ANY";

  const where: Prisma.ContactWhereInput = {
    organizationId,
    isGroupChat: false,
  };

  if (effectiveTagIds.length > 0) {
    if (tagLogic === "ALL") {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        ...effectiveTagIds.map((tagId) => ({ tags: { some: { tagId } } })),
      ];
    } else {
      where.tags = { some: { tagId: { in: effectiveTagIds } } };
    }
  }

  if (rules.pipelineStageIds?.length) {
    where.pipelineStageId = { in: rules.pipelineStageIds };
  }

  if (rules.lifecycleStages?.length) {
    where.lifecycleStage = { in: rules.lifecycleStages };
  }

  if (rules.optedInOnly) {
    where.optedIn = true;
  }

  if (rules.cities?.length) {
    where.OR = rules.cities.flatMap((city) => [
      { account: { is: { metadata: { path: ["city"], equals: city } } } },
      { account: { is: { metadata: { path: ["cidade"], equals: city } } } },
    ]);
  }

  if (rules.minDealValue != null && rules.minDealValue > 0) {
    const minCents = Math.round(rules.minDealValue * 100);
    where.dealsPrimary = { some: { amountCents: { gte: minCents } } };
  }

  return where;
}

export async function validateSegmentInput(
  organizationId: string,
  tagIds: string[],
  segmentRules: BroadcastSegmentRules | null,
): Promise<void> {
  const rules = segmentRules ?? {};
  if (rules.contactIds?.length) return;
  const effectiveTagIds = rules.tagIds?.length ? rules.tagIds : tagIds;
  if (effectiveTagIds.length > 0) {
    await assertTagsBelongToOrganization(organizationId, effectiveTagIds);
  } else if (!segmentHasAudienceFilters([], rules)) {
    throw new Error("At least one tag or segment filter is required");
  }
}

export async function countBroadcastAudienceAdvanced(
  organizationId: string,
  tagIds: string[],
  segmentRules: BroadcastSegmentRules | null,
): Promise<number> {
  if (segmentRules?.contactIds?.length) {
    const ids = await listBroadcastAudienceContactIdsAdvanced(organizationId, tagIds, segmentRules);
    return ids.length;
  }
  await validateSegmentInput(organizationId, tagIds, segmentRules);
  const where = buildSegmentWhere(organizationId, tagIds, segmentRules);

  if (segmentRules?.noResponseSinceDays != null && segmentRules.noResponseSinceDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - segmentRules.noResponseSinceDays);
    const ids = await listBroadcastAudienceContactIdsAdvanced(organizationId, tagIds, segmentRules);
    if (ids.length === 0) return 0;
    let count = 0;
    for (const contactId of ids) {
      const lastInbound = await prisma.message.findFirst({
        where: {
          direction: "INBOUND",
          conversation: { contactId, organizationId },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!lastInbound || lastInbound.createdAt < since) count += 1;
    }
    return count;
  }

  return prisma.contact.count({ where });
}

export async function listBroadcastAudienceContactIdsAdvanced(
  organizationId: string,
  tagIds: string[],
  segmentRules: BroadcastSegmentRules | null,
): Promise<string[]> {
  if (segmentRules?.contactIds?.length) {
    const ids = [...new Set(segmentRules.contactIds)];
    const rows = await prisma.contact.findMany({
      where: { organizationId, id: { in: ids }, isGroupChat: false },
      select: { id: true },
    });
    const found = new Set(rows.map((r) => r.id));
    return ids.filter((id) => found.has(id));
  }
  await validateSegmentInput(organizationId, tagIds, segmentRules);
  const where = buildSegmentWhere(organizationId, tagIds, segmentRules);
  const rows = await prisma.contact.findMany({ where, select: { id: true } });

  if (segmentRules?.noResponseSinceDays != null && segmentRules.noResponseSinceDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - segmentRules.noResponseSinceDays);
    const filtered: string[] = [];
    for (const row of rows) {
      const lastInbound = await prisma.message.findFirst({
        where: {
          direction: "INBOUND",
          conversation: { contactId: row.id, organizationId },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!lastInbound || lastInbound.createdAt < since) filtered.push(row.id);
    }
    return filtered;
  }

  return rows.map((r) => r.id);
}

export function assignAbVariant(contactIndex: number, splitPercentA: number): "A" | "B" {
  return contactIndex % 100 < splitPercentA ? "A" : "B";
}
