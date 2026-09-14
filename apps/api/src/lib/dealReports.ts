import { DealStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { normalizeDealCategory, DEAL_CATEGORY_CATALOG } from "@openconduit/shared";

export type DealReportsFilter = {
  organizationId: string;
  from: Date;
  to: Date;
  category?: string | null;
  dealType?: string | null;
};

export type DealReportsPayload = {
  enabled: true;
  filterCategory: string | null;
  filterDealType: string | null;
  activeCategory: string;
  catalog: Array<{ id: string; labelPt: string; labelEn: string }>;
  summary: {
    wonAmountCents: number;
    openAmountCents: number;
    lostAmountCents: number;
    dealCount: number;
  };
  byCategory: Array<{
    categoryKey: string;
    wonAmountCents: number;
    openAmountCents: number;
    lostAmountCents: number;
    dealCount: number;
  }>;
  linkedToConversations: {
    dealCount: number;
    wonAmountCents: number;
    openAmountCents: number;
    closureValueSum: number;
  };
};

function categoryWhere(filter: DealReportsFilter): Prisma.DealWhereInput {
  const base: Prisma.DealWhereInput = {
    organizationId: filter.organizationId,
    createdAt: { gte: filter.from, lte: filter.to },
  };

  if (filter.category) {
    const cat = normalizeDealCategory(filter.category);
    if (cat === "default") {
      base.OR = [{ category: null }, { category: "default" }];
    } else {
      base.category = cat;
    }
  }

  if (filter.dealType) {
    base.categoryData = {
      path: ["dealType"],
      equals: filter.dealType,
    };
  }

  return base;
}

function sumByStatus(
  rows: Array<{ status: DealStatus; _sum: { amountCents: number | null }; _count: { _all: number } }>,
) {
  let wonAmountCents = 0;
  let openAmountCents = 0;
  let lostAmountCents = 0;
  let dealCount = 0;
  for (const r of rows) {
    const amt = r._sum.amountCents ?? 0;
    dealCount += r._count._all;
    if (r.status === DealStatus.WON) wonAmountCents += amt;
    else if (r.status === DealStatus.OPEN) openAmountCents += amt;
    else if (r.status === DealStatus.LOST) lostAmountCents += amt;
  }
  return { wonAmountCents, openAmountCents, lostAmountCents, dealCount };
}

export async function buildDealReports(filter: DealReportsFilter): Promise<DealReportsPayload> {
  const where = categoryWhere(filter);

  const linkedWhere: Prisma.DealWhereInput = {
    ...where,
    sourceConversationId: { not: null },
  };

  const [statusAgg, categoryAgg, linkedDeals, settings] = await Promise.all([
    prisma.deal.groupBy({
      by: ["status"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.deal.groupBy({
      by: ["category", "status"],
      where: {
        organizationId: filter.organizationId,
        createdAt: { gte: filter.from, lte: filter.to },
        ...(filter.dealType
          ? { categoryData: { path: ["dealType"], equals: filter.dealType } }
          : {}),
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.deal.findMany({
      where: linkedWhere,
      select: {
        status: true,
        amountCents: true,
        sourceConversationId: true,
      },
    }),
    prisma.dealOrgSettings.findUnique({ where: { organizationId: filter.organizationId } }),
  ]);

  const summary = sumByStatus(statusAgg);

  const catMap = new Map<
    string,
    { wonAmountCents: number; openAmountCents: number; lostAmountCents: number; dealCount: number }
  >();

  for (const row of categoryAgg) {
    const key = row.category ? normalizeDealCategory(row.category) : "default";
    const cur = catMap.get(key) ?? {
      wonAmountCents: 0,
      openAmountCents: 0,
      lostAmountCents: 0,
      dealCount: 0,
    };
    const amt = row._sum.amountCents ?? 0;
    cur.dealCount += row._count._all;
    if (row.status === DealStatus.WON) cur.wonAmountCents += amt;
    else if (row.status === DealStatus.OPEN) cur.openAmountCents += amt;
    else if (row.status === DealStatus.LOST) cur.lostAmountCents += amt;
    catMap.set(key, cur);
  }

  const byCategory = [...catMap.entries()]
    .map(([categoryKey, v]) => ({ categoryKey, ...v }))
    .sort((a, b) => b.dealCount - a.dealCount);

  const convIds = [
    ...new Set(linkedDeals.map((d) => d.sourceConversationId).filter((id): id is string => id != null)),
  ];
  const convRows =
    convIds.length > 0
      ? await prisma.conversation.findMany({
          where: { id: { in: convIds }, organizationId: filter.organizationId },
          select: { closureValue: true },
        })
      : [];

  let linkedWon = 0;
  let linkedOpen = 0;
  for (const d of linkedDeals) {
    if (d.status === DealStatus.WON) linkedWon += d.amountCents;
    else if (d.status === DealStatus.OPEN) linkedOpen += d.amountCents;
  }
  const closureValueSum = convRows.reduce((acc, c) => acc + (c.closureValue ?? 0), 0);

  return {
    enabled: true,
    filterCategory: filter.category ? normalizeDealCategory(filter.category) : null,
    filterDealType: filter.dealType ?? null,
    activeCategory: normalizeDealCategory(settings?.activeCategory ?? "default"),
    catalog: DEAL_CATEGORY_CATALOG.map((c) => ({
      id: c.id,
      labelPt: c.labelPt,
      labelEn: c.labelEn,
    })),
    summary,
    byCategory,
    linkedToConversations: {
      dealCount: linkedDeals.length,
      wonAmountCents: linkedWon,
      openAmountCents: linkedOpen,
      closureValueSum,
    },
  };
}
