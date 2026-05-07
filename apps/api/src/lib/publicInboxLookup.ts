import { prisma } from "../db.js";

export async function loadInboxByIngestToken(token: string) {
  const t = token?.trim();
  if (!t || t.length < 16) return null;
  return prisma.inbox.findFirst({
    where: { ingestToken: t },
    include: { organization: { select: { id: true, isActive: true } } },
  });
}
