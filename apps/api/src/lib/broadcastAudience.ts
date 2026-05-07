import { prisma } from "../db.js";

export async function assertTagsBelongToOrganization(
  organizationId: string,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) {
    throw new Error("At least one tag is required");
  }
  const n = await prisma.tag.count({
    where: { organizationId, id: { in: tagIds } },
  });
  if (n !== tagIds.length) {
    throw new Error("One or more tags are invalid for this organization");
  }
}

export async function countBroadcastAudience(
  organizationId: string,
  tagIds: string[],
): Promise<number> {
  return prisma.contact.count({
    where: {
      organizationId,
      isGroupChat: false,
      tags: { some: { tagId: { in: tagIds } } },
    },
  });
}

export async function listBroadcastAudienceContactIds(
  organizationId: string,
  tagIds: string[],
): Promise<string[]> {
  const rows = await prisma.contact.findMany({
    where: {
      organizationId,
      isGroupChat: false,
      tags: { some: { tagId: { in: tagIds } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
