import {
  WEBSITE_PHONE_PREFIX,
  formatWebsiteVisitorLabel,
  isAnonymousWebsiteVisitorName,
  parseWebsiteVisitorNumber,
  resolveWebsiteContactDisplayName,
} from "@openconduit/shared";
import { prisma } from "../db.js";

export async function buildWebsiteVisitorIndexMap(organizationId: string): Promise<Map<string, number>> {
  const contacts = await prisma.contact.findMany({
    where: { organizationId, phone: { startsWith: WEBSITE_PHONE_PREFIX } },
    select: { id: true, name: true, phone: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const map = new Map<string, number>();
  let anonymousOrdinal = 0;

  for (const contact of contacts) {
    if (!isAnonymousWebsiteVisitorName(contact.name, contact.phone)) continue;

    const labeled = parseWebsiteVisitorNumber(contact.name);
    if (labeled != null) {
      map.set(contact.id, labeled);
      continue;
    }

    anonymousOrdinal += 1;
    map.set(contact.id, anonymousOrdinal);
  }

  return map;
}

export async function nextWebsiteVisitorLabel(organizationId: string): Promise<string> {
  const contacts = await prisma.contact.findMany({
    where: { organizationId, phone: { startsWith: WEBSITE_PHONE_PREFIX } },
    select: { name: true, phone: true },
  });

  let max = 0;
  let legacyAnonymous = 0;
  for (const contact of contacts) {
    const labeled = parseWebsiteVisitorNumber(contact.name);
    if (labeled != null) {
      max = Math.max(max, labeled);
      continue;
    }
    if (isAnonymousWebsiteVisitorName(contact.name, contact.phone)) {
      legacyAnonymous += 1;
    }
  }

  return formatWebsiteVisitorLabel(Math.max(max, legacyAnonymous) + 1);
}

export function enrichWebsiteContact<T extends { id: string; name: string; phone: string }>(
  contact: T,
  visitorIndexMap: Map<string, number>,
  locale = "pt",
): T {
  if (!contact.phone.startsWith(WEBSITE_PHONE_PREFIX)) return contact;
  const index = visitorIndexMap.get(contact.id);
  return {
    ...contact,
    name: resolveWebsiteContactDisplayName(contact.name, contact.phone, index, locale),
  };
}
