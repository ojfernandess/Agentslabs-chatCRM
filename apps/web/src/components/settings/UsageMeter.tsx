import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

type UsageMeterProps = {
  label: string;
  icon: LucideIcon;
  used: number;
  limit: number | null;
  renewLabel?: string | null;
  className?: string;
};

function formatLimit(limit: number | null): string {
  if (limit === null) return "∞";
  return limit.toLocaleString();
}

export function UsageMeter({ label, icon: Icon, used, limit, renewLabel, className }: UsageMeterProps) {
  const unlimited = limit === null;
  const pct =
    unlimited || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const remaining = unlimited ? null : Math.max(0, limit - used);

  return (
    <div
      className={clsx(
        "rounded-xl border border-ink-200 bg-white p-4 dark:border-soft-border dark:bg-soft-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
          {label}
        </span>
        {!unlimited ? (
          <span className="text-sm font-bold text-brand-700 dark:text-brand-300">{pct}%</span>
        ) : null}
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-500",
            unlimited ? "w-0 bg-brand-400" : "bg-brand-600 dark:bg-brand-500",
          )}
          style={{ width: unlimited ? "0%" : `${Math.max(pct, used > 0 ? 4 : 0)}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2 text-ink-800 dark:text-ink-100">
          <Icon className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          <span>
            <span className="font-semibold">{used.toLocaleString()}</span>
            <span className="text-ink-500 dark:text-ink-400"> de {formatLimit(limit)}</span>
          </span>
        </div>
        {remaining !== null || renewLabel ? (
          <span className="text-xs text-ink-500 dark:text-ink-400">
            {remaining !== null ? `${remaining.toLocaleString()} restantes` : null}
            {remaining !== null && renewLabel ? " · " : null}
            {renewLabel ?? null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
