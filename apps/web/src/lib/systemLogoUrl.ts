import { brandAssetUrl } from "@/lib/brandingAssets";

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

/** Logo absoluta do painel web (fallback quando não há URL customizada nas definições). */
export function resolveLocalSystemLogoUrl(custom?: string): string {
  const trimmed = custom?.trim();
  if (trimmed && !isPlaceholderSystemLogoUrl(trimmed)) return trimmed;
  if (typeof window !== "undefined") {
    return `${window.location.origin}${brandAssetUrl("/logo.svg")}`;
  }
  return "/logo.svg";
}
