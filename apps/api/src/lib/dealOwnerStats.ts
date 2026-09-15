import { DealStatus, Prisma } from "@prisma/client";
import {
  DEAL_CATEGORY_CATALOG,
  getDealCategoryById,
  normalizeDealCategory,
  type ResolvedDealField,
} from "@openconduit/shared";
import { prisma } from "../db.js";
import {
  getActiveDealCategory,
  loadDealFieldConfig,
  loadOptionSetsForOrg,
} from "./dealCategories/dealCategoryService.js";

export type DealOwnerStatsFilter = {
  organizationId: string;
  from: Date;
  to: Date;
  category?: string | null;
  ownerId?: string | null;
  dealType?: string | null;
};

export type DealOwnerSummaryRow = {
  ownerId: string | null;
  ownerName: string;
  wonAmountCents: number;
  openAmountCents: number;
  lostAmountCents: number;
  wonCount: number;
  openCount: number;
  lostCount: number;
  dealCount: number;
};

export type DealFieldStatRow = {
  fieldKey: string;
  labelPt: string;
  labelEn: string;
  type: string;
  kind: "select" | "numeric" | "text" | "boolean";
  options?: Array<{ value: string; label: string; count: number }>;
  numeric?: { sum: number; avg: number; count: number; unit?: "cents" | "number" };
  filledCount?: number;
};

export type DealProductStatRow = {
  productId: string | null;
  productName: string;
  count: number;
  totalCents: number;
};

export type DealOwnerStatsDealRow = {
  id: string;
  name: string;
  status: DealStatus;
  amountCents: number;
  currency: string;
  categoryData: Record<string, unknown> | null;
  createdAt: string;
  primaryContact: { id: string; name: string } | null;
};

export type DealOwnerStatsPayload = {
  activeCategory: string;
  categoryLabelPt: string;
  categoryLabelEn: string;
  from: string;
  to: string;
  filterCategory: string | null;
  filterOwnerId: string | null;
  summary: {
    wonAmountCents: number;
    openAmountCents: number;
    lostAmountCents: number;
    wonCount: number;
    openCount: number;
    lostCount: number;
    dealCount: number;
  };
  byOwner: DealOwnerSummaryRow[];
  fieldStats: DealFieldStatRow[];
  productStats: DealProductStatRow[];
  recentDeals: DealOwnerStatsDealRow[];
};

