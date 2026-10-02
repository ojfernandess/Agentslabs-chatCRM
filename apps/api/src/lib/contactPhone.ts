import { normalizePhoneE164 } from "@openconduit/shared";

/** DDDs brasileiros (Anatel). Usado só na entrada de contato, para não alterar outros fluxos. */
const BR_DDD = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

/**
 * Detecta telefone digitado no cadastro de contato (com espaços, hífen, parênteses)
 * e devolve E.164. Números com `+` ou prefixo `00` seguem o país informado.
 * Celular brasileiro (11 dígitos, DDD válido, nono dígito 9) recebe `+55`.
 * Fixo brasileiro sem código do país só recebe `+55` se vier formatado ou com 0 de tronco.
 */
export function normalizeContactPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[^\d+]/g, "");
  if (compact.startsWith("+")) {
    return normalizePhoneE164(compact);
  }

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00") && digits.length > 4) {
    const intl = normalizePhoneE164(`+${digits.slice(2)}`);
    if (intl) return intl;
  }

  const hadTrunkZero = digits.startsWith("0") && (digits.length === 11 || digits.length === 12);
  if (hadTrunkZero) {
    digits = digits.slice(1);
  }

  const formatted = /[^\d+]/.test(trimmed);
  const ddd = digits.slice(0, 2);
  const brMobile = digits.length === 11 && BR_DDD.has(ddd) && digits[2] === "9";
  const brLandline =
    digits.length === 10 && BR_DDD.has(ddd) && /^[2-5]$/.test(digits[2] ?? "");
  if (brMobile || ((formatted || hadTrunkZero) && brLandline)) {
    return normalizePhoneE164(`+55${digits}`);
  }

  if (
    digits.startsWith("55") &&
    (digits.length === 12 || digits.length === 13) &&
    BR_DDD.has(digits.slice(2, 4))
  ) {
    return normalizePhoneE164(`+${digits}`);
  }

  return normalizePhoneE164(digits);
}
