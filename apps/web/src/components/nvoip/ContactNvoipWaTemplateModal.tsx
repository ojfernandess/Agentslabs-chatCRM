import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type WaTemplate = {
  id: string;
  name: string;
  language: string | null;
  category: string | null;
  body: string | null;
  variableCount: number;
};

function applyVariables(body: string, values: string[]): string {
  let out = body;
  for (let i = 0; i < values.length; i++) {
    const re = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g");
    out = out.replace(re, values[i] ?? "");
  }
  return out;
}

export function ContactNvoipWaTemplateModal({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact: { id: string; name: string; phone: string } | null;
}) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const selected = templates.find((tpl) => tpl.id === selectedId) ?? null;

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: WaTemplate[] }>("/nvoip/whatsapp/templates");
      setTemplates(res.data ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.whatsapp.loadError"));
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    setValues([]);
    setError(null);
    setOk(false);
    void loadTemplates();
  }, [open, contact?.id, loadTemplates]);

  useEffect(() => {
    if (!selected) {
      setValues([]);
      return;
    }
    setValues(Array.from({ length: Math.max(0, selected.variableCount) }, () => ""));
  }, [selected?.id, selected?.variableCount]);

  const send = async () => {
    if (!contact || !selected) return;
    for (let i = 0; i < selected.variableCount; i++) {
      if (!values[i]?.trim()) {
        setError(t("nvoip.whatsapp.fillAll"));
        return;
      }
    }
    setSending(true);
    setError(null);
    try {
      await api.post(`/contacts/${contact.id}/nvoip/whatsapp/template`, {
        idTemplate: selected.id,
        templateName: selected.name,
        ...(selected.variableCount > 0
          ? { functions: values.map((v) => v.trim()) }
          : {}),
        ...(selected.language ? { language: selected.language } : {}),
      });
      setOk(true);
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("nvoip.whatsapp.sendError"));
    } finally {
      setSending(false);
    }
  };

  const preview = selected?.body ? applyVariables(selected.body, values) : "";

  return (
    <AnimatePresence>
      {open && contact ? (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            <div
              className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-ink-800 dark:bg-ink-950"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-100 px-4 py-3 dark:border-ink-800">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <MessageCircle className="h-5 w-5" />
                  {t("nvoip.whatsapp.modalTitle")}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {contact.name} · {contact.phone}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
                {ok ? <p className="mb-2 text-sm text-emerald-600">{t("nvoip.whatsapp.sendSuccess")}</p> : null}
                {loading ? (
                  <p className="text-sm text-slate-500">{t("common.loading")}</p>
                ) : templates.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("nvoip.whatsapp.noTemplates")}</p>
                ) : (
                  <>
                    <label className="block text-sm">
                      <span className="font-medium">{t("nvoip.whatsapp.pickTemplate")}</span>
                      <select
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-900"
                      >
                        <option value="">{t("nvoip.whatsapp.pickPlaceholder")}</option>
                        {templates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name}
                            {tpl.language ? ` (${tpl.language})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selected && selected.variableCount > 0 ? (
                      <div className="mt-3 space-y-2">
                        {values.map((v, i) => (
                          <label key={i} className="block text-sm">
                            <span className="font-medium">
                              {t("nvoip.whatsapp.variable")} {i + 1}
                            </span>
                            <input
                              value={v}
                              onChange={(e) => {
                                const next = [...values];
                                next[i] = e.target.value;
                                setValues(next);
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-900"
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                    {preview ? (
                      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-ink-900 dark:text-ink-200">
                        {preview}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-ink-800">
                <button type="button" className="btn-ghost text-sm" onClick={onClose}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={sending || !selected}
                  onClick={() => void send()}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.whatsapp.send")}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
