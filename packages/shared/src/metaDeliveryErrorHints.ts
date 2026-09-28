/** Códigos Meta Cloud API com orientação específica para atendentes / diagnóstico. */
export const META_DELIVERY_ERROR_CODES = {
  /** Limite de frequência de templates Marketing por destinatário. */
  MARKETING_FREQUENCY_CAP: 131049,
} as const;

/** Extrai o primeiro código numérico Meta de `providerError` persistido. */
export function extractMetaErrorCode(providerError: string | null | undefined): number | null {
  if (!providerError?.trim()) return null;
  const text = providerError.trim();
  const leading = text.match(/^(\d{5,6})\s*(?:—|-)/);
  if (leading) return Number.parseInt(leading[1], 10);
  const embedded = text.match(/\b(\d{5,6})\b/);
  if (embedded) return Number.parseInt(embedded[1], 10);
  return null;
}

export function isMetaMarketingFrequencyCapError(providerError: string | null | undefined): boolean {
  return extractMetaErrorCode(providerError) === META_DELIVERY_ERROR_CODES.MARKETING_FREQUENCY_CAP;
}

export function isMetaFetchFailedError(providerError: string | null | undefined): boolean {
  const t = providerError?.trim() ?? "";
  return /^META_NETWORK_ERROR:/i.test(t) || /\bfetch failed\b/i.test(t);
}

export function isMetaConfigurationError(providerError: string | null | undefined): boolean {
  return /^META_CONFIGURATION_ERROR:/i.test(providerError?.trim() ?? "");
}