function categoryWhere(filter: DealOwnerStatsFilter): Prisma.DealWhereInput {
  const base: Prisma.DealWhereInput = {
    organizationId: filter.organizationId,
    createdAt: { gte: filter.from, lte: filter.to },
  };

  const category = filter.category ?? null;
  if (category) {
    const cat = normalizeDealCategory(category);
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

  if (filter.ownerId) {
    base.ownerId = filter.ownerId;
  }

  return base;
}

function emptySummary(): DealOwnerStatsPayload["summary"] {
  return {
    wonAmountCents: 0,
    openAmountCents: 0,
    lostAmountCents: 0,
    wonCount: 0,
    openCount: 0,
    lostCount: 0,
    dealCount: 0,
  };
}

function addToSummary(
  summary: DealOwnerStatsPayload["summary"],
  status: DealStatus,
  amountCents: number,
): void {
  summary.dealCount += 1;
  if (status === DealStatus.WON) {
    summary.wonAmountCents += amountCents;
    summary.wonCount += 1;
  } else if (status === DealStatus.OPEN) {
    summary.openAmountCents += amountCents;
    summary.openCount += 1;
  } else if (status === DealStatus.LOST) {
    summary.lostAmountCents += amountCents;
    summary.lostCount += 1;
  }
}

function resolveSelectLabel(
  field: ResolvedDealField,
  raw: unknown,
  optionNameById: Map<string, string>,
  catDef: ReturnType<typeof getDealCategoryById>,
): string {
  if (raw == null || raw === "") return "—";
  const str = String(raw);
  if (field.key === "dealType" && catDef.dealTypes?.length) {
    const dt = catDef.dealTypes.find((d) => d.key === str);
    return dt?.labelPt ?? str;
  }
  if (field.type === "select" && field.optionSetKey) {
    return optionNameById.get(str) ?? str;
  }
  return str;
}

function buildFieldStats(
  deals: Array<{ categoryData: unknown }>,
  fields: ResolvedDealField[],
  optionNameById: Map<string, string>,
  categoryKey: string,
): DealFieldStatRow[] {
  const catDef = getDealCategoryById(categoryKey);
  const stats: DealFieldStatRow[] = [];

  for (const field of fields) {
    if (field.enabled === false) continue;

    if (field.key === "dealType" || field.type === "select") {
      const counts = new Map<string, number>();
      for (const deal of deals) {
        const data =
          deal.categoryData && typeof deal.categoryData === "object"
            ? (deal.categoryData as Record<string, unknown>)
            : {};
        const raw = data[field.key];
        if (raw == null || raw === "") continue;
        const label = resolveSelectLabel(field, raw, optionNameById, catDef);
        const key = String(raw);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const options = [...counts.entries()]
        .map(([value, count]) => ({
          value,
          label: resolveSelectLabel(field, value, optionNameById, catDef),
          count,
        }))
        .sort((a, b) => b.count - a.count);
      if (options.length > 0) {
        stats.push({
          fieldKey: field.key,
          labelPt: field.labelPt,
          labelEn: field.labelEn,
          type: field.type,
          kind: "select",
          options,
          filledCount: options.reduce((s, o) => s + o.count, 0),
        });
      }
      continue;
    }

    if (field.type === "money" || field.type === "number" || field.type === "percentage") {
      const values: number[] = [];
      for (const deal of deals) {
        const data =
          deal.categoryData && typeof deal.categoryData === "object"
            ? (deal.categoryData as Record<string, unknown>)
            : {};
        const raw = data[field.key];
        const n = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(n)) values.push(n);
      }
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        stats.push({
          fieldKey: field.key,
          labelPt: field.labelPt,
          labelEn: field.labelEn,
          type: field.type,
          kind: "numeric",
          numeric: {
            sum,
            avg: sum / values.length,
            count: values.length,
            unit: field.type === "money" ? "cents" : "number",
          },
          filledCount: values.length,
        });
      }
      continue;
    }

    if (field.type === "boolean") {
      let trueCount = 0;
      let falseCount = 0;
      for (const deal of deals) {
        const data =
          deal.categoryData && typeof deal.categoryData === "object"
            ? (deal.categoryData as Record<string, unknown>)
            : {};
        const raw = data[field.key];
        if (raw === true) trueCount += 1;
        else if (raw === false) falseCount += 1;
      }
      const options: Array<{ value: string; label: string; count: number }> = [];
      if (trueCount > 0) options.push({ value: "true", label: "Sim", count: trueCount });
      if (falseCount > 0) options.push({ value: "false", label: "Não", count: falseCount });
      if (options.length > 0) {
        stats.push({
          fieldKey: field.key,
          labelPt: field.labelPt,
          labelEn: field.labelEn,
          type: field.type,
          kind: "boolean",
          options,
          filledCount: trueCount + falseCount,
        });
      }
      continue;
    }

    let filled = 0;
    for (const deal of deals) {
      const data =
        deal.categoryData && typeof deal.categoryData === "object"
          ? (deal.categoryData as Record<string, unknown>)
          : {};
      const raw = data[field.key];
      if (raw != null && String(raw).trim() !== "") filled += 1;
    }
    if (filled > 0) {
      stats.push({
        fieldKey: field.key,
        labelPt: field.labelPt,
        labelEn: field.labelEn,
        type: field.type,
        kind: "text",
        filledCount: filled,
      });
    }
  }

  return stats.sort((a, b) => (b.filledCount ?? 0) - (a.filledCount ?? 0));
}

