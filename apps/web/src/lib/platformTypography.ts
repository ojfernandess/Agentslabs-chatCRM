import { api } from "@/lib/api";

export type PlatformFontId =
  | "inter"
  | "geist"
  | "plus-jakarta-sans"
  | "dm-sans"
  | "manrope"
  | "poppins"
  | "system";

export type PlatformTypographyConfig = {
  font: PlatformFontId;
};

export type PlatformFontOption = {
  id: PlatformFontId;
  label: string;
  recommended?: boolean;
  cssFamily: string;
  googleQuery?: string;
  stylesheetHref?: string;
};

const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const FONT_FALLBACK_CHAIN = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export const DEFAULT_PLATFORM_FONT: PlatformFontId = "inter";

export const PLATFORM_FONT_OPTIONS: PlatformFontOption[] = [
  {
    id: "inter",
    label: "Inter",
    recommended: true,
    cssFamily: "Inter",
    googleQuery: "Inter:wght@400;500;600;700",
  },
  {
    id: "geist",
    label: "Geist",
    cssFamily: "Geist",
    googleQuery: "Geist:wght@400;500;600;700",
  },
  {
    id: "plus-jakarta-sans",
    label: "Plus Jakarta Sans",
    cssFamily: "Plus Jakarta Sans",
    googleQuery: "Plus+Jakarta+Sans:wght@400;500;600;700",
  },
  {
    id: "dm-sans",
    label: "DM Sans",
    cssFamily: "DM Sans",
    googleQuery: "DM+Sans:wght@400;500;600;700",
  },
  {
    id: "manrope",
    label: "Manrope",
    cssFamily: "Manrope",
    googleQuery: "Manrope:wght@400;500;600;700",
  },
  {
    id: "poppins",
    label: "Poppins",
    cssFamily: "Poppins",
    googleQuery: "Poppins:wght@400;500;600;700",
  },
  {
    id: "system",
    label: "System Default",
    cssFamily: SYSTEM_FONT_STACK,
  },
];

const FONT_BY_ID = new Map(PLATFORM_FONT_OPTIONS.map((option) => [option.id, option]));

let cachedConfig: PlatformTypographyConfig | null = null;
let inflight: Promise<PlatformTypographyConfig> | null = null;
const loadedStylesheets = new Set<string>();

export function isPlatformFontId(value: unknown): value is PlatformFontId {
  return typeof value === "string" && FONT_BY_ID.has(value as PlatformFontId);
}

export function getPlatformFontOption(font: PlatformFontId): PlatformFontOption {
  return FONT_BY_ID.get(font) ?? FONT_BY_ID.get(DEFAULT_PLATFORM_FONT)!;
}

export function buildPlatformFontStack(font: PlatformFontId): string {
  const option = getPlatformFontOption(font);
  if (font === "system") return SYSTEM_FONT_STACK;
  return `"${option.cssFamily}", ${FONT_FALLBACK_CHAIN}`;
}

export function ensurePlatformFontStylesheet(font: PlatformFontId): void {
  if (typeof document === "undefined" || font === "system") return;
  const option = getPlatformFontOption(font);
  if (!option.googleQuery) return;
  const href = `https://fonts.googleapis.com/css2?family=${option.googleQuery}&display=swap`;
  if (loadedStylesheets.has(href)) return;
  const existing = document.querySelector(`link[data-platform-font="${font}"]`);
  if (existing) {
    loadedStylesheets.add(href);
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.platformFont = font;
  document.head.appendChild(link);
  loadedStylesheets.add(href);
}

export function applyPlatformFont(font: PlatformFontId): void {
  if (typeof document === "undefined") return;
  const safeFont = isPlatformFontId(font) ? font : DEFAULT_PLATFORM_FONT;
  ensurePlatformFontStylesheet(safeFont);
  document.documentElement.style.setProperty("--font-sans", buildPlatformFontStack(safeFont));
  document.documentElement.dataset.platformFont = safeFont;
}

export function loadPlatformTypographyConfig(): Promise<PlatformTypographyConfig> {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  if (inflight) return inflight;
  inflight = api
    .get<PlatformTypographyConfig>("/public/platform-typography")
    .then((data) => {
      const font = isPlatformFontId(data?.font) ? data.font : DEFAULT_PLATFORM_FONT;
      cachedConfig = { font };
      return cachedConfig;
    })
    .catch(() => {
      cachedConfig = { font: DEFAULT_PLATFORM_FONT };
      return cachedConfig;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function initPlatformTypography(): Promise<PlatformTypographyConfig> {
  applyPlatformFont(DEFAULT_PLATFORM_FONT);
  const config = await loadPlatformTypographyConfig();
  applyPlatformFont(config.font);
  return config;
}

export function invalidatePlatformTypographyCache(): void {
  cachedConfig = null;
  inflight = null;
}
