import { prisma } from "../db.js";
import {
  getWhatsappRateCardCatalog,
  validateWhatsappRateCardImport,
  type WhatsappRateCard,
} from "./whatsappRateCardCatalog.js";

export type SyncRateCardResult = {
  catalogId: string;
  version: string;
  created: number;
  replaced: number;
  skipped: number;
  volumeTiersCreated: number;
  volumeTiersReplaced: number;
};

function catalogToRuleRows(catalog: WhatsappRateCard) {
  const effectiveFrom = new Date(catalog.effectiveFrom);
  const effectiveUntil = catalog.effectiveUntil ? new Date(catalog.effectiveUntil) : null;
  return catalog.entries.map((entry) => ({
    organizationId: null as string | null,
    market: entry.market,
    countryCode: entry.countryCode.replace(/[^0-9]/g, ""),
    currency: catalog.currency.toUpperCase(),
    category: entry.category,
    price: entry.price,
    effectiveFrom,
    effectiveUntil,
    source: catalog.source,
    version: catalog.version,
  }));
}

function catalogToVolumeTierRows(catalog: WhatsappRateCard) {
  if (!catalog.volumeTiers?.length) return [];
  const effectiveFrom = new Date(catalog.effectiveFrom);
  const effectiveUntil = catalog.effectiveUntil ? new Date(catalog.effectiveUntil) : null;
  return catalog.volumeTiers.map((tier) => ({
    organizationId: null as string | null,
    market: tier.market,
    countryCode: tier.countryCode.replace(/[^0-9]/g, ""),
    category: tier.category,
    currency: catalog.currency.toUpperCase(),
    fromMessage: tier.fromMessage,
    toMessage: tier.toMessage ?? null,
    discountPercent: tier.discountPercent,
    effectiveFrom,
    effectiveUntil,
    source: catalog.source,
    version: catalog.version,
  }));
}

/**
 * Importa um snapshot de rate card Meta para `whatsapp_pricing_rules` (global).
 * replaceVersion=true remove regras globais existentes com a mesma version antes de inserir.
 */
export async function syncWhatsappRateCardToDatabase(params: {
  catalogId: string;
  replaceVersion?: boolean;
  customCatalog?: WhatsappRateCard;
}): Promise<SyncRateCardResult> {
  const catalog = params.customCatalog ?? getWhatsappRateCardCatalog(params.catalogId);
  if (!catalog) {
    throw new Error(`Rate card catalog not found: ${params.catalogId}`);
  }

  let replaced = 0;
  let volumeTiersReplaced = 0;
  if (params.replaceVersion !== false) {
    const del = await prisma.whatsappPricingRule.deleteMany({
      where: {
        organizationId: null,
        version: catalog.version,
      },
    });
    replaced = del.count;
    const delTiers = await prisma.whatsappPricingVolumeTier.deleteMany({
      where: {
        organizationId: null,
        version: catalog.version,
      },
    });
    volumeTiersReplaced = delTiers.count;
  }

  const rows = catalogToRuleRows(catalog);
  const tierRows = catalogToVolumeTierRows(catalog);
  let created = 0;
  let skipped = 0;
  let volumeTiersCreated = 0;

  for (const row of rows) {
    const existing = await prisma.whatsappPricingRule.findFirst({
      where: {
        organizationId: null,
        countryCode: row.countryCode,
        category: row.category,
        version: row.version,
        currency: row.currency,
      },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.whatsappPricingRule.create({ data: row });
    created += 1;
  }

  for (const tier of tierRows) {
    const existing = await prisma.whatsappPricingVolumeTier.findFirst({
      where: {
        organizationId: null,
        countryCode: tier.countryCode,
        category: tier.category,
        version: tier.version,
        currency: tier.currency,
        fromMessage: tier.fromMessage,
      },
    });
    if (existing) continue;
    await prisma.whatsappPricingVolumeTier.create({ data: tier });
    volumeTiersCreated += 1;
  }

  return {
    catalogId: catalog.id,
    version: catalog.version,
    created,
    replaced,
    skipped,
    volumeTiersCreated,
    volumeTiersReplaced,
  };
}

export async function importCustomWhatsappRateCard(raw: unknown, replaceVersion = true): Promise<SyncRateCardResult> {
  const catalog = validateWhatsappRateCardImport(raw);
  if (!catalog) throw new Error("Invalid rate card JSON");
  return syncWhatsappRateCardToDatabase({
    catalogId: catalog.id,
    replaceVersion,
    customCatalog: catalog,
  });
}

export async function getWhatsappPricingRuleSummary(): Promise<{
  totalRules: number;
  totalVolumeTiers: number;
  versions: { version: string; count: number; currency: string | null }[];
  markets: string[];
}> {
  const [rules, tiers] = await Promise.all([
    prisma.whatsappPricingRule.findMany({
      where: { organizationId: null },
      select: { version: true, market: true, currency: true },
      take: 2000,
    }),
    prisma.whatsappPricingVolumeTier.count({ where: { organizationId: null } }),
  ]);
  const versionMap = new Map<string, { count: number; currency: string | null }>();
  const markets = new Set<string>();
  for (const r of rules) {
    markets.add(r.market);
    const key = r.version ?? "unknown";
    const cur = versionMap.get(key) ?? { count: 0, currency: r.currency };
    cur.count += 1;
    if (!cur.currency) cur.currency = r.currency;
    versionMap.set(key, cur);
  }
  return {
    totalRules: rules.length,
    totalVolumeTiers: tiers,
    versions: [...versionMap.entries()].map(([version, v]) => ({
      version,
      count: v.count,
      currency: v.currency,
    })),
    markets: [...markets].sort(),
  };
}
