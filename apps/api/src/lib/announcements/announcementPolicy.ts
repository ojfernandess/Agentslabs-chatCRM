export const MAX_FEATURED_ANNOUNCEMENTS = 3;
export const MAX_PINNED_ANNOUNCEMENTS = 5;
export const ANNOUNCEMENT_ICON_WHITELIST = [
  "Sparkles",
  "ArrowUp",
  "Info",
  "AlertTriangle",
  "Wrench",
  "Lightbulb",
  "Newspaper",
  "Megaphone",
] as const;

export const ANNOUNCEMENT_TONE_WHITELIST = [
  "brand",
  "sky",
  "amber",
  "rose",
  "slate",
  "emerald",
] as const;

export type AnnouncementAudienceTarget = {
  targetType: "ALL" | "ORGANIZATION" | "PLAN";
  targetId: string;
};

export function slugifyTitle(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "aviso";
}

/** Remove HTML. O mural persiste e renderiza markdown, nunca HTML cru. */
export function sanitizeAnnouncementContent(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:/gi, "")
    .replace(/\son\w+\s*=/gi, "")
    .trim();
}

export function isSafeAnnouncementLink(url: string): boolean {
  const value = url.trim();
  if (!value || value.length > 2048) return false;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function isSafeCoverUrl(url: string): boolean {
  return isSafeAnnouncementLink(url);
}

export function announcementMatchesAudience(
  targets: AnnouncementAudienceTarget[],
  organizationId: string,
  planId: string | null,
): boolean {
  return targets.some((target) => {
    if (target.targetType === "ALL") return true;
    if (target.targetType === "ORGANIZATION") return target.targetId === organizationId;
    if (target.targetType === "PLAN") return planId != null && target.targetId === planId;
    return false;
  });
}

export function isAnnouncementVisibleToOrganization(input: {
  status: string;
  deletedAt: Date | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  now: Date;
  targets: AnnouncementAudienceTarget[];
  organizationId: string;
  planId: string | null;
}): boolean {
  if (input.deletedAt) return false;
  if (input.status !== "PUBLISHED") return false;
  if (!input.publishedAt || input.publishedAt.getTime() > input.now.getTime()) return false;
  if (input.expiresAt && input.expiresAt.getTime() <= input.now.getTime()) return false;
  return announcementMatchesAudience(input.targets, input.organizationId, input.planId);
}
