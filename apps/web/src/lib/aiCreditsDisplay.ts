/** Slug do pacote com destaque «Mais popular» na área do cliente. */
export const AI_CREDIT_RECOMMENDED_PACKAGE_SLUG = "pro-100-brl";

export function parseAiCreditsAmount(value: string | number): number | null {
  const amount = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(amount) ? amount : null;
}

/** Saldo/consumo: 99,86 créditos (precisão amigável, sem USD). */
export function formatAiCreditsBalance(value: string | number, locale: string, unitLabel: string): string {
  const amount = parseAiCreditsAmount(value);
  if (amount == null) return String(value);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: amount < 1 ? 6 : 2,
  }).format(amount);
  return `${formatted} ${unitLabel}`;
}

/** Pacote: quantidade inteira de créditos (ex.: 25). */
export function formatAiCreditsPackageCount(value: string | number, locale: string): string {
  const amount = parseAiCreditsAmount(value);
  if (amount == null) return String(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
}

/** Histórico: mesma unidade, tipografia compacta. */
export function formatAiCreditsHistoryAmount(value: string | number, locale: string, unitLabel: string): string {
  const amount = parseAiCreditsAmount(value);
  if (amount == null) return String(value);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 6,
  }).format(amount);
  return `${formatted} ${unitLabel}`;
}

/** Nome do tier a partir do slug (starter-25-brl → STARTER). */
export function aiCreditPackageTierLabel(slug: string): string {
  const tier = slug.split("-")[0]?.trim();
  return tier ? tier.toUpperCase() : slug.toUpperCase();
}

/** Admin: unidades decimais sem símbolo de moeda estrangeira. */
export function formatAiCreditsAdminUnits(value: string, locale: string): string {
  const amount = parseAiCreditsAmount(value);
  if (amount == null) return value;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(amount);
}
