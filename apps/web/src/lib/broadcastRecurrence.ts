export type FollowUpRecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface FollowUpRecurrence {
  frequency: FollowUpRecurrenceFrequency;
  hour: number;
  minute: number;
  /** IANA timezone — hour/minute are interpreted in this zone on the server. */
  timeZone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

export function buildCronFromRecurrence(r: FollowUpRecurrence): string {
  const m = r.minute;
  const h = r.hour;
  if (r.frequency === "daily") return `${m} ${h} * * *`;
  if (r.frequency === "weekly") return `${m} ${h} * * ${r.dayOfWeek ?? 1}`;
  return `${m} ${h} ${r.dayOfMonth ?? 1} * *`;
}

export function defaultRecurrenceTimeLocal(): string {
  return "09:00";
}
