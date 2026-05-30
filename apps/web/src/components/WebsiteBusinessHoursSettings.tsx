import { Clock } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { WebsiteBusinessHoursDay, WebsiteWidgetForm } from "@/lib/websiteWidget";

type Props = {
  form: WebsiteWidgetForm;
  onChange: (patch: Partial<WebsiteWidgetForm>) => void;
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

function durationLabel(start: string, end: string, allDay?: boolean): string {
  if (allDay) return "24h";
  const parse = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const a = parse(start);
  const b = parse(end);
  if (a == null || b == null || b <= a) return "";
  const mins = b - a;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function WebsiteBusinessHoursSettings({ form, onChange }: Props) {
  const { t } = useI18n();

  const dayLabel = (iso: number) =>
    t(`inboxesPage.wizard.widget.businessHours.days.${iso}` as "inboxesPage.wizard.widget.businessHours.days.1");

  const updateDay = (day: number, patch: Partial<WebsiteBusinessHoursDay>) => {
    onChange({
      businessHoursDays: form.businessHoursDays.map((d) => (d.day === day ? { ...d, ...patch } : d)),
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-ink-200 bg-ink-50/60 p-4 dark:border-ink-600 dark:bg-ink-950/40">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
          <Clock className="h-4 w-4 text-brand-500" />
          {t("inboxesPage.wizard.widget.businessHours.title")}
        </h4>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          {t("inboxesPage.wizard.widget.businessHours.intro")}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-800 dark:text-ink-100">
        <input
          type="checkbox"
          checked={form.businessHoursEnabled}
          onChange={(e) => onChange({ businessHoursEnabled: e.target.checked })}
          className="mt-0.5 rounded border-ink-300"
        />
        <span>{t("inboxesPage.wizard.widget.businessHours.enabled")}</span>
      </label>

      {form.businessHoursEnabled ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">
              {t("inboxesPage.wizard.widget.businessHours.unavailableMessage")}
            </span>
            <textarea
              value={form.businessHoursUnavailableMessage}
              onChange={(e) => onChange({ businessHoursUnavailableMessage: e.target.value })}
              className="input-field min-h-[88px]"
              maxLength={2000}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">
              {t("inboxesPage.wizard.widget.businessHours.timezone")}
            </span>
            <select
              value={form.businessHoursTimezone}
              onChange={(e) => onChange({ businessHoursTimezone: e.target.value })}
              className="input-field max-w-md"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="mb-2 text-xs font-semibold text-ink-700 dark:text-ink-300">
              {t("inboxesPage.wizard.widget.businessHours.weeklyTitle")}
            </p>
            <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900/50">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-ink-200 bg-ink-50/80 dark:border-ink-700 dark:bg-ink-950/40">
                  <tr>
                    <th className="px-3 py-2">{t("inboxesPage.wizard.widget.businessHours.colDay")}</th>
                    <th className="px-3 py-2">{t("inboxesPage.wizard.widget.businessHours.colEnabled")}</th>
                    <th className="px-3 py-2">{t("inboxesPage.wizard.widget.businessHours.colAllDay")}</th>
                    <th className="px-3 py-2">{t("inboxesPage.wizard.widget.businessHours.colFrom")}</th>
                    <th className="px-3 py-2">{t("inboxesPage.wizard.widget.businessHours.colTo")}</th>
                    <th className="px-3 py-2">{t("inboxesPage.wizard.widget.businessHours.colDuration")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ISO_DAYS.map((iso) => {
                    const row = form.businessHoursDays.find((d) => d.day === iso) ?? {
                      day: iso,
                      enabled: false,
                      start: "09:00",
                      end: "18:00",
                    };
                    return (
                      <tr key={iso} className="border-b border-ink-100 last:border-0 dark:border-ink-800">
                        <td className="px-3 py-2 font-medium text-ink-800 dark:text-ink-100">{dayLabel(iso)}</td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => updateDay(iso, { enabled: e.target.checked })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={row.allDay === true}
                            disabled={!row.enabled}
                            onChange={(e) => updateDay(iso, { allDay: e.target.checked })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {row.enabled && !row.allDay ? (
                            <input
                              type="time"
                              value={row.start ?? "09:00"}
                              onChange={(e) => updateDay(iso, { start: e.target.value })}
                              className="rounded border border-ink-200 px-2 py-1 dark:border-ink-600 dark:bg-ink-950"
                            />
                          ) : (
                            <span className="text-ink-400">{t("inboxesPage.wizard.widget.businessHours.unavailable")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.enabled && !row.allDay ? (
                            <input
                              type="time"
                              value={row.end ?? "18:00"}
                              onChange={(e) => updateDay(iso, { end: e.target.value })}
                              className="rounded border border-ink-200 px-2 py-1 dark:border-ink-600 dark:bg-ink-950"
                            />
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-500">
                          {row.enabled
                            ? durationLabel(row.start ?? "09:00", row.end ?? "18:00", row.allDay)
                            : t("inboxesPage.wizard.widget.businessHours.unavailable")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          {t("inboxesPage.wizard.widget.businessHours.disabledHint")}
        </p>
      )}
    </div>
  );
}

export function WebsiteBusinessHoursPreview({
  form,
  color,
}: {
  form: WebsiteWidgetForm;
  color: string;
}) {
  const { t } = useI18n();
  if (!form.businessHoursEnabled) return null;

  return (
    <div
      className="mb-4 rounded-xl border px-4 py-3 text-sm leading-relaxed"
      style={{ borderColor: `${color}44`, background: `${color}11`, color: "#334155" }}
    >
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color }}>
        {t("inboxesPage.wizard.widget.businessHours.previewLabel")}
      </p>
      <p>{form.businessHoursUnavailableMessage}</p>
    </div>
  );
}
