/** Formats elapsed seconds as MM:SS or H:MM:SS. */
export function formatCallDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function resolveTerminalCallStatus(status: string | null | undefined): string {
  const s = (status ?? "ENDED").toUpperCase();
  if (["ENDED", "REJECTED", "NOT_ANSWERED", "FAILED", "DISCONNECTED"].includes(s)) {
    return s === "DISCONNECTED" ? "ENDED" : s;
  }
  return "ENDED";
}
