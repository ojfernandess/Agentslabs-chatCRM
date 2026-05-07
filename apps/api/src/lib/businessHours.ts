import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Horário comercial por equipa (JSON em `teams.business_hours`).
 *
 * Formato suportado:
 * ```json
 * {
 *   "timezone": "America/Sao_Paulo",
 *   "start": "09:00",
 *   "end": "18:00",
 *   "workDays": [1, 2, 3, 4, 5]
 * }
 * ```
 * `workDays`: dias ISO 8601, 1 = segunda … 7 = domingo (como em relatórios HubSpot / calendário ISO).
 * Campos alternativos aceites: `timeZone`, `weekdayStart` / `weekdayEnd` em vez de `start` / `end`.
 */
export type ParsedBusinessSchedule = {
  timeZone: string;
  workDaysIso: Set<number>;
  openMin: number;
  closeMin: number;
};

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseTeamBusinessHours(raw: unknown): ParsedBusinessSchedule | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const tzRaw =
    typeof o.timezone === "string"
      ? o.timezone
      : typeof o.timeZone === "string"
        ? o.timeZone
        : typeof o.tz === "string"
          ? o.tz
          : null;
  if (!tzRaw || !isValidIanaTimeZone(tzRaw)) return null;

  const startStr =
    typeof o.start === "string"
      ? o.start
      : typeof o.weekdayStart === "string"
        ? o.weekdayStart
        : "09:00";
  const endStr =
    typeof o.end === "string" ? o.end : typeof o.weekdayEnd === "string" ? o.weekdayEnd : "18:00";

  const openMin = parseHm(startStr);
  const closeMin = parseHm(endStr);
  if (openMin == null || closeMin == null || closeMin <= openMin) return null;

  let workDays: number[] = [1, 2, 3, 4, 5];
  if (Array.isArray(o.workDays)) {
    const arr = o.workDays.filter((x): x is number => typeof x === "number" && Number.isInteger(x));
    if (arr.length > 0) workDays = arr;
  }
  if (!workDays.every((d) => d >= 1 && d <= 7)) return null;

  return {
    timeZone: tzRaw,
    workDaysIso: new Set(workDays),
    openMin,
    closeMin,
  };
}

/** Minutos entre dois instantes UTC contando só o intervalo [start,end) ∩ janelas úteis. */
export function businessMinutesBetween(startUtc: Date, endUtc: Date, s: ParsedBusinessSchedule): number {
  if (endUtc.getTime() <= startUtc.getTime()) return 0;

  const endYmd = formatInTimeZone(endUtc, s.timeZone, "yyyy-MM-dd");
  const startYmd = formatInTimeZone(startUtc, s.timeZone, "yyyy-MM-dd");
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  let anchor = fromZonedTime(new Date(ys, ms - 1, ds, 12, 0, 0, 0), s.timeZone);

  let totalMin = 0;
  let guard = 0;

  while (formatInTimeZone(anchor, s.timeZone, "yyyy-MM-dd") <= endYmd && guard++ < 800) {
    const ymd = formatInTimeZone(anchor, s.timeZone, "yyyy-MM-dd");
    const [y, mo, d] = ymd.split("-").map(Number);
    const isoDow = Number(formatInTimeZone(anchor, s.timeZone, "i"));
    if (s.workDaysIso.has(isoDow)) {
      const openUtc = fromZonedTime(new Date(y, mo - 1, d, Math.floor(s.openMin / 60), s.openMin % 60, 0, 0), s.timeZone);
      const closeUtc = fromZonedTime(
        new Date(y, mo - 1, d, Math.floor(s.closeMin / 60), s.closeMin % 60, 0, 0),
        s.timeZone,
      );
      const segStart = startUtc.getTime() > openUtc.getTime() ? startUtc : openUtc;
      const segEnd = endUtc.getTime() < closeUtc.getTime() ? endUtc : closeUtc;
      if (segEnd.getTime() > segStart.getTime()) {
        totalMin += (segEnd.getTime() - segStart.getTime()) / 60000;
      }
    }
    anchor = addDays(anchor, 1);
  }

  return totalMin;
}

/** Documentação curta para UI / equipas. */
export const BUSINESS_HOURS_JSON_EXAMPLE = `{
  "timezone": "America/Sao_Paulo",
  "start": "09:00",
  "end": "18:00",
  "workDays": [1, 2, 3, 4, 5]
}`;
