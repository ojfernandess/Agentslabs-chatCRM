import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type FollowUpRecurrenceFrequency = "daily" | "weekly" | "monthly";

export const DEFAULT_FOLLOW_UP_TIME_ZONE = "America/Sao_Paulo";

export interface FollowUpRecurrence {
  frequency: FollowUpRecurrenceFrequency;
  hour: number;
  minute: number;
  /** IANA timezone for hour/minute (browser local time when creating the campaign). */
  timeZone?: string;
  /** 0 = Sunday … 6 = Saturday (same as Date.getDay()) */
  dayOfWeek?: number;
  /** 1–28 (safe for all months) */
  dayOfMonth?: number;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function resolveTimeZone(r: FollowUpRecurrence): string {
  const tz = r.timeZone?.trim();
  return tz || DEFAULT_FOLLOW_UP_TIME_ZONE;
}

function zonedInstant(y: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  return fromZonedTime(new Date(y, month - 1, day, hour, minute, 0, 0), timeZone);
}

export function parseFollowUpRecurrence(raw: unknown): FollowUpRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const inner = o.followUpRecurrence ?? o;
  if (!inner || typeof inner !== "object") return null;
  const r = inner as Record<string, unknown>;
  const frequency = r.frequency;
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") return null;
  const timeZone = typeof r.timeZone === "string" && r.timeZone.trim() ? r.timeZone.trim() : undefined;
  return {
    frequency,
    hour: clamp(Number(r.hour), 0, 23),
    minute: clamp(Number(r.minute), 0, 59),
    timeZone,
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

/** Next run strictly after `from` (stored as UTC; hour/minute interpreted in recurrence timezone). */
export function computeNextRunAt(from: Date, r: FollowUpRecurrence): Date {
  const timeZone = resolveTimeZone(r);
  const zNow = toZonedTime(from, timeZone);
  const { hour, minute } = r;

  if (r.frequency === "daily") {
    let candidate = zonedInstant(zNow.getFullYear(), zNow.getMonth() + 1, zNow.getDate(), hour, minute, timeZone);
    if (candidate.getTime() <= from.getTime()) {
      const nextDay = new Date(zNow);
      nextDay.setDate(nextDay.getDate() + 1);
      candidate = zonedInstant(
        nextDay.getFullYear(),
        nextDay.getMonth() + 1,
        nextDay.getDate(),
        hour,
        minute,
        timeZone,
      );
    }
    return candidate;
  }

  if (r.frequency === "weekly") {
    const target = r.dayOfWeek ?? 1;
    const z = new Date(zNow);
    z.setHours(hour, minute, 0, 0);
    let daysAhead = target - z.getDay();
    if (daysAhead < 0 || (daysAhead === 0 && zonedInstant(z.getFullYear(), z.getMonth() + 1, z.getDate(), hour, minute, timeZone).getTime() <= from.getTime())) {
      daysAhead += 7;
    }
    z.setDate(z.getDate() + daysAhead);
    return zonedInstant(z.getFullYear(), z.getMonth() + 1, z.getDate(), hour, minute, timeZone);
  }

  const dom = Math.min(r.dayOfMonth ?? 1, 28);
  let candidate = zonedInstant(zNow.getFullYear(), zNow.getMonth() + 1, dom, hour, minute, timeZone);
  if (candidate.getTime() <= from.getTime()) {
    const nextMonth = new Date(zNow);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    candidate = zonedInstant(nextMonth.getFullYear(), nextMonth.getMonth() + 1, dom, hour, minute, timeZone);
  }
  return candidate;
}
