import { normalizeDialPhone } from "./nvoipCallContext.js";

/**
 * Nvoip POST /calls/ `called` — digits only.
 * Official SDK examples use DDD+number (e.g. 11999999999), not 55 prefix.
 * @see https://github.com/Nvoip/nvoip-python/blob/main/examples/create_call.py
 */
export function formatNvoipCalled(raw: string): string {
  const normalized = normalizeDialPhone(raw) ?? raw.trim();
  let digits = normalized.replace(/\D/g, "");
  if (!digits) return raw.replace(/\D/g, "").slice(0, 32);

  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 32);
}

/** `caller` is the SIP extension (ramal), not numbersip — digits only, short. */
export function formatNvoipCaller(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 32) || raw.trim().slice(0, 32);
}

export function nvoipSameNumbersip(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  return Boolean(da && db && da === db);
}

/**
 * POST /calls/ `caller` must be a SIP extension (ramal, typically 2–8 digits).
 * Never the account NumberSIP (e.g. 143087001) or another user's numbersip id.
 */
export function isValidNvoipOutboundCaller(
  caller: string,
  accountNumbersip: string,
  extraBlocked?: Iterable<string>,
): boolean {
  const c = formatNvoipCaller(caller);
  if (!c || c.length < 2) return false;
  if (nvoipSameNumbersip(c, accountNumbersip)) return false;
  for (const blocked of extraBlocked ?? []) {
    if (blocked && nvoipSameNumbersip(c, blocked)) return false;
  }
  // NumberSIP / phone-like ids are 9+ digits; SIP extensions are shorter.
  if (c.length >= 9) return false;
  return true;
}

export function sanitizeNvoipOutboundCaller(
  caller: string | null | undefined,
  accountNumbersip: string,
  extraBlocked?: Iterable<string>,
): string | null {
  if (!caller?.trim()) return null;
  const norm = formatNvoipCaller(caller);
  return isValidNvoipOutboundCaller(norm, accountNumbersip, extraBlocked) ? norm : null;
}
