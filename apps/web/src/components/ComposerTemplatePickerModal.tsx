import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import type { TemplateSendModalTemplate } from "@/components/TemplateSendModal";

export function ComposerTemplatePickerModal({
  open,
  templates,
  onClose,
  onSelect,
}: {
  open: boolean;
  templates: TemplateSendModalTemplate[];
  onClose: () => void;
  onSelect: (template: TemplateSendModalTemplate) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (tp) => tp.name.toLowerCase().includes(q) || tp.body.toLowerCase().includes(q),
    );
  }, [query, templates]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="composer-template-picker-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(85vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-800">
          <h2 id="composer-template-picker-title" className="text-base font-semibold text-ink-900 dark:text-ink-50">
            {t("conversationDetail.templatePickerTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("conversationDetail.templateSearchPlaceholder")}
              className="w-full rounded-xl border border-ink-200 bg-white py-2.5 pl-10 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-50"
              autoFocus
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {filtered.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-ink-500 dark:text-ink-400">
              {t("conversationDetail.templatePickerEmpty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((tp) => (
                <li key={tp.id}>
                  <button
                    type="button"
                    className={clsx(
                      "w-full rounded-xl border border-transparent px-4 py-3 text-left transition-colors",
                      "hover:border-ink-200 hover:bg-ink-50 dark:hover:border-ink-700 dark:hover:bg-ink-800/80",
                    )}
                    title={t("conversationDetail.pickTemplate")}
                    onClick={() => onSelect(tp)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold text-ink-900 dark:text-ink-50">{tp.name}</span>
                      {tp.bodyVariableCount > 0 ? (
                        <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:bg-brand-950/50 dark:text-brand-200">
                          {tp.bodyVariableCount} var
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                      {tp.body}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
