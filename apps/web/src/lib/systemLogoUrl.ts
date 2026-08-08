import {
  buildDefaultSystemLogoUrl,
  isPlaceholderSystemLogoUrl,
  normalizeSystemLogoUrl,
} from "@openconduit/shared";
import { brandAssetUrl } from "@/lib/brandingAssets";

export { isPlaceholderSystemLogoUrl };

/** Logo absoluta do painel web (fallback quando não há URL customizada nas definições). */
export function resolveLocalSystemLogoUrl(custom?: string): string {
  const fallbackOrigin = typeof window !== "undefined" ? window.location.origin : "https://localhost";
  const trimmed = custom?.trim();
  if (!trimmed) {
    return normalizeSystemLogoUrl(`${fallbackOrigin}${brandAssetUrl("/logo.svg")}`, fallbackOrigin);
  }
  return normalizeSystemLogoUrl(trimmed, fallbackOrigin);
}

export function defaultLocalSystemLogoUrl(): string {
  return buildDefaultSystemLogoUrl(
    typeof window !== "undefined" ? window.location.origin : "https://localhost",
  );
}
