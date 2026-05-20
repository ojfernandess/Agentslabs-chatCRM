import type { PrismaClient } from "@prisma/client";

/** Últimos dígitos para casar variantes (+55… vs 11… sem país). */
export function phoneMatchSuffix(phone: string, minLen = 10, maxLen = 11): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= maxLen) return digits;
  return digits.slice(-maxLen);
}

/**
 * Procura contacto por telefone E.164 exacto, waId ou sufixo de dígitos (evita duplicados Meta vs CRM).
 */
export async function findContactByInboundPhone(
  prisma: PrismaClient,
  organizationId: string,
  phone: string,
  waId?: string | null,
) {
  const exact = await prisma.contact.findFirst({
    where: { organizationId, phone },
  });
  if (exact) return exact;

  const suffix = phoneMatchSuffix(phone);
  if (suffix.length >= 10) {
    const bySuffix = await prisma.contact.findMany({
      where: {
        organizationId,
        OR: [
          { phone: { endsWith: suffix } },
          ...(waId ? [{ waId }, { waId: waId.replace(/^\+/, "") }] : []),
        ],
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
    });
    const match = bySuffix.find((c) => phoneMatchSuffix(c.phone) === suffix);
    if (match) return match;
    if (bySuffix.length === 1) return bySuffix[0]!;
  }

  if (waId) {
    return prisma.contact.findFirst({
      where: { organizationId, waId },
    });
  }

  return null;
}
