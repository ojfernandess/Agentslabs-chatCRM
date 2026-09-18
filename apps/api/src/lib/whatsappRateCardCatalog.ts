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
