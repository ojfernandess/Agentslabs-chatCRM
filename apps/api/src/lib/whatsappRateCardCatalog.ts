import { z } from "zod";
import { EMBEDDED_WHATSAPP_RATE_CARDS } from "./whatsappRateCardCatalogData.js";

const rateCardEntrySchema = z.object({
  market: z.string().min(1).max(80),
  countryCode: z.string().min(1).max(8),
  category: z.enum(["SERVICE", "UTILITY", "MARKETING", "AUTHENTICATION"]),
  price: z.number().nonnegative(),
});

const volumeTierSchema = z.object({
  market: z.string().min(1).max(80),
  countryCode: z.string().min(1).max(8),
  category: z.enum(["UTILITY", "AUTHENTICATION"]),
  fromMessage: z.number().int().positive(),
  toMessage: z.number().int().positive().nullable().optional(),
  discountPercent: z.number().min(0).max(100),
});

export const rateCardSchema = z.object({
  id: z.string().min(1).max(64),
  version: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  effectiveFrom: z.string().min(1),
  effectiveUntil: z.string().nullable().optional(),
  source: z.string().min(1).max(255),
  currency: z.string().min(1).max(8),
  entries: z.array(rateCardEntrySchema).min(1),
  volumeTiers: z.array(volumeTierSchema).optional(),
});

export type WhatsappRateCardVolumeTier = z.infer<typeof volumeTierSchema>;

export type WhatsappRateCard = z.infer<typeof rateCardSchema>;
export type WhatsappRateCardEntry = z.infer<typeof rateCardEntrySchema>;

/** Catálogos embarcados (snapshots oficiais Meta — importáveis para whatsapp_pricing_rules). */
export function listWhatsappRateCardCatalogs(): WhatsappRateCard[] {
  return [...EMBEDDED_WHATSAPP_RATE_CARDS];
}

export function getWhatsappRateCardCatalog(catalogId: string): WhatsappRateCard | null {
  return listWhatsappRateCardCatalogs().find((c) => c.id === catalogId) ?? null;
}

export function validateWhatsappRateCardImport(raw: unknown): WhatsappRateCard | null {
  const parsed = rateCardSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type EmbeddedWhatsappRate = {
  price: number;
  currency: string;
  version: string;
  market: string;
};

/**
 * Tarifa do catálogo embarcado vigente na data.
 * Entre cartões com o mesmo início, BRL ganha do USD. O cartão mais recente ganha dos anteriores.
 */
export function findEmbeddedWhatsappRate(params: {
  phoneDigits: string;
  category: "SERVICE" | "UTILITY" | "MARKETING" | "AUTHENTICATION";
  at: Date;
}): EmbeddedWhatsappRate | null {
  const phone = params.phoneDigits.replace(/[^0-9]/g, "");
  if (!phone) return null;
  let best: (EmbeddedWhatsappRate & { countryLen: number; effectiveFrom: number; brl: boolean }) | null =
    null;
  for (const card of listWhatsappRateCardCatalogs()) {
    const from = new Date(card.effectiveFrom);
    const until = card.effectiveUntil ? new Date(card.effectiveUntil) : null;
    if (Number.isNaN(from.getTime()) || from > params.at) continue;
    if (until && (Number.isNaN(until.getTime()) || until < params.at)) continue;
    for (const entry of card.entries) {
      if (entry.category !== params.category) continue;
      const cc = entry.countryCode.replace(/[^0-9]/g, "");
      if (!cc || !phone.startsWith(cc)) continue;
      const candidate = {
        price: entry.price,
        currency: card.currency.toUpperCase(),
        version: card.version,
        market: entry.market,
        countryLen: cc.length,
        effectiveFrom: from.getTime(),
        brl: card.currency.toUpperCase() === "BRL",
      };
      if (
        !best ||
        candidate.countryLen > best.countryLen ||
        (candidate.countryLen === best.countryLen && candidate.effectiveFrom > best.effectiveFrom) ||
        (candidate.countryLen === best.countryLen &&
          candidate.effectiveFrom === best.effectiveFrom &&
          candidate.brl &&
          !best.brl)
      ) {
        best = candidate;
      }
    }
  }
  if (!best) return null;
  return {
    price: best.price,
    currency: best.currency,
    version: best.version,
    market: best.market,
  };
}
