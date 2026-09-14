import {
  DEAL_CATEGORY_CATALOG,
  getDealCategoryById,
  normalizeDealCategory,
  type DealFieldDef,
  validateCategoryData,
  resolveCategoryFields,
  type ResolvedDealField,
} from "@openconduit/shared";
import { prisma } from "../../db.js";

export async function getOrCreateDealOrgSettings(organizationId: string) {
  const existing = await prisma.dealOrgSettings.findUnique({ where: { organizationId } });
  if (existing) return existing;
  return prisma.dealOrgSettings.create({
    data: { organizationId, activeCategory: "default" },
  });
}

export async function getActiveDealCategory(organizationId: string): Promise<string> {
  const settings = await getOrCreateDealOrgSettings(organizationId);
  return normalizeDealCategory(settings.activeCategory);
}

/** Garante option sets sugeridos para a categoria activa. */
export async function ensureCategoryOptionSets(organizationId: string, categoryKey: string): Promise<void> {
  const cat = getDealCategoryById(categoryKey);
  if (!cat.optionSetTemplates?.length) return;

  for (const tpl of cat.optionSetTemplates) {
    const set = await prisma.dealOptionSet.upsert({
      where: { organizationId_setKey: { organizationId, setKey: tpl.setKey } },
      create: {
        organizationId,
        setKey: tpl.setKey,
        label: tpl.labelPt,
        categoryKey,
      },
      update: {},
    });

    const count = await prisma.dealOptionSetOption.count({ where: { optionSetId: set.id } });
    if (count > 0) continue;

    await prisma.dealOptionSetOption.createMany({
      data: tpl.suggestedOptions.map((name, i) => ({
        optionSetId: set.id,
        name,
        sortOrder: i,
        enabled: true,
      })),
    });
  }
}

export async function loadDealFieldConfig(
  organizationId: string,
  categoryKey: string,
): Promise<ResolvedDealField[]> {
  const catKey = normalizeDealCategory(categoryKey);
  const [overrides, customRows] = await Promise.all([
    prisma.dealFieldOverride.findMany({
      where: { organizationId, categoryKey: catKey },
    }),
    prisma.dealCustomField.findMany({
      where: { organizationId, categoryKey: catKey, enabled: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const customFields: DealFieldDef[] = customRows.map((r) => ({
    key: r.fieldKey,
    labelPt: r.label,
    labelEn: r.label,
    type: r.type as DealFieldDef["type"],
    required: r.required,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    optionSetKey: undefined,
  }));

  return resolveCategoryFields(
    catKey,
    overrides.map((o) => ({
      fieldKey: o.fieldKey,
      enabled: o.enabled,
      required: o.required,
      sortOrder: o.sortOrder,
    })),
    customFields,
  );
}

export async function loadOptionSetsForOrg(organizationId: string) {
  const sets = await prisma.dealOptionSet.findMany({
    where: { organizationId },
    include: {
      options: { where: { enabled: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { setKey: "asc" },
  });
  return sets.map((s) => ({
    id: s.id,
    setKey: s.setKey,
    label: s.label,
    categoryKey: s.categoryKey,
    options: s.options.map((o) => ({
      id: o.id,
      name: o.name,
      enabled: o.enabled,
      sortOrder: o.sortOrder,
    })),
  }));
}

export async function validateDealCategoryPayload(
  organizationId: string,
  category: string | null | undefined,
  categoryData: unknown,
): Promise<
  | { ok: true; category: string | null; categoryData: Record<string, unknown> | null }
  | { ok: false; message: string; errors?: Record<string, string> }
> {
  const catKey = category ? normalizeDealCategory(category) : await getActiveDealCategory(organizationId);
  if (catKey === "default") {
    return { ok: true, category: null, categoryData: null };
  }

  const fields = await loadDealFieldConfig(organizationId, catKey);
  const dataObj =
    categoryData && typeof categoryData === "object" && !Array.isArray(categoryData)
      ? (categoryData as Record<string, unknown>)
      : {};

  const validated = validateCategoryData(catKey, dataObj, fields);
  if (!validated.ok) {
    return { ok: false, message: "Invalid category data", errors: validated.errors };
  }

  return {
    ok: true,
    category: catKey,
    categoryData: Object.keys(validated.data).length > 0 ? validated.data : null,
  };
}

type DealCategoryDb = typeof prisma | import("@prisma/client").Prisma.TransactionClient;

/** Gera line items a partir de categoryData quando a org activou autoGenerateLineItems. */
export async function maybeAutoGenerateLineItemsFromCategory(
  db: DealCategoryDb,
  organizationId: string,
  dealId: string,
  category: string | null,
  categoryData: Record<string, unknown> | null,
): Promise<void> {
  if (!category || category === "default" || !categoryData) return;
  const settings = await getOrCreateDealOrgSettings(organizationId);
  if (!settings.autoGenerateLineItems) return;

  const existingCount = await db.dealLineItem.count({ where: { dealId } });
  if (existingCount > 0) return;

  if (category === "hospitality") {
    const rate = Number(categoryData.dailyRateCents);
    const nights = Number(categoryData.nights);
    if (Number.isFinite(rate) && rate > 0 && Number.isFinite(nights) && nights > 0) {
      await db.dealLineItem.create({
        data: {
          dealId,
          description: "Diária",
          quantity: Math.round(nights),
          unitPriceCents: Math.round(rate),
        },
      });
    }
    return;
  }

  if (category === "restaurants_events") {
    const ticket = Number(categoryData.ticketPerPersonCents);
    const guests = Number(categoryData.guestsQuantity);
    if (Number.isFinite(ticket) && ticket > 0 && Number.isFinite(guests) && guests > 0) {
      await db.dealLineItem.create({
        data: {
          dealId,
          description: "Ticket por pessoa",
          quantity: Math.round(guests),
          unitPriceCents: Math.round(ticket),
        },
      });
    }
    return;
  }

  if (category === "clinic") {
    const price = Number(categoryData.sessionPriceCents);
    const sessions = Number(categoryData.sessionsCount);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(sessions) && sessions > 0) {
      await db.dealLineItem.create({
        data: {
          dealId,
          description: "Sessão",
          quantity: Math.round(sessions),
          unitPriceCents: Math.round(price),
        },
      });
    }
  }
}

export function getDealCategoryCatalogResponse() {
  return DEAL_CATEGORY_CATALOG.map((c) => ({
    id: c.id,
    labelPt: c.labelPt,
    labelEn: c.labelEn,
    descriptionPt: c.descriptionPt,
    descriptionEn: c.descriptionEn,
    dealTypes: c.dealTypes ?? [],
    fieldCount: c.fields.length,
    optionSetTemplates: (c.optionSetTemplates ?? []).map((t) => ({
      setKey: t.setKey,
      labelPt: t.labelPt,
      labelEn: t.labelEn,
    })),
  }));
}

export async function buildDealCategoryContext(organizationId: string) {
  const settings = await getOrCreateDealOrgSettings(organizationId);
  const activeCategory = normalizeDealCategory(settings.activeCategory);
  await ensureCategoryOptionSets(organizationId, activeCategory);
  const fields = await loadDealFieldConfig(organizationId, activeCategory);
  const optionSets = await loadOptionSetsForOrg(organizationId);
  return {
    settings: {
      activeCategory,
      autoGenerateLineItems: settings.autoGenerateLineItems,
    },
    fields,
    optionSets,
    catalog: getDealCategoryCatalogResponse(),
  };
}
