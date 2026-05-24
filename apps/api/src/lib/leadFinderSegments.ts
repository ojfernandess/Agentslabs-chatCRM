import { prisma } from "../db.js";
import { LEAD_FINDER_DEFAULT_SEGMENTS } from "./leadFinderDefaultSegments.js";

export async function ensureLeadFinderDefaultSegments(organizationId: string): Promise<void> {
  const count = await prisma.leadFinderSegment.count({ where: { organizationId } });
  if (count > 0) return;

  await prisma.leadFinderSegment.createMany({
    data: LEAD_FINDER_DEFAULT_SEGMENTS.map((s) => ({
      organizationId,
      name: s.name,
      niche: s.niche,
      city: s.city,
      isPreset: true,
    })),
    skipDuplicates: true,
  });
}

export async function listLeadFinderSegments(organizationId: string) {
  await ensureLeadFinderDefaultSegments(organizationId);
  return prisma.leadFinderSegment.findMany({
    where: { organizationId },
    orderBy: [{ isPreset: "desc" }, { name: "asc" }],
  });
}
