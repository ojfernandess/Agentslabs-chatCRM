export const WEBSITE_PHONE_PREFIX = "oc|WEBSITE|";

export function websiteParticipantId(phone: string): string | null {
  if (!phone.startsWith(WEBSITE_PHONE_PREFIX)) return null;
  const id = phone.slice(WEBSITE_PHONE_PREFIX.length).trim();
  return id || null;
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

/** Contacto de visitante do site sem nome real (UUID ou rótulo genérico). */
export function isAnonymousWebsiteVisitorName(name: string, phone: string): boolean {
  if (!websiteParticipantId(phone)) return false;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^Visitante - #\d+$/i.test(trimmed)) return true;
  if (/^Visitor - #\d+$/i.test(trimmed)) return true;
  const participantId = websiteParticipantId(phone);
  if (participantId && trimmed === participantId) return true;
  if (isUuidLike(trimmed)) return true;
  return false;
}

export function parseWebsiteVisitorNumber(name: string): number | null {
  const match = /^(?:Visitante|Visitor) - #(\d+)$/i.exec(name.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatWebsiteVisitorLabel(index: number, locale = "pt"): string {
  const n = Math.max(1, index);
  return locale.toLowerCase().startsWith("pt") ? `Visitante - #${n}` : `Visitor - #${n}`;
}

export function resolveWebsiteContactDisplayName(
  name: string,
  phone: string,
  visitorIndex?: number | null,
  locale = "pt",
): string {
  if (!websiteParticipantId(phone)) return name;
  if (!isAnonymousWebsiteVisitorName(name, phone)) return name.trim();
  const fromName = parseWebsiteVisitorNumber(name);
  if (fromName != null) return formatWebsiteVisitorLabel(fromName, locale);
  return formatWebsiteVisitorLabel(visitorIndex ?? 1, locale);
}

export function parseWebsiteSiteMeta(channelConfig: unknown): {
  siteName: string;
  websiteUrl: string;
} {
  if (!channelConfig || typeof channelConfig !== "object" || Array.isArray(channelConfig)) {
    return { siteName: "", websiteUrl: "" };
  }
  const o = channelConfig as Record<string, unknown>;
  return {
    siteName: typeof o.siteName === "string" ? o.siteName.trim() : "",
    websiteUrl: typeof o.websiteUrl === "string" ? o.websiteUrl.trim() : "",
  };
}
