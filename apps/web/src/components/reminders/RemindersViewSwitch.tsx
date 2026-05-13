import clsx from "clsx";
import type { ReactNode } from "react";

export type RemindersViewMode = "list" | "kanban" | "agenda" | "calendar";

type ViewOption = {
  key: RemindersViewMode;
  label: ReactNode;
};

export function RemindersViewSwitch(props: {
  value: RemindersViewMode;
  onChange: (value: RemindersViewMode) => void;
  options: ViewOption[];
}) {
  const { value, onChange, options } = props;
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={clsx(
            "min-h-11 px-3 text-sm font-semibold transition-colors",
            value === opt.key
              ? "bg-brand-500 text-white"
              : "text-ink-600 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

