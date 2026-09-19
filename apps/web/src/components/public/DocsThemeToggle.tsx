import { Moon, Sun } from "lucide-react";
import clsx from "clsx";
import type { DocsTheme } from "@/lib/docsThemeStorage";

type DocsThemeToggleProps = {
  theme: DocsTheme;
  onChange: (theme: DocsTheme) => void;
  lightLabel: string;
  darkLabel: string;
  ariaLabel: string;
  className?: string;
};

export function DocsThemeToggle({
  theme,
  onChange,
  lightLabel,
  darkLabel,
  ariaLabel,
  className,
}: DocsThemeToggleProps) {
  return (
    <div
      className={clsx(
        "inline-flex items-center rounded-lg border border-ink-200/90 bg-white/90 p-0.5 shadow-sm dark:border-ink-700 dark:bg-ink-900/90",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-pressed={theme === "light"}
        title={lightLabel}
        onClick={() => onChange("light")}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
          theme === "light"
            ? "bg-brand-600 text-white shadow-sm"
            : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800",
        )}
      >
        <Sun className="h-3.5 w-3.5" />
        {lightLabel}
      </button>
      <button
        type="button"
        aria-pressed={theme === "dark"}
        title={darkLabel}
        onClick={() => onChange("dark")}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
          theme === "dark"
            ? "bg-brand-600 text-white shadow-sm"
            : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800",
        )}
      >
        <Moon className="h-3.5 w-3.5" />
        {darkLabel}
      </button>
    </div>
  );
}
