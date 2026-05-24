import { useEffect, useState, type FormEvent } from "react";
import { Loader2, X } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { api, ApiError } from "@/lib/api";
import { settingsInput, settingsLabel } from "@/components/settings/settingsUi";
import type { MessageTemplateRow } from "./MessageTemplatesTable";

interface Props {
  template: MessageTemplateRow | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EvolutionTemplateEditModal({ template, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setBody(template.body);
    setLanguage(template.templateLanguage ?? "pt_BR");
    setError("");
  }, [template]);

  if (!template) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.put(`/templates/${template.id}`, {
        name: name.trim(),
        body: body.trim(),
        templateLanguage: language.trim(),
        isApproved: true,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.evoTplEditFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{t("settings.evoTplEditTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-4">
          <div>
            <label className={settingsLabel}>{t("settings.evoTplName")}</label>
            <input className={settingsInput} value={name} onChange={(e) => setName(e.target.value)} required maxLength={512} />
          </div>
          <div>
            <label className={settingsLabel}>{t("settings.evoTplLanguage")}</label>
            <input className={settingsInput} value={language} onChange={(e) => setLanguage(e.target.value)} required maxLength={32} />
          </div>
          <div>
            <label className={settingsLabel}>{t("settings.evoTplBody")}</label>
            <textarea
              className={clsx(settingsInput, "min-h-[120px] font-mono text-sm")}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={4096}
            />
            <p className="mt-1 text-xs text-ink-500">{t("settings.evoTplVariablesHint")}</p>
          </div>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim() || !body.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
