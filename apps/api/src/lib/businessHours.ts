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
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function isoWeekday(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 7) return null;
  return n;
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
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    try {
      return parseTeamBusinessHours(JSON.parse(text));
    } catch {
      return null;
    }
  }
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
    const arr = o.workDays.map(isoWeekday).filter((d): d is number => d != null);
    if (arr.length > 0) workDays = arr;
  }

  return {
    timeZone: tzRaw,
    workDaysIso: new Set(workDays),
    openMin,
    closeMin,
  };
}

export function businessScheduleKey(schedule: ParsedBusinessSchedule): string {
  const days = [...schedule.workDaysIso].sort((a, b) => a - b).join(",");
  return `${schedule.timeZone}|${schedule.openMin}|${schedule.closeMin}|${days}`;
}

/** Horário único da organização. Vários calendários diferentes não têm um fallback comum. */
export function sharedBusinessSchedule(
  schedules: Iterable<ParsedBusinessSchedule>,
): ParsedBusinessSchedule | null {
  let first: ParsedBusinessSchedule | null = null;
  let key = "";
  for (const schedule of schedules) {
    const nextKey = businessScheduleKey(schedule);
    if (!first) {
      first = schedule;
      key = nextKey;
      continue;
    }
    if (nextKey !== key) return null;
  }
  return first;
}

/**
 * Calendário da 1ª resposta em horário útil.
 * Usa a equipe da conversa, depois a equipe do atendente, depois o horário único da organização.
 */
export function resolveConversationBusinessSchedule(opts: {
  teamId?: string | null;
  assigneeId?: string | null;
  scheduleByTeamId: ReadonlyMap<string, ParsedBusinessSchedule>;
  teamIdsByUserId?: ReadonlyMap<string, readonly string[]>;
  orgFallback?: ParsedBusinessSchedule | null;
}): ParsedBusinessSchedule | null {
  const teamId = opts.teamId ?? null;
  if (teamId) {
    const direct = opts.scheduleByTeamId.get(teamId);
    if (direct) return direct;
  }

  const assigneeId = opts.assigneeId ?? null;
  if (assigneeId && opts.teamIdsByUserId) {
    const found: ParsedBusinessSchedule[] = [];
    for (const id of opts.teamIdsByUserId.get(assigneeId) ?? []) {
      const schedule = opts.scheduleByTeamId.get(id);
      if (schedule) found.push(schedule);
    }
    const shared = sharedBusinessSchedule(found);
    if (shared) return shared;
  }

  return opts.orgFallback ?? null;
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
