import { api } from "@/lib/api";

export type UserAvailability = "online" | "away" | "offline";

export const AVAIL_STORAGE = "openconduit_availability";

export const USER_AVAILABILITY_CHANGED_EVENT = "openconduit:user-availability-changed";

export function readLocalAvailability(): UserAvailability {
  const v = localStorage.getItem(AVAIL_STORAGE);
  if (v === "away" || v === "offline" || v === "online") return v;
  return "online";
}

export function hasLocalAvailabilityPreference(): boolean {
  return localStorage.getItem(AVAIL_STORAGE) !== null;
}

export function writeLocalAvailability(value: UserAvailability): void {
  localStorage.setItem(AVAIL_STORAGE, value);
  window.dispatchEvent(new CustomEvent("openconduit:availability-changed"));
}

/** Propaga mudança de disponibilidade para toda a UI (WebSocket + alteração local). */
export function publishUserAvailabilityChanged(userId: string, status: UserAvailability): void {
  const normalized = normalizeAvailabilityStatus(status);
  window.dispatchEvent(
    new CustomEvent(USER_AVAILABILITY_CHANGED_EVENT, {
      detail: { userId, status: normalized },
    }),
  );
}

export async function syncAvailabilityToServer(
  value: UserAvailability,
  userId?: string,
): Promise<boolean> {
  const normalized = normalizeAvailabilityStatus(value);
  try {
    await api.patch("/auth/me/availability", { status: normalized });
    if (userId) publishUserAvailabilityChanged(userId, normalized);
    window.dispatchEvent(
      new CustomEvent("openconduit:availability-synced", {
        detail: { status: normalized, userId },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function setUserAvailability(value: UserAvailability, userId?: string): void {
  writeLocalAvailability(value);
  if (userId) publishUserAvailabilityChanged(userId, value);
  void syncAvailabilityToServer(value, userId);
}

export function applyServerAvailability(value: UserAvailability | undefined | null): void {
  if (value !== "online" && value !== "away" && value !== "offline") return;
  localStorage.setItem(AVAIL_STORAGE, value);
  window.dispatchEvent(new CustomEvent("openconduit:availability-changed"));
}

/** Normaliza valor vindo da API — nunca assumir online se o campo vier ausente. */
export function normalizeAvailabilityStatus(
  value: UserAvailability | undefined | null,
): UserAvailability {
  if (value === "online" || value === "away" || value === "offline") return value;
  return "offline";
}

export function patchAssigneeAvailability<T extends { id: string; availabilityStatus: UserAvailability }>(
  rows: T[],
  userId: string,
  status: UserAvailability,
): T[] {
  const normalized = normalizeAvailabilityStatus(status);
  let changed = false;
  const next = rows.map((row) => {
    if (row.id !== userId) return row;
    if (row.availabilityStatus === normalized) return row;
    changed = true;
    return { ...row, availabilityStatus: normalized };
  });
  return changed ? next : rows;
}

export function availabilityDotClass(value: UserAvailability): string {
  if (value === "online") return "bg-emerald-500";
  if (value === "away") return "bg-amber-400";
  return "bg-ink-400";
}

export function isOnlineForTransfer(value: UserAvailability | undefined | null): boolean {
  return value === "online";
}

export function availabilityLabelKey(value: UserAvailability): string {
  if (value === "online") return "profileMenu.online";
  if (value === "away") return "profileMenu.away";
  return "profileMenu.offline";
}
