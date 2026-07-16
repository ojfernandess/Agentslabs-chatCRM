import clsx from "clsx";
import { CalendarClock, Repeat, Send } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  buildCronFromRecurrence,
  browserTimeZone,
  defaultRecurrenceTimeLocal,
  type FollowUpRecurrence,
  type FollowUpRecurrenceFrequency,
} from "@/lib/broadcastRecurrence";
import type { FollowUpScheduleMode } from "./campaignDraftMapper";

export type { FollowUpScheduleMode };

export function defaultScheduledLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dispatchConfigToScheduleState(dispatch: Record<string, unknown>): FollowUpScheduleState {
  const cron = String(dispatch.cronExpression ?? "").trim();
  if (cron) {
    return { ...defaultFollowUpScheduleState(), scheduleMode: "recurring" };
  }
  if (dispatch.executionMode === "scheduled") {
    const local = isoToDatetimeLocal(String(dispatch.scheduledAt ?? ""));
    return {
      ...defaultFollowUpScheduleState(),
      scheduleMode: "scheduled",
      scheduledAt: local || defaultScheduledLocal(),
    };
  }
  return { ...defaultFollowUpScheduleState(), scheduleMode: "now" };
}

export interface FollowUpScheduleState {
  scheduleMode: FollowUpScheduleMode;
  scheduledAt: string;
  recurrenceFrequency: FollowUpRecurrenceFrequency;
  recurrenceTime: string;
  recurrenceDayOfWeek: number;
  recurrenceDayOfMonth: number;
}

export function defaultFollowUpScheduleState(): FollowUpScheduleState {
  return {
    scheduleMode: "now",
    scheduledAt: defaultScheduledLocal(),
    recurrenceFrequency: "monthly",
    recurrenceTime: defaultRecurrenceTimeLocal(),
    recurrenceDayOfWeek: 1,
    recurrenceDayOfMonth: 1,
  };
}

export interface FollowUpSchedulePayload {
  scheduleType: "IMMEDIATE" | "SCHEDULED" | "RECURRING";
  scheduledAt?: string;
  segmentRules?: { followUpRecurrence?: FollowUpRecurrence; campaignKind?: "followup" };
  cronExpression?: string;
  autoStart: boolean;
}

export function buildFollowUpSchedulePayload(state: FollowUpScheduleState): FollowUpSchedulePayload {
  const [hStr, mStr] = state.recurrenceTime.split(":");
  const hour = Number(hStr);
  const minute = Number(mStr);

  if (state.scheduleMode === "scheduled" && state.scheduledAt) {
    return {
      scheduleType: "SCHEDULED",
      scheduledAt: new Date(state.scheduledAt).toISOString(),
      autoStart: false,
    };
  }

  if (state.scheduleMode === "recurring") {
    const followUpRecurrence: FollowUpRecurrence = {
      frequency: state.recurrenceFrequency,
      hour: Number.isFinite(hour) ? hour : 9,
      minute: Number.isFinite(minute) ? minute : 0,
      timeZone: browserTimeZone(),
      ...(state.recurrenceFrequency === "weekly" ? { dayOfWeek: state.recurrenceDayOfWeek } : {}),
      ...(state.recurrenceFrequency === "monthly" ? { dayOfMonth: state.recurrenceDayOfMonth } : {}),
    };
    return {
      scheduleType: "RECURRING",
      segmentRules: { followUpRecurrence, campaignKind: "followup" },
      cronExpression: buildCronFromRecurrence(followUpRecurrence),
      autoStart: false,
    };
  }

  return { scheduleType: "IMMEDIATE", autoStart: true };
}

interface Props {
  state: FollowUpScheduleState;
  onChange: (patch: Partial<FollowUpScheduleState>) => void;
  title?: string;
  showNow?: boolean;
  showRecurring?: boolean;
}

