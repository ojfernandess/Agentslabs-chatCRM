export type FollowUpRecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface FollowUpRecurrence {
  frequency: FollowUpRecurrenceFrequency;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday (same as Date.getDay()) */
  dayOfWeek?: number;
  /** 1–28 (safe for all months) */
  dayOfMonth?: number;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function parseFollowUpRecurrence(raw: unknown): FollowUpRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const inner = o.followUpRecurrence ?? o;
  if (!inner || typeof inner !== "object") return null;
  const r = inner as Record<string, unknown>;
  const frequency = r.frequency;
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") return null;
  return {
    frequency,
    hour: clamp(Number(r.hour), 0, 23),
    minute: clamp(Number(r.minute), 0, 59),
    dayOfWeek: frequency === "weekly" ? clamp(Number(r.dayOfWeek ?? 1), 0, 6) : undefined,
    dayOfMonth: frequency === "monthly" ? clamp(Number(r.dayOfMonth ?? 1), 1, 28) : undefined,
  };
}

export function buildCronFromRecurrence(r: FollowUpRecurrence): string {
  const m = r.minute;
  const h = r.hour;
  if (r.frequency === "daily") return `${m} ${h} * * *`;
  if (r.frequency === "weekly") return `${m} ${h} * * ${r.dayOfWeek ?? 1}`;
  return `${m} ${h} ${r.dayOfMonth ?? 1} * *`;
}

/** Next run strictly after `from`. */
export function computeNextRunAt(from: Date, r: FollowUpRecurrence): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  const { hour, minute } = r;

  if (r.frequency === "daily") {
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (r.frequency === "weekly") {
    const target = r.dayOfWeek ?? 1;
    next.setHours(hour, minute, 0, 0);
    let daysAhead = target - next.getDay();
    if (daysAhead < 0 || (daysAhead === 0 && next.getTime() <= from.getTime())) {
      daysAhead += 7;
    }
    next.setDate(next.getDate() + daysAhead);
    return next;
  }

  const dom = Math.min(r.dayOfMonth ?? 1, 28);
  next.setDate(dom);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setMonth(next.getMonth() + 1);
    next.setDate(dom);
    next.setHours(hour, minute, 0, 0);
  }
  return next;
}
