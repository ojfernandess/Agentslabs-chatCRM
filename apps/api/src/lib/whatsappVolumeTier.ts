import { Prisma } from "@prisma/client";

export type VolumeTierDef = {
  fromMessage: number;
  toMessage: number | null;
  discountPercent: number;
};

/** Seleciona o tier aplicável à n-ésima mensagem cobrável do mês (1-based). */
export function pickVolumeTierForMessageIndex(
  tiers: VolumeTierDef[],
  messageIndex: number,
): VolumeTierDef | null {
  if (messageIndex < 1 || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.fromMessage - b.fromMessage);
  for (const tier of sorted) {
    const max = tier.toMessage ?? Number.MAX_SAFE_INTEGER;
    if (messageIndex >= tier.fromMessage && messageIndex <= max) return tier;
  }
  return sorted[sorted.length - 1] ?? null;
}

/** Aplica desconto percentual Meta sobre tarifa de lista. */
export function applyVolumeTierDiscount(
  listPrice: Prisma.Decimal | number,
  discountPercent: number,
): Prisma.Decimal {
  const base = typeof listPrice === "number" ? listPrice : Number(listPrice);
  const factor = Math.max(0, 1 - discountPercent / 100);
  const value = Math.round(base * factor * 1_000_000) / 1_000_000;
  return new Prisma.Decimal(value.toFixed(6));
}

export function calendarMonthBounds(at: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { from, to };
}

/** Mercado Meta a partir do prefixo E.164 (simplificado — alinhado ao rate card Brazil). */
export function resolveMarketFromCountryCode(countryCode: string): string {
  const cc = countryCode.replace(/[^0-9]/g, "");
  if (cc === "55") return "Brazil";
  if (cc === "1") return "United States";
  if (cc === "351") return "Portugal";
  if (cc === "54") return "Argentina";
  return "Other";
}

export function resolveCountryCodeFromPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  /** Prefixos mais longos primeiro (mesma lógica do pricing rule match). */
  const prefixes = ["351", "55", "54", "1"];
  for (const p of prefixes.sort((a, b) => b.length - a.length)) {
    if (digits.startsWith(p)) return p;
  }
  return digits.slice(0, 3);
}
