import { useMemo, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { EIL_CATEGORIES, type EilCategoryId } from "@/lib/eil/eilCategories.js";
import type { EilCustomActionDef } from "@/lib/eil/types.js";

type Translate = (key: string) => string;

type Props = {
  open: boolean;
  locale: "pt" | "en";
  existingIds: Set<string>;
  t: Translate;
  onClose: () => void;
  onImport: (actions: EilCustomActionDef[]) => void;
};

export function EilImportActionsModal({ open, locale, existingIds, t, onClose, onImport }: Props) {
  const [sourceCategory, setSourceCategory] = useState<EilCategoryId>("customer_service");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);

  const sourceActions = useMemo(() => {
    const cat = EIL_CATEGORIES.find((c) => c.id === sourceCategory);
    return cat?.actions ?? [];
  }, [sourceCategory]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = () => {
    const imported: EilCustomActionDef[] = [];
    const skipped: string[] = [];
    for (const action of sourceActions) {
      if (!selected.has(action.id)) continue;
      if (existingIds.has(action.id)) {
        skipped.push(locale === "pt" ? action.labelPt : action.labelEn);
        continue;
      }
      imported.push({
        id: action.id,
        label: locale === "pt" ? action.labelPt : action.labelEn,
        description: locale === "pt" ? action.descriptionPt : action.descriptionEn,
        enabled: true,
      });
    }
    setWarnings(skipped.map((name) => t("automationPage.agentEilImportDuplicate").replace("{action}", name)));
    if (imported.length > 0) onImport(imported);
    if (imported.length > 0 || skipped.length === 0) onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-700">
          <h3 className="text-sm font-semibold">{t("automationPage.agentEilImportActionsTitle")}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-4">
          <label className="block text-[11px]">
            <span className="font-semibold">{t("automationPage.agentEilImportFromCategory")}</span>
            <select
              value={sourceCategory}
              onChange={(e) => {
                setSourceCategory(e.target.value as EilCategoryId);
                setSelected(new Set());
              }}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            >
              {EIL_CATEGORIES.filter((c) => c.id !== "custom").map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {locale === "pt" ? cat.labelPt : cat.labelEn}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            {sourceActions.map((action) => (
              <label
                key={action.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-700"
              >
                <input
                  type="checkbox"
                  checked={selected.has(action.id)}
                  onChange={() => toggle(action.id)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-semibold">{locale === "pt" ? action.labelPt : action.labelEn}</span>
                  <span className="block font-mono text-[10px] text-ink-500">{action.id}</span>
                </span>
              </label>
            ))}
          </div>

          {warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30">
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-ink-100 px-4 py-3 dark:border-ink-700">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border px-3 py-2 text-xs font-semibold dark:border-ink-600">
            {t("automationPage.cancel")}
          </button>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={handleImport}
            className={clsx(
              "flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white",
              selected.size === 0 ? "bg-brand-400/60" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {t("automationPage.agentEilImportActionsConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
