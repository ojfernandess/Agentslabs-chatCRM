import { prisma } from "../db.js";

/** Chave em `platform_settings` — fonte global da plataforma (super admin). */
export const PLATFORM_TYPOGRAPHY_KEY = "platform_typography";

export const ALLOWED_PLATFORM_FONTS = [
  "inter",
  "geist",
  "plus-jakarta-sans",
  "dm-sans",
  "manrope",
  "poppins",
  "system",
] as const;

export type PlatformFontId = (typeof ALLOWED_PLATFORM_FONTS)[number];

export const DEFAULT_PLATFORM_FONT: PlatformFontId = "inter";

export type PlatformTypographyValue = {
  font: PlatformFontId;
};

export function isAllowedPlatformFont(value: unknown): value is PlatformFontId {
  return typeof value === "string" && (ALLOWED_PLATFORM_FONTS as readonly string[]).includes(value);
}

export function parsePlatformTypographyValue(raw: unknown): PlatformTypographyValue {
  if (!raw || typeof raw !== "object" || raw === null) {
    return { font: DEFAULT_PLATFORM_FONT };
  }
  const font = (raw as Record<string, unknown>).font;
  if (isAllowedPlatformFont(font)) return { font };
  return { font: DEFAULT_PLATFORM_FONT };
}

export async function getPlatformTypographyFromDb(): Promise<PlatformTypographyValue> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: PLATFORM_TYPOGRAPHY_KEY },
  });
  return parsePlatformTypographyValue(row?.value);
}

export async function getPublicPlatformTypography(): Promise<PlatformTypographyValue> {
  return getPlatformTypographyFromDb();
}
