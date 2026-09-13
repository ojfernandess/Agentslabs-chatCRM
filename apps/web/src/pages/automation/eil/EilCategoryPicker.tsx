import { useMemo, useState } from "react";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { EIL_CATEGORIES, type EilCategoryId } from "@/lib/eil/eilCategories.js";
import { EilCategoryIcon } from "./EilCategoryIcon.js";

type Translate = (key: string) => string;

type Props = {
  open: boolean;
  currentCategoryId: EilCategoryId | null;
  locale: "pt" | "en";
  t: Translate;
  onClose: () => void;
  onSelect: (categoryId: EilCategoryId) => void;
};

export function EilCategoryPicker({ open, currentCategoryId, locale, t, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EIL_CATEGORIES;
    return EIL_CATEGORIES.filter((cat) => {
      const label = locale === "pt" ? cat.labelPt : cat.labelEn;
      const desc = locale === "pt" ? cat.descriptionPt : cat.descriptionEn;
      return label.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || cat.id.includes(q);
    });
  }, [query, locale]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900">
        <div className="flex items-start justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-700">
          <div>
            <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("automationPage.agentEilCategoryPickerTitle")}</h3>
            <p className="mt-1 text-xs text-ink-500">{t("automationPage.agentEilCategoryPickerSubtitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-ink-100 px-5 py-3 dark:border-ink-700">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("automationPage.agentEilCategorySearch")}
              className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-xs dark:border-ink-600 dark:bg-ink-950"
              autoFocus
            />
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((cat) => {
              const selected = currentCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    onSelect(cat.id);
                    onClose();
                  }}
                  className={clsx(
                    "rounded-xl border p-4 text-left transition-colors",
                    selected
                      ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/30"
                      : "border-ink-200 hover:border-brand-300 hover:bg-ink-50 dark:border-ink-700 dark:hover:border-brand-700 dark:hover:bg-ink-800/50",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-violet-100 p-2 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                      <EilCategoryIcon name={cat.icon} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                        {locale === "pt" ? cat.labelPt : cat.labelEn}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                        {locale === "pt" ? cat.descriptionPt : cat.descriptionEn}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-500">{t("automationPage.agentEilCategoryNoResults")}</p>
          ) : null}
        </div>

        <div className="border-t border-ink-100 px-5 py-3 dark:border-ink-700">
          <p className="text-[11px] text-ink-500">{t("automationPage.agentEilCategoryChangeWarning")}</p>
        </div>
      </div>
    </div>
  );
}
