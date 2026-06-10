import { normalizeDialPhone } from "./nvoipCallContext.js";

/** Nvoip POST /calls/ expects `called` as digits only (E.164 without +), e.g. 5511987654321. */
export function formatNvoipCalled(raw: string): string {
  const normalized = normalizeDialPhone(raw) ?? raw.trim();
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return raw.replace(/\D/g, "").slice(0, 32);

  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    return `55${digits}`.slice(0, 32);
  }
  return digits.slice(0, 32);
}

/** `caller` is the SIP extension (ramal), not numbersip — digits only, short. */
export function formatNvoipCaller(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 32) || raw.trim().slice(0, 32);
}
