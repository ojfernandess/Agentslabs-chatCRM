import clsx from "clsx";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { IntegrationVisual } from "./integrationVisualRegistry";

type IntegrationBrandLogoProps = {
  visual: IntegrationVisual;
  size?: "sm" | "md";
  className?: string;
};

export function IntegrationBrandLogo({ visual, size = "md", className }: IntegrationBrandLogoProps) {
  const box =
    size === "sm"
      ? "h-10 w-10 rounded-[10px] p-1.5"
      : "h-[52px] w-[52px] rounded-xl p-2";

  if (visual.logoUrl) {
    return (
      <div
        className={clsx(
          "flex shrink-0 items-center justify-center border border-[#E5E7EB] bg-white dark:border-soft-border-muted dark:bg-soft-surface-2",
          box,
          className,
        )}
      >
        <img
          src={visual.logoUrl}
          alt={visual.logoAlt}
          draggable={false}
          className={clsx(
            "object-contain",
            visual.wideLogo ? "h-5 w-auto max-w-[4.5rem]" : "h-7 w-7 max-h-full max-w-full",
          )}
        />
      </div>
    );
  }

  const Cmp =
    (LucideIcons as unknown as Record<string, LucideIcon>)[visual.icon] ?? LucideIcons.Plug;

  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center border border-[#E5E7EB] bg-[#F8FAFC] text-brand-600 dark:border-soft-border-muted dark:bg-soft-surface-3 dark:text-brand-300",
        box,
        className,
      )}
    >
      <Cmp className={size === "sm" ? "h-5 w-5" : "h-6 w-6"} strokeWidth={1.75} aria-hidden />
    </div>
  );
}
