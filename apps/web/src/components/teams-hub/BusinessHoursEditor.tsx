import clsx from "clsx";
import { Clock } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type BusinessHoursValue = {
  timezone: string;
  start: string;
  end: string;
  workDays: number[];
};

const DEFAULT: BusinessHoursValue = {
  timezone: "America/Sao_Paulo",
  start: "09:00",
  end: "18:00",
  workDays: [1, 2, 3, 4, 5],
};

const TIMEZONE_OPTIONS = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Belem",
  "America/Cuiaba",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "UTC",
];

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function parseBusinessHours(raw: unknown): BusinessHoursValue | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const timezone =
    typeof o.timezone === "string"
      ? o.timezone
      : typeof o.timeZone === "string"
        ? o.timeZone
        : null;
  const start = typeof o.start === "string" ? o.start : typeof o.weekdayStart === "string" ? o.weekdayStart : null;
  const end = typeof o.end === "string" ? o.end : typeof o.weekdayEnd === "string" ? o.weekdayEnd : null;
  const workDays = Array.isArray(o.workDays)
    ? o.workDays.filter((x): x is number => typeof x === "number" && x >= 1 && x <= 7)
    : [];
  if (!timezone || !start || !end) return null;
  return {
    timezone,
    start,
    end,
    workDays: workDays.length > 0 ? workDays : [1, 2, 3, 4, 5],
  };
}

export function businessHoursToJson(value: BusinessHoursValue | null): Record<string, unknown> | null {
  if (!value) return null;
  return {
    timezone: value.timezone,
    start: value.start,
    end: value.end,
    workDays: value.workDays,
  };
}

export function defaultBusinessHours(): BusinessHoursValue {
  return { ...DEFAULT, workDays: [...DEFAULT.workDays] };
}

interface Props {
  enabled: boolean;
  value: BusinessHoursValue;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (value: BusinessHoursValue) => void;
}

export function BusinessHoursEditor({ enabled, value, onEnabledChange, onChange }: Props) {
  const { t } = useI18n();

  const dayLabel = (iso: number) => t(`teams.businessHours.days.${iso}` as "teams.businessHours.days.1");

  const toggleDay = (iso: number) => {
    const set = new Set(value.workDays);
    if (set.has(iso)) set.delete(iso);
    else set.add(iso);
    const next = [...set].sort((a, b) => a - b);
    onChange({ ...value, workDays: next.length > 0 ? next : [iso] });
  };

  return (
    <div className="rounded-2xl border border-ink-200/80 bg-gradient-to-br from-white to-slate-50/80 p-4 dark:border-ink-800 dark:from-ink-950/80 dark:to-ink-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
            <Clock className="h-4 w-4 text-brand-500" />
            {t("teams.businessHoursLabel")}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{t("teams.businessHoursHint")}</p>
        </div>
        <button
          type="button"
          onClick={() => onEnabledChange(!enabled)}
          className={clsx(
            "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
            enabled
              ? "bg-emerald-500/15 text-emerald-800 ring-1 ring-emerald-500/30 dark:text-emerald-200"
              : "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300",
          )}
        >
          {enabled ? t("teams.businessHours.enabled") : t("teams.businessHours.disabled")}
        </button>
      </div>

      {enabled ? (
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-ink-400">
              {t("teams.businessHours.timezone")}
            </label>
            <select
              value={value.timezone}
              onChange={(e) => onChange({ ...value, timezone: e.target.value })}
              className="input-field w-full text-sm"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-ink-400">
                {t("teams.businessHours.start")}
              </label>
              <input
                type="time"
                value={value.start}
                onChange={(e) => onChange({ ...value, start: e.target.value })}
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-ink-400">
                {t("teams.businessHours.end")}
              </label>
              <input
                type="time"
                value={value.end}
                onChange={(e) => onChange({ ...value, end: e.target.value })}
                className="input-field w-full text-sm"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-ink-600 dark:text-ink-400">{t("teams.businessHours.workDays")}</p>
            <div className="flex flex-wrap gap-2">
              {ISO_DAYS.map((iso) => (
                <button
                  key={iso}
                  type="button"
                  onClick={() => toggleDay(iso)}
                  className={clsx(
                    "rounded-xl px-3 py-2 text-xs font-semibold transition",
                    value.workDays.includes(iso)
                      ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30"
                      : "border border-ink-200 bg-white text-ink-600 hover:border-brand-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300",
                  )}
                >
                  {dayLabel(iso)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">{t("teams.businessHours.offHint")}</p>
      )}
    </div>
  );
}
