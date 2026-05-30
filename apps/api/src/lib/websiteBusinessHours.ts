/**
 * Horário comercial por caixa de entrada WEBSITE (JSON em `inbox.channel_config`).
 * Suporta horários diferentes por dia da semana (ISO 8601: 1 = segunda … 7 = domingo).
 */
export type WebsiteBusinessHoursDay = {
  day: number;
  enabled: boolean;
  allDay?: boolean;
  start?: string;
  end?: string;
};

export type WebsiteBusinessHoursConfig = {
  enabled: boolean;
  timezone: string;
  unavailableMessage?: string;
  days: WebsiteBusinessHoursDay[];
};

export function defaultWebsiteBusinessHoursDays(): WebsiteBusinessHoursDay[] {
  return [
    { day: 1, enabled: true, start: "09:00", end: "18:00" },
    { day: 2, enabled: true, start: "09:00", end: "18:00" },
    { day: 3, enabled: true, start: "09:00", end: "18:00" },
    { day: 4, enabled: true, start: "09:00", end: "17:00" },
    { day: 5, enabled: true, start: "09:00", end: "17:00" },
    { day: 6, enabled: false, start: "09:00", end: "17:00" },
    { day: 7, enabled: false, start: "09:00", end: "17:00" },
  ];
}

function parseHm(s: string | undefined): number | null {
  if (!s) return null;
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

function parseDay(raw: unknown): WebsiteBusinessHoursDay | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const day = typeof o.day === "number" ? o.day : null;
  if (day == null || day < 1 || day > 7) return null;
  const enabled = o.enabled === true;
  const allDay = o.allDay === true;
  const start = typeof o.start === "string" ? o.start : undefined;
  const end = typeof o.end === "string" ? o.end : undefined;
  return { day, enabled, allDay, start, end };
}

export function parseWebsiteBusinessHours(raw: unknown): WebsiteBusinessHoursConfig | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const timezone =
    typeof o.timezone === "string"
      ? o.timezone
      : typeof o.timeZone === "string"
        ? o.timeZone
        : null;
  if (!timezone || !isValidIanaTimeZone(timezone)) return null;

  let days: WebsiteBusinessHoursDay[] = [];
  if (Array.isArray(o.days)) {
    for (const item of o.days) {
      const parsed = parseDay(item);
      if (parsed) days.push(parsed);
    }
  }

  if (days.length === 0) {
    const legacyStart = typeof o.start === "string" ? o.start : "09:00";
    const legacyEnd = typeof o.end === "string" ? o.end : "18:00";
    const workDays = Array.isArray(o.workDays)
      ? o.workDays.filter((x): x is number => typeof x === "number" && x >= 1 && x <= 7)
      : [1, 2, 3, 4, 5];
    days = defaultWebsiteBusinessHoursDays().map((d) => ({
      ...d,
      enabled: workDays.includes(d.day),
      start: legacyStart,
      end: legacyEnd,
    }));
  }

  const byDay = new Map<number, WebsiteBusinessHoursDay>();
  for (const d of defaultWebsiteBusinessHoursDays()) {
    byDay.set(d.day, { ...d });
  }
  for (const d of days) {
    byDay.set(d.day, { ...byDay.get(d.day)!, ...d, day: d.day });
  }

  return {
    enabled: o.enabled === true,
    timezone,
    unavailableMessage: typeof o.unavailableMessage === "string" ? o.unavailableMessage : undefined,
    days: [...byDay.values()].sort((a, b) => a.day - b.day),
  };
}

export function websiteBusinessHoursFromChannelConfig(channelConfig: unknown): WebsiteBusinessHoursConfig {
  const tz =
    channelConfig && typeof channelConfig === "object" && !Array.isArray(channelConfig)
      ? typeof (channelConfig as Record<string, unknown>).businessHoursTimezone === "string"
        ? ((channelConfig as Record<string, unknown>).businessHoursTimezone as string)
        : "America/Sao_Paulo"
      : "America/Sao_Paulo";

  const raw =
    channelConfig && typeof channelConfig === "object" && !Array.isArray(channelConfig)
      ? {
          enabled: (channelConfig as Record<string, unknown>).businessHoursEnabled === true,
          timezone: tz,
          unavailableMessage: (channelConfig as Record<string, unknown>).businessHoursUnavailableMessage,
          days: (channelConfig as Record<string, unknown>).businessHoursDays,
        }
      : { enabled: false, timezone: tz, days: defaultWebsiteBusinessHoursDays() };

  return (
    parseWebsiteBusinessHours(raw) ?? {
      enabled: false,
      timezone: tz,
      days: defaultWebsiteBusinessHoursDays(),
    }
  );
}

/** Retorna true se o horário comercial estiver desativado ou se `now` cair numa janela aberta. */
export function isWithinWebsiteBusinessHours(now: Date, config: WebsiteBusinessHoursConfig): boolean {
  if (!config.enabled) return true;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const isoDow = weekdayToIso(weekday);
  if (!isoDow) return true;

  const dayCfg = config.days.find((d) => d.day === isoDow);
  if (!dayCfg || !dayCfg.enabled) return false;
  if (dayCfg.allDay) return true;

  const openMin = parseHm(dayCfg.start ?? "09:00");
  const closeMin = parseHm(dayCfg.end ?? "18:00");
  if (openMin == null || closeMin == null) return false;

  const nowMin = hour * 60 + minute;
  if (closeMin <= openMin) return nowMin >= openMin || nowMin < closeMin;
  return nowMin >= openMin && nowMin < closeMin;
}

function weekdayToIso(short: string): number | null {
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[short] ?? null;
}
