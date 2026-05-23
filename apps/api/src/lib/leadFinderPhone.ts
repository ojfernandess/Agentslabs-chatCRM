import { normalizePhoneE164 } from "@openconduit/shared";

/** Normaliza telefone de resultados Google Maps (prioriza Brasil +55). */
export function normalizeLeadFinderPhone(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;

  const direct = normalizePhoneE164(raw.trim());
  if (direct) return direct;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length >= 10 && digits.length <= 11) {
    const br = normalizePhoneE164(`+55${digits}`);
    if (br) return br;
  }

  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 15) {
    return normalizePhoneE164(`+${digits}`);
  }

  if (digits.length >= 7 && digits.length <= 15) {
    return normalizePhoneE164(`+${digits}`);
  }

  return null;
}
