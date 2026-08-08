export const SYSTEM_LOGO_PATH = "/logo.svg";

/** Extrai só protocolo + host (ignora path acidental em PUBLIC_URL / WEB_APP_PUBLIC_URL). */
export function publicOriginOnly(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).origin;
  } catch {
    const match = trimmed.match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1] : trimmed;
  }
}

/** URLs de exemplo do editor — nunca usar em emails reais. */
export function isPlaceholderSystemLogoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return host === "app.exemplo.com" || host.endsWith(".exemplo.com");
  } catch {
    return trimmed.includes("app.exemplo.com");
  }
}

/**
 * Garante que a logo padrão do sistema fica em `{origin}/logo.svg`.
 * Corrige paths errados como `/automation/logo.svg` (ficheiro-fonte no repo ≠ URL pública).
 * URLs customizadas (ex.: CDN com outro ficheiro) mantêm-se inalteradas.
 */
export function normalizeSystemLogoUrl(url: string, fallbackOrigin: string): string {
  const trimmed = url.trim();
  const origin = publicOriginOnly(fallbackOrigin);
  const defaultUrl = `${origin}${SYSTEM_LOGO_PATH}`;

  if (!trimmed) return defaultUrl;
  if (isPlaceholderSystemLogoUrl(trimmed)) return defaultUrl;

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    // Qualquer URL cujo ficheiro seja logo.svg (ex.: /automation/logo.svg) → /logo.svg na raiz
    if (/(^|\/)logo\.svg$/i.test(path)) {
      return `${parsed.origin}${SYSTEM_LOGO_PATH}`;
    }
    return trimmed;
  } catch {
    if (trimmed === "logo.svg" || /(?:^|\/)logo\.svg$/i.test(trimmed)) {
      return defaultUrl;
    }
    if (trimmed.startsWith("/")) {
      return `${origin}${trimmed}`;
    }
    return trimmed;
  }
}

export function buildDefaultSystemLogoUrl(fallbackOrigin: string): string {
  return normalizeSystemLogoUrl("", fallbackOrigin);
}
