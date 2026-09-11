/** Converte texto em unidade monetária (ex.: 99,90) para centavos inteiros. */
export function currencyInputToCents(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  let normalized = trimmed;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(",", ".");
  }

  const n = Number.parseFloat(normalized);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Centavos → string para input em reais (ex.: 9990 → "99.90"). */
export function centsToCurrencyInput(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === "") return "";
  const n = typeof cents === "string" ? Number.parseInt(cents, 10) : cents;
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

/** Centavos → string para input directo em centavos. */
export function centsToRawCentsInput(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === "") return "";
  const n = typeof cents === "string" ? Number.parseInt(cents, 10) : cents;
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.floor(n)));
}

export function formatMoneyFromCents(
  cents: number,
  currency: string,
  locale: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
