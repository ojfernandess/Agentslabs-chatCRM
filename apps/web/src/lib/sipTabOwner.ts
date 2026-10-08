export type SipTabOwnerRecord = { tabId: string; at: number };

export function parseSipTabOwner(raw: string | null): SipTabOwnerRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tabId?: unknown; at?: unknown };
    if (typeof parsed.tabId !== "string" || !parsed.tabId) return null;
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return null;
    return { tabId: parsed.tabId, at: parsed.at };
  } catch {
    return null;
  }
}

/** A aba atual assume o registro só se não houver dono vivo. */
export function canClaimSipTab(
  now: number,
  existing: SipTabOwnerRecord | null,
  selfId: string,
  ttlMs = 4000,
): boolean {
  if (!existing) return true;
  if (existing.tabId === selfId) return true;
  return now - existing.at >= ttlMs;
}
