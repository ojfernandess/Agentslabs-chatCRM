import clsx from "clsx";
import { CheckCircle2, LayoutGrid, Star } from "lucide-react";

type ToolsHubStatsBarProps = {
  t: (key: string) => string;
  availableCount: number;
  installedCount: number;
  favoritesCount: number;
  executedCount: number;
};

export function ToolsHubStatsBar({
  t,
  availableCount,
  installedCount,
  favoritesCount,
  executedCount,
}: ToolsHubStatsBarProps) {
  const cards = [
    {
      icon: LayoutGrid,
      tone: "brand" as const,
      value: String(availableCount),
      label: t("automationPage.toolsStatAvailable"),
    },
    {
      icon: CheckCircle2,
      tone: "green" as const,
      value: String(installedCount),
      label: t("automationPage.toolsStatInstalled"),
    },
    ...(executedCount > 0
      ? [
          {
            icon: Star,
            tone: "amber" as const,
            value: String(executedCount),
            label: t("automationPage.toolsStatExecuted"),
          },
        ]
      : []),
    ...(favoritesCount > 0
      ? [
          {
            icon: Star,
            tone: "sky" as const,
            value: String(favoritesCount),
            label: t("automationPage.toolsStatFavorites"),
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 dark:border-soft-border-muted dark:bg-soft-surface-2"
        >
          <div
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              card.tone === "brand" && "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
              card.tone === "green" && "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
              card.tone === "amber" && "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
              card.tone === "sky" && "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
            )}
          >
            <card.icon className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-lg font-bold tabular-nums text-[#0F172A] dark:text-soft-text">{card.value}</p>
            <p className="text-xs text-[#64748B] dark:text-soft-text-secondary">{card.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ToolsHubCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-[#E5E7EB] bg-white p-5 dark:border-soft-border-muted dark:bg-soft-surface-2">
      <div className="flex items-start justify-between gap-3">
        <div className="h-[52px] w-[52px] rounded-xl bg-[#E5E7EB] dark:bg-soft-surface-3" />
        <div className="h-8 w-8 rounded-lg bg-[#E5E7EB] dark:bg-soft-surface-3" />
      </div>
      <div className="mt-4 h-4 w-2/3 rounded bg-[#E5E7EB] dark:bg-soft-surface-3" />
      <div className="mt-2 h-3 w-full rounded bg-[#E5E7EB] dark:bg-soft-surface-3" />
      <div className="mt-2 h-3 w-5/6 rounded bg-[#E5E7EB] dark:bg-soft-surface-3" />
      <div className="mt-4 flex gap-2">
        <div className="h-6 w-16 rounded-md bg-[#E5E7EB] dark:bg-soft-surface-3" />
        <div className="h-6 w-20 rounded-md bg-[#E5E7EB] dark:bg-soft-surface-3" />
      </div>
      <div className="mt-4 h-9 w-full rounded-[10px] bg-[#E5E7EB] dark:bg-soft-surface-3" />
    </div>
  );
}
