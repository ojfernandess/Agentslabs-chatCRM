import type { PrismaClient } from "@prisma/client";

export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Últimos dígitos para casar variantes (+55… vs 11… sem país). */
export function phoneMatchSuffix(phone: string, minLen = 10, maxLen = 11): string {
  const digits = phoneDigits(phone);
  if (digits.length <= maxLen) return digits;
  return digits.slice(-maxLen);
}

function nationalDigits(digits: string): string {
  if (digits.startsWith("55") && digits.length >= 12) return digits.slice(2);
  return digits;
}

/** Remove o 9 extra depois do DDD brasileiro (11 9xxxx-xxxx → 11 xxxx-xxxx). */
function stripBrMobileNine(national: string): string {
  if (national.length === 11 && national[2] === "9") return national.slice(0, 2) + national.slice(3);
  return national;
}

/**
 * Compara números gravados de formas diferentes: +55 vs 55, com/sem nono dígito.
 * Não altera o valor persistido — só o casamento.
 */
export function phonesLooselyMatch(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10 && (da.endsWith(db) || db.endsWith(da))) return true;

  const na = nationalDigits(da);
  const nb = nationalDigits(db);
  if (na.length >= 10 && na === nb) return true;
  const sa = stripBrMobileNine(na);
  const sb = stripBrMobileNine(nb);
  return sa.length >= 10 && sa === sb;
}

function lookupKeys(phone: string, waId?: string | null): string[] {
  const keys = new Set<string>();
  const add = (value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) keys.add(trimmed);
  };
  add(phone);
  const digits = phoneDigits(phone);
  if (digits.length >= 8) {
    add(digits);
    add(`+${digits}`);
    if (digits.startsWith("00")) add(`+${digits.slice(2)}`);
  }
  const suffix11 = phoneMatchSuffix(phone, 10, 11);
  const suffix10 = phoneMatchSuffix(phone, 10, 10);
  if (suffix11.length >= 10) add(suffix11);
  if (suffix10.length >= 10) add(suffix10);
  const national = nationalDigits(digits);
  if (national.length >= 10) {
    add(national);
    add(`+55${national}`);
    add(stripBrMobileNine(national));
    if (national.length === 10) add(`${national.slice(0, 2)}9${national.slice(2)}`);
  }
  if (waId) {
    add(waId);
    add(waId.replace(/^\+/, ""));
    add(`+${phoneDigits(waId)}`);
  }
  return [...keys];
}

/**
 * Procura contacto por telefone E.164 exacto, waId ou variantes de dígitos (Meta vs CRM).
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

  const digits = phoneDigits(phone);
  if (digits.length >= 8) {
    const plus = `+${digits}`;
    if (plus !== phone) {
      const byPlus = await prisma.contact.findFirst({
        where: { organizationId, phone: plus },
      });
      if (byPlus) return byPlus;
    }
    const byDigits = await prisma.contact.findFirst({
      where: { organizationId, phone: digits },
    });
    if (byDigits) return byDigits;
  }

  const keys = lookupKeys(phone, waId);
  const byKey = await prisma.contact.findFirst({
    where: { organizationId, phone: { in: keys } },
  });
  if (byKey) return byKey;

  const national = nationalDigits(digits.length >= 8 ? digits : phoneDigits(phone));
  const stripped = stripBrMobileNine(national);
  const withNine =
    national.length === 10 ? `${national.slice(0, 2)}9${national.slice(2)}` : national;
  const suffix = phoneMatchSuffix(phone);
  const suffix10 = phoneMatchSuffix(phone, 10, 10);
  const or: Array<{ phone?: { endsWith: string }; waId?: string }> = [];
  const addEndsWith = (value: string) => {
    if (value.length >= 10) or.push({ phone: { endsWith: value } });
  };
  addEndsWith(suffix);
  addEndsWith(suffix10);
  addEndsWith(national);
  addEndsWith(stripped);
  addEndsWith(withNine);
  for (const key of keys) {
    if (key.startsWith("+") || /^\d{10,15}$/.test(key)) {
      or.push({ waId: key });
    }
  }
  if (waId) {
    or.push({ waId });
    or.push({ waId: waId.replace(/^\+/, "") });
  }

  if (or.length === 0) return null;

  const candidates = await prisma.contact.findMany({
    where: { organizationId, OR: or },
    take: 15,
    orderBy: { updatedAt: "desc" },
  });

  const match = candidates.find((c) => phonesLooselyMatch(c.phone, phone) && !c.isGroupChat);
  if (match) return match;
  const anyPhone = candidates.find((c) => phonesLooselyMatch(c.phone, phone));
  if (anyPhone) return anyPhone;
  if (waId) {
    const byWa = candidates.find((c) => c.waId && phonesLooselyMatch(c.waId, waId));
    if (byWa) return byWa;
  }
  return null;
}
