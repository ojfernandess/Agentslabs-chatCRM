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
