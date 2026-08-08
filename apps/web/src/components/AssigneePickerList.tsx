import { useMemo, useState } from "react";
import clsx from "clsx";
import { Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useI18n } from "@/i18n/I18nProvider";
import { resolveUserAvatarUrl } from "@/lib/userAvatar";
import {
  availabilityDotClass,
  availabilityLabelKey,
  isOnlineForTransfer,
  type UserAvailability,
} from "@/lib/userAvailability";

export type AssigneePickerRow = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  availabilityStatus: UserAvailability;
  openConversationCount?: number;
  availabilityUpdatedAt?: string | null;
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function availabilityPillClass(status: UserAvailability): string {
  if (status === "online") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800/50";
  }
  if (status === "away") {
    return "bg-amber-50 text-amber-800 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/50";
  }
  return "bg-ink-100 text-ink-600 ring-ink-200/80 dark:bg-ink-800/60 dark:text-ink-300 dark:ring-ink-700/50";
}

type AssigneePickerListProps = {
  rows: AssigneePickerRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  searchPlaceholder?: string;
  listTitle?: string;
  onlineOnly?: boolean;
};

export function AssigneePickerList({
  rows,
  selectedId,
  onSelect,
  allowEmpty = false,
  emptyLabel,
  searchPlaceholder,
  listTitle,
  onlineOnly = true,
}: AssigneePickerListProps) {
  const { t, dateLocale } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q));
  }, [query, rows]);

  const subtitleFor = (row: AssigneePickerRow): string | null => {
    if (row.availabilityStatus === "online") {
      const count = row.openConversationCount ?? 0;
      const key =
        count === 1
          ? "conversationDetail.transferAttendingOne"
          : "conversationDetail.transferAttendingMany";
      return t(key).replace("{count}", String(count));
    }
    if (row.availabilityUpdatedAt) {
      const time = formatDistanceToNow(new Date(row.availabilityUpdatedAt), {
        locale: dateLocale,
        addSuffix: true,
      });
      return t("conversationDetail.transferLastActivity").replace("{time}", time);
    }
    return null;
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder ?? t("conversationDetail.transferSearchPlaceholder")}
          className="w-full rounded-xl border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100 dark:placeholder:text-ink-500"
        />
      </div>

      {listTitle ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          {listTitle}
        </p>
      ) : null}

      <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
        {allowEmpty ? (
          <button
            type="button"
            onClick={() => onSelect("")}
            className={clsx(
              "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
              selectedId === ""
                ? "border-brand-500 bg-brand-50/40 ring-1 ring-brand-500/30 dark:border-brand-500 dark:bg-brand-950/20"
                : "border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900 dark:hover:border-ink-600",
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              —
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium text-ink-800 dark:text-ink-100">
              {emptyLabel ?? t("conversationDetail.transferAssigneeNone")}
            </span>
            <SelectionDot selected={selectedId === ""} />
          </button>
        ) : null}

        {filtered.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-ink-500 dark:text-ink-400">
            {t("conversationDetail.transferNoAgentsFound")}
          </p>
        ) : (
          filtered.map((row) => {
            const online = isOnlineForTransfer(row.availabilityStatus);
            const disabled = onlineOnly && !online;
            const selected = selectedId === row.id;
            const avatarSrc = resolveUserAvatarUrl(row.avatarUrl);
            const subtitle = subtitleFor(row);

            return (
              <button
                key={row.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(row.id)}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                  selected
                    ? "border-brand-500 bg-brand-50/40 ring-1 ring-brand-500/30 dark:border-brand-500 dark:bg-brand-950/20"
                    : "border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900 dark:hover:border-ink-600",
                  disabled && "cursor-not-allowed opacity-60 hover:border-ink-200 dark:hover:border-ink-700",
                )}
              >
                <span className="relative shrink-0">
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover ring-2 ring-white dark:ring-ink-900"
                    />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
                      {initialsFromName(row.name)}
                    </span>
                  )}
                  <span
                    className={clsx(
                      "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white dark:ring-ink-900",
                      availabilityDotClass(row.availabilityStatus),
                    )}
                    aria-hidden
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-900 dark:text-ink-50">
                    {row.name}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={clsx(
                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                        availabilityPillClass(row.availabilityStatus),
                      )}
                    >
                      {t(availabilityLabelKey(row.availabilityStatus))}
                    </span>
                    {subtitle ? (
                      <>
                        <span className="text-[11px] text-ink-400" aria-hidden>
                          |
                        </span>
                        <span className="text-[11px] text-ink-500 dark:text-ink-400">{subtitle}</span>
                      </>
                    ) : null}
                  </span>
                </span>

                <SelectionDot selected={selected} disabled={disabled} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function SelectionDot({ selected, disabled }: { selected: boolean; disabled?: boolean }) {
  return (
    <span
      className={clsx(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
        selected
          ? "border-brand-500 bg-brand-500"
          : "border-ink-300 bg-white dark:border-ink-600 dark:bg-ink-900",
        disabled && !selected && "opacity-70",
      )}
      aria-hidden
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
    </span>
  );
}
