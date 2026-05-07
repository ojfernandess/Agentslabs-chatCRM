import { useEffect, useState } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export interface TemplateSendModalTemplate {
  id: string;
  name: string;
  body: string;
  bodyVariableCount: number;
  metaCategory?: string | null;
}

function applyVariables(body: string, values: string[]): string {
  let out = body;
  for (let i = 0; i < values.length; i++) {
    const re = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g");
    out = out.replace(re, values[i] ?? "");
  }
  return out;
}

function categoryLabel(category: string | null | undefined, t: (k: string) => string): string | null {
  if (!category) return null;
  const u = category.toUpperCase();
  if (u === "UTILITY") return t("templateModal.categoryUtility");
  if (u === "MARKETING") return t("templateModal.categoryMarketing");
  if (u === "AUTHENTICATION") return t("templateModal.categoryAuthentication");
  return category;
}

export function TemplateSendModal(props: {
  open: boolean;
  template: TemplateSendModalTemplate | null;
  contactId: string;
  conversationId?: string;
  onClose: () => void;
  onSent: () => void | Promise<void>;
}) {
  const { open, template, contactId, conversationId, onClose, onSent } = props;
  const { t } = useI18n();
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!template) {
      setValues([]);
      return;
    }
    setValues(Array.from({ length: Math.max(0, template.bodyVariableCount) }, () => ""));
    setError("");
  }, [template]);

  if (!open || !template) return null;

  const preview = applyVariables(template.body, values);
  const cat = categoryLabel(template.metaCategory, t);

  const send = async () => {
    for (let i = 0; i < template.bodyVariableCount; i++) {
      if (!values[i]?.trim()) {
        setError(t("templateModal.fillAll"));
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      await api.post("/messages", {
        contactId,
        ...(conversationId ? { conversationId } : {}),
        type: "TEMPLATE",
        templateId: template.id,
        ...(template.bodyVariableCount > 0 ? { templateBodyParameters: values.map((v) => v.trim()) } : {}),
      });
      await onSent();
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("templateModal.sendFailed");
      setError(msg || t("templateModal.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
        <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("templateModal.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-6 p-4 md:grid-cols-2 md:gap-8 md:p-6">
            <div>
              <p className="text-sm text-ink-600 dark:text-ink-400">{t("templateModal.fillHint")}</p>
              <p className="mt-1 text-xs font-medium text-ink-800 dark:text-ink-200">{template.name}</p>
              <div className="mt-4 space-y-3">
                {template.bodyVariableCount === 0 ? (
                  <p className="text-sm text-ink-500 dark:text-ink-500">{t("templateModal.noVariables")}</p>
                ) : (
                  Array.from({ length: template.bodyVariableCount }, (_, i) => (
                    <div key={i}>
                      <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                        {t("templateModal.bodyVar").replace("{n}", String(i + 1))}
                      </label>
                      <input
                        value={values[i] ?? ""}
                        onChange={(e) => {
                          const next = [...values];
                          next[i] = e.target.value;
                          setValues(next);
                        }}
                        className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                        maxLength={4096}
                      />
                    </div>
                  ))
                )}
              </div>
              {error ? (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="btn-primary mt-6 w-full py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? t("templateModal.sending") : t("templateModal.send")}
              </button>
            </div>

            <div>
              <p className="text-sm font-medium text-ink-700 dark:text-ink-300">{t("templateModal.preview")}</p>
              <div className="mt-3 space-y-2">
                {cat ? (
                  <span className="inline-block rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                    {cat}
                  </span>
                ) : null}
                <div
                  className={clsx(
                    "rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm text-ink-900 shadow-sm",
                    "dark:bg-emerald-900/40 dark:text-ink-100",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{preview || "—"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
