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

/** POST /calls/ `caller` — SIP user / ramal, digits only. */
export function formatNvoipCaller(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 32) || raw.trim().slice(0, 32);
}

export function nvoipSameNumbersip(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  return Boolean(da && db && da === db);
}

export type NvoipSipDirectoryEntry = {
  numbersip: string;
  caller?: string | null;
  webphone?: boolean | null;
};

/** Find synced SIP user matching POST /calls/ caller digits. */
export function findNvoipSipUserForCaller(
  caller: string,
  sipUsers: Iterable<NvoipSipDirectoryEntry>,
): NvoipSipDirectoryEntry | null {
  const norm = formatNvoipCaller(caller);
  if (!norm) return null;
  for (const sip of sipUsers) {
    if (nvoipSameNumbersip(norm, sip.numbersip)) return sip;
    if (sip.caller?.trim() && nvoipSameNumbersip(norm, sip.caller)) return sip;
  }
  return null;
}

export function nvoipSipUserHasWebphone(sip: NvoipSipDirectoryEntry | null | undefined): boolean {
  return sip?.webphone === true;
}

/** Best POST /calls/ caller for a synced SIP user (caller field or numbersip/ramal id). */
export function resolveNvoipCallerForSipUser(entry: NvoipSipDirectoryEntry): string {
  const fromCaller = formatNvoipCaller(entry.caller ?? "");
  if (fromCaller) return fromCaller;
  return formatNvoipCaller(entry.numbersip);
}

/**
 * POST /calls/ `caller` must be a registered SIP user / ramal.
 * On PABX trunk setups the account NumberSIP equals the SIP user (e.g. 143087001).
 * Secondary ramais may use shorter caller ids (e.g. 1049).
 */
export function isValidNvoipOutboundCaller(
  caller: string,
  accountNumbersip: string,
  sipUsers?: Iterable<NvoipSipDirectoryEntry>,
): boolean {
  const c = formatNvoipCaller(caller);
  if (!c || c.length < 2) return false;

  if (accountNumbersip && nvoipSameNumbersip(c, accountNumbersip)) {
    return true;
  }

  for (const sip of sipUsers ?? []) {
    if (nvoipSameNumbersip(c, sip.numbersip)) return true;
    if (sip.caller?.trim() && nvoipSameNumbersip(c, sip.caller)) return true;
  }

  // Typical secondary extensions (2–8 digits).
  if (c.length <= 8) return true;

  return false;
}

export function sanitizeNvoipOutboundCaller(
  caller: string | null | undefined,
  accountNumbersip: string,
  sipUsers?: Iterable<NvoipSipDirectoryEntry>,
): string | null {
  if (!caller?.trim()) return null;
  const norm = formatNvoipCaller(caller);
  return isValidNvoipOutboundCaller(norm, accountNumbersip, sipUsers) ? norm : null;
}
