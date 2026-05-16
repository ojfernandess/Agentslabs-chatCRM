export function slaMinutesFromInput(n: number, u: "minutes" | "hours" | "days"): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 5;
  if (u === "days") return Math.min(v, 30) * 1440;
  if (u === "hours") return Math.min(v, 720) * 60;
  return Math.min(v, 43_200);
}

export function slaDisplayFromMinutes(total: number): { n: number; u: "minutes" | "hours" | "days" } {
  const m = Math.min(43_200, Math.max(1, Math.floor(Number(total)) || 5));
  if (m >= 1440 && m % 1440 === 0) return { n: m / 1440, u: "days" };
  if (m >= 60 && m % 60 === 0) return { n: m / 60, u: "hours" };
  return { n: m, u: "minutes" };
}