function buildProductStats(
  lineItems: Array<{
    quantity: number;
    unitPriceCents: number;
    discountPct: number;
    product: { id: string; name: string } | null;
    description: string;
  }>,
): DealProductStatRow[] {
  const map = new Map<string, DealProductStatRow>();
  for (const item of lineItems) {
    const factor = Math.max(0, 1 - item.discountPct / 100);
    const lineTotal = Math.round(item.quantity * item.unitPriceCents * factor);
    const productId = item.product?.id ?? null;
    const key = productId ?? `__desc__:${item.description}`;
    const productName = item.product?.name ?? item.description;
    const cur = map.get(key) ?? { productId, productName, count: 0, totalCents: 0 };
    cur.count += item.quantity;
    cur.totalCents += lineTotal;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export async function buildDealOwnerStats(filter: DealOwnerStatsFilter): Promise<DealOwnerStatsPayload> {
  const where = categoryWhere(filter);
  const activeCategory = normalizeDealCategory(filter.category ?? (await getActiveDealCategory(filter.organizationId)));
  const catDef = getDealCategoryById(activeCategory);
  const catalogEntry = DEAL_CATEGORY_CATALOG.find((c) => c.id === activeCategory);

  const [ownerAgg, deals, fields, optionSets] = await Promise.all([
    prisma.deal.groupBy({
      by: ["ownerId", "status"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    filter.ownerId
      ? prisma.deal.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            id: true,
            name: true,
            status: true,
            amountCents: true,
            currency: true,
            category: true,
            categoryData: true,
            createdAt: true,
            primaryContact: { select: { id: true, name: true } },
            lineItems: {
              select: {
                quantity: true,
                unitPriceCents: true,
                discountPct: true,
                description: true,
                product: { select: { id: true, name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    loadDealFieldConfig(filter.organizationId, activeCategory),
    loadOptionSetsForOrg(filter.organizationId),
  ]);

  const optionNameById = new Map<string, string>();
  for (const set of optionSets) {
    for (const opt of set.options) {
      optionNameById.set(opt.id, opt.name);
    }
  }

  const ownerIds = [...new Set(ownerAgg.map((r) => r.ownerId).filter((id): id is string => id != null))];
  const owners =
    ownerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        })
      : [];
  const ownerNameById = new Map(owners.map((u) => [u.id, u.name]));

  const ownerMap = new Map<string | null, DealOwnerSummaryRow>();
  const summary = emptySummary();

  for (const row of ownerAgg) {
    const amt = row._sum.amountCents ?? 0;
    const count = row._count._all;
    addToSummary(summary, row.status, amt);

    const key = row.ownerId;
    const cur =
      ownerMap.get(key) ??
      ({
        ownerId: key,
        ownerName: key ? (ownerNameById.get(key) ?? "—") : "Sem responsável",
        wonAmountCents: 0,
        openAmountCents: 0,
        lostAmountCents: 0,
        wonCount: 0,
        openCount: 0,
        lostCount: 0,
        dealCount: 0,
      } satisfies DealOwnerSummaryRow);

    cur.dealCount += count;
    if (row.status === DealStatus.WON) {
      cur.wonAmountCents += amt;
      cur.wonCount += count;
    } else if (row.status === DealStatus.OPEN) {
      cur.openAmountCents += amt;
      cur.openCount += count;
    } else if (row.status === DealStatus.LOST) {
      cur.lostAmountCents += amt;
      cur.lostCount += count;
    }
    ownerMap.set(key, cur);
  }

  const byOwner = [...ownerMap.values()].sort((a, b) => b.wonAmountCents - a.wonAmountCents);

  const statsCategory = filter.category
    ? normalizeDealCategory(filter.category)
    : activeCategory;
  const dealsForFieldStats = deals.filter((d) => {
    const dealCat = d.category ? normalizeDealCategory(String(d.category)) : "default";
    return dealCat === statsCategory;
  });
  const allLineItems = deals.flatMap((d) => d.lineItems);
  const fieldStats =
    filter.ownerId && dealsForFieldStats.length > 0
      ? buildFieldStats(dealsForFieldStats, fields, optionNameById, statsCategory)
      : [];
  const productStats = filter.ownerId ? buildProductStats(allLineItems) : [];

  const recentDeals: DealOwnerStatsDealRow[] = deals.map((d) => ({
    id: d.id,
    name: d.name,
    status: d.status,
    amountCents: d.amountCents,
    currency: d.currency,
    categoryData:
      d.categoryData && typeof d.categoryData === "object" ? (d.categoryData as Record<string, unknown>) : null,
    createdAt: d.createdAt.toISOString(),
    primaryContact: d.primaryContact,
  }));

  return {
    activeCategory,
    categoryLabelPt: catalogEntry?.labelPt ?? catDef.labelPt,
    categoryLabelEn: catalogEntry?.labelEn ?? catDef.labelEn,
    from: filter.from.toISOString(),
    to: filter.to.toISOString(),
    filterCategory: filter.category ? normalizeDealCategory(filter.category) : null,
    filterOwnerId: filter.ownerId ?? null,
    summary,
    byOwner,
    fieldStats,
    productStats,
    recentDeals,
  };
}