export function FollowUpScheduleFields({
  state,
  onChange,
  title,
  showNow = true,
  showRecurring = true,
}: Props) {
  const { t } = useI18n();

  const weekdayOptions = useMemo(
    () =>
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        value: d,
        label: t(`broadcastPage.followUpWeekday${d}` as "broadcastPage.followUpWeekday0"),
      })),
    [t],
  );

  const modes = (["now", "scheduled", "recurring"] as FollowUpScheduleMode[]).filter((m) => {
    if (m === "now" && !showNow) return false;
    if (m === "recurring" && !showRecurring) return false;
    return true;
  });

  return (
    <div>
      <h4 className="text-sm font-bold text-ink-900 dark:text-ink-50">
        {title ?? t("broadcastPage.followUpScheduleTitle")}
      </h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modes.map((mode) => (
          <ScheduleModeButton
            key={mode}
            mode={mode}
            active={state.scheduleMode === mode}
            onClick={() => onChange({ scheduleMode: mode })}
            t={t}
          />
        ))}
      </div>
      {state.scheduleMode === "scheduled" ? (
        <div className="mt-4">
          <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
            {t("broadcastPage.followUpDateTime")}
          </label>
          <input
            type="datetime-local"
            value={state.scheduledAt}
            onChange={(e) => onChange({ scheduledAt: e.target.value })}
            className="input mt-1 w-full max-w-sm"
          />
        </div>
      ) : null}
      {state.scheduleMode === "recurring" ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
              {t("broadcastPage.followUpRecurrenceFreq")}
            </label>
            <select
              className="input mt-1 w-full"
              value={state.recurrenceFrequency}
              onChange={(e) => onChange({ recurrenceFrequency: e.target.value as FollowUpRecurrenceFrequency })}
            >
              <option value="daily">{t("broadcastPage.followUpRecurrenceDaily")}</option>
              <option value="weekly">{t("broadcastPage.followUpRecurrenceWeekly")}</option>
              <option value="monthly">{t("broadcastPage.followUpRecurrenceMonthly")}</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
              {t("broadcastPage.followUpRecurrenceTime")}
            </label>
            <input
              type="time"
              value={state.recurrenceTime}
              onChange={(e) => onChange({ recurrenceTime: e.target.value })}
              className="input mt-1 w-full"
            />
          </div>
          {state.recurrenceFrequency === "weekly" ? (
            <div>
              <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                {t("broadcastPage.followUpRecurrenceWeekday")}
              </label>
              <select
                className="input mt-1 w-full"
                value={state.recurrenceDayOfWeek}
                onChange={(e) => onChange({ recurrenceDayOfWeek: Number(e.target.value) })}
              >
                {weekdayOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {state.recurrenceFrequency === "monthly" ? (
            <div>
              <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                {t("broadcastPage.followUpRecurrenceMonthDay")}
              </label>
              <select
                className="input mt-1 w-full"
                value={state.recurrenceDayOfMonth}
                onChange={(e) => onChange({ recurrenceDayOfMonth: Number(e.target.value) })}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {t("broadcastPage.followUpRecurrenceDayN").replace("{day}", String(d))}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="sm:col-span-2 text-xs text-ink-500">{t("broadcastPage.followUpRecurringNote")}</p>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleModeButton({
  mode,
  active,
  onClick,
  t,
}: {
  mode: FollowUpScheduleMode;
  active: boolean;
  onClick: () => void;
  t: (key: string) => string;
}) {
  const Icon = mode === "now" ? Send : mode === "scheduled" ? CalendarClock : Repeat;
  const label =
    mode === "now"
      ? t("broadcastPage.followUpSendNow")
      : mode === "scheduled"
        ? t("broadcastPage.followUpScheduleLater")
        : t("broadcastPage.followUpRecurring");
  const hint =
    mode === "now"
      ? t("broadcastPage.followUpSendNowHint")
      : mode === "scheduled"
        ? t("broadcastPage.followUpScheduleLaterHint")
        : t("broadcastPage.followUpRecurringHint");

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        active
          ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40"
          : "border-ink-200 hover:border-ink-300 dark:border-white/10",
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
      <div>
        <span className="text-sm font-bold text-ink-900 dark:text-ink-50">{label}</span>
        <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
      </div>
    </button>
  );
}
