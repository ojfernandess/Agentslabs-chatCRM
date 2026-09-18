import type { WhatsappRateCard } from "./whatsappRateCardCatalog.js";

/** Volume tiers Brazil Utility/Auth — estrutura Meta (descontos por faixa mensal). Fonte: rate cards Meta. */
const BRAZIL_USD_VOLUME_TIERS = [
  { market: "Brazil", countryCode: "55", category: "UTILITY" as const, fromMessage: 1, toMessage: 100000, discountPercent: 0 },
  { market: "Brazil", countryCode: "55", category: "UTILITY" as const, fromMessage: 100001, toMessage: 1000000, discountPercent: 5 },
  { market: "Brazil", countryCode: "55", category: "UTILITY" as const, fromMessage: 1000001, toMessage: 2000000, discountPercent: 10 },
  { market: "Brazil", countryCode: "55", category: "UTILITY" as const, fromMessage: 2000001, toMessage: 5000000, discountPercent: 15 },
  { market: "Brazil", countryCode: "55", category: "UTILITY" as const, fromMessage: 5000001, toMessage: null, discountPercent: 20 },
  { market: "Brazil", countryCode: "55", category: "AUTHENTICATION" as const, fromMessage: 1, toMessage: 100000, discountPercent: 0 },
  { market: "Brazil", countryCode: "55", category: "AUTHENTICATION" as const, fromMessage: 100001, toMessage: 1000000, discountPercent: 5 },
  { market: "Brazil", countryCode: "55", category: "AUTHENTICATION" as const, fromMessage: 1000001, toMessage: 2000000, discountPercent: 10 },
  { market: "Brazil", countryCode: "55", category: "AUTHENTICATION" as const, fromMessage: 2000001, toMessage: 5000000, discountPercent: 15 },
  { market: "Brazil", countryCode: "55", category: "AUTHENTICATION" as const, fromMessage: 5000001, toMessage: null, discountPercent: 20 },
];

/**
 * Snapshots de rate cards Meta embarcados.
 * Fonte: https://developers.facebook.com/docs/whatsapp/pricing/rate-cards
 * Valores Brazil USD/BRL conforme documentação Meta (Jul/2026).
 */
export const EMBEDDED_WHATSAPP_RATE_CARDS: WhatsappRateCard[] = [
  {
    id: "meta-2026-07-usd",
    version: "2026-07",
    label: "Meta rate card — Jul 2026 (USD — Brazil)",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: "2026-09-30T23:59:59.999Z",
    source: "https://developers.facebook.com/docs/whatsapp/pricing/rate-cards",
    currency: "USD",
    entries: [
      { market: "Brazil", countryCode: "55", category: "MARKETING", price: 0.0625 },
      { market: "Brazil", countryCode: "55", category: "UTILITY", price: 0.0068 },
      { market: "Brazil", countryCode: "55", category: "AUTHENTICATION", price: 0.0068 },
    ],
    volumeTiers: BRAZIL_USD_VOLUME_TIERS,
  },
  {
    id: "meta-2026-07-brl-brazil",
    version: "2026-07-brl",
    label: "Meta rate card — Jul 2026 (BRL — Brazil billing localization)",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    source: "https://developers.facebook.com/docs/whatsapp/pricing/",
    currency: "BRL",
    entries: [
      { market: "Brazil", countryCode: "55", category: "MARKETING", price: 0.3217 },
      { market: "Brazil", countryCode: "55", category: "UTILITY", price: 0.035 },
      { market: "Brazil", countryCode: "55", category: "AUTHENTICATION", price: 0.035 },
    ],
    volumeTiers: BRAZIL_USD_VOLUME_TIERS,
  },
  {
    id: "meta-2026-10-usd",
    version: "2026-10",
    label: "Meta rate card — Oct 2026 (USD — Brazil, incl. SERVICE)",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveUntil: null,
    source: "https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/",
    currency: "USD",
    entries: [
      { market: "Brazil", countryCode: "55", category: "MARKETING", price: 0.0625 },
      { market: "Brazil", countryCode: "55", category: "UTILITY", price: 0.0068 },
      { market: "Brazil", countryCode: "55", category: "AUTHENTICATION", price: 0.0068 },
      { market: "Brazil", countryCode: "55", category: "SERVICE", price: 0.0068 },
    ],
    volumeTiers: BRAZIL_USD_VOLUME_TIERS,
  },
];
