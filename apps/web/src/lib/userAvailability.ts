import { api } from "@/lib/api";

export type UserAvailability = "online" | "away" | "offline";

export const AVAIL_STORAGE = "openconduit_availability";

export function readLocalAvailability(): UserAvailability {
  const v = localStorage.getItem(AVAIL_STORAGE);
  if (v === "away" || v === "offline" || v === "online") return v;
  return "online";
}

export function writeLocalAvailability(value: UserAvailability): void {
  localStorage.setItem(AVAIL_STORAGE, value);
  window.dispatchEvent(new CustomEvent("openconduit:availability-changed"));
}

export async function syncAvailabilityToServer(value: UserAvailability): Promise<void> {
  try {
    await api.patch("/auth/me/availability", { status: value });
  } catch {
    /* ignore — local state still updated */
  }
}

export function setUserAvailability(value: UserAvailability): void {
  writeLocalAvailability(value);
  void syncAvailabilityToServer(value);
}

export function applyServerAvailability(value: UserAvailability | undefined | null): void {
  if (value !== "online" && value !== "away" && value !== "offline") return;
  localStorage.setItem(AVAIL_STORAGE, value);
  window.dispatchEvent(new CustomEvent("openconduit:availability-changed"));
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
