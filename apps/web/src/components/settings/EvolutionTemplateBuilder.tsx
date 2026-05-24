import { useEffect, useMemo, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Eye, Loader2, Plus, Send } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, ApiError } from "@/lib/api";
import {
  extractBodyPlaceholderIndices,
  maxBodyPlaceholderIndex,
  normalizeTemplateNameInput,
  substituteBodyPlaceholders,
} from "@/lib/templatePreview";
import {
  settingsCard,
  settingsInput,
  settingsLabel,
  settingsMuted,
  settingsTitle,
} from "@/components/settings/settingsUi";

export interface EvolutionTemplateInboxOption {
  id: string;
  name: string;
  provider: "evolution" | "evolution_go";
}

interface Props {
  inboxes: EvolutionTemplateInboxOption[];
  onCreated: (inboxId: string) => void;
}

export function EvolutionTemplateBuilder({ inboxes, onCreated }: Props) {
  const { t } = useI18n();
  const [inboxId, setInboxId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("UTILITY");
  const [language, setLanguage] = useState("pt_BR");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [previewValues, setPreviewValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successMode, setSuccessMode] = useState<"created" | "local_only">("created");

  useEffect(() => {
    if (inboxes.length === 0) {
      setInboxId("");
      return;
    }
    setInboxId((prev) => (prev && inboxes.some((i) => i.id === prev) ? prev : inboxes[0].id));
  }, [inboxes]);

  const placeholderIndices = useMemo(() => extractBodyPlaceholderIndices(body), [body]);

  useEffect(() => {
    setPreviewValues((prev) => {
      const next: Record<number, string> = {};
      for (const idx of placeholderIndices) {
        next[idx] = prev[idx] ?? t("settings.evoTplPreviewSample").replace("{n}", String(idx));
      }
      return next;
    });
  }, [placeholderIndices.join(","), t]);

  const previewBody = useMemo(() => substituteBodyPlaceholders(body, previewValues), [body, previewValues]);
  const previewFooter = useMemo(
    () => (footer.trim() ? substituteBodyPlaceholders(footer, previewValues) : ""),
    [footer, previewValues],
  );

  const normalizedName = normalizeTemplateNameInput(name);
  const nameOk = normalizedName.length > 0;
  const bodyOk = body.trim().length > 0;
  const canSubmit = nameOk && bodyOk && Boolean(inboxId);

  const insertVariable = () => {
    const next = maxBodyPlaceholderIndex(body) + 1;
    const token = `{{${next}}}`;
    setBody((prev) => (prev.trim() ? `${prev.trim()} ${token}` : token));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    setSuccess(false);
    try {
      const variableSamples =
        placeholderIndices.length > 0
          ? placeholderIndices.map((idx) => previewValues[idx]?.trim() || `exemplo_${idx}`)
          : undefined;
      const created = await api.post<{ evolutionUpstream?: "created" | "local_only" }>("/templates/evolution", {
        inboxId,
        name: normalizedName,
        category,
        language: language.trim(),
        body: body.trim(),
        ...(footer.trim() ? { footer: footer.trim() } : {}),
        ...(variableSamples ? { variableSamples } : {}),
      });
      setSuccessMode(created.evolutionUpstream === "local_only" ? "local_only" : "created");
      setSuccess(true);
      setName("");
      setBody("");
      setFooter("");
      setPreviewValues({});
      onCreated(inboxId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.evoTplFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={settingsCard}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={settingsTitle}>{t("settings.templatesEvolutionTitle")}</h3>
          <p className={clsx("mt-1", settingsMuted)}>{t("settings.templatesEvolutionHint")}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
          <Eye className="h-3.5 w-3.5" />
          {t("settings.evoTplBuilderBadge")}
        </span>
      </div>

      {inboxes.length > 1 ? (
        <div className="mb-4">
          <label className={settingsLabel}>{t("settings.templatesEvolutionInboxLabel")}</label>
          <select className={settingsInput} value={inboxId} onChange={(e) => setInboxId(e.target.value)}>
            {inboxes.map((inbox) => (
              <option key={inbox.id} value={inbox.id}>
                {inbox.name} —{" "}
                {inbox.provider === "evolution_go"
                  ? t("settings.templatesEvolutionGoProvider")
                  : t("settings.templatesEvolutionApiProvider")}
              </option>
            ))}
          </select>
        </div>
      ) : inboxes.length === 1 ? (
        <p className={clsx("mb-4 text-xs", settingsMuted)}>
          {t("settings.templatesEvolutionInboxSingle").replace("{name}", inboxes[0].name)}
        </p>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className={settingsLabel}>{t("settings.evoTplName")}</label>
            <input
              className={settingsInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="confirmacao_pedido"
              maxLength={512}
            />
            {name.trim() && !nameOk ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("settings.evoTplNameInvalid")}</p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={settingsLabel}>{t("settings.evoTplCategory")}</label>
              <select
                className={settingsInput}
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                <option value="UTILITY">UTILITY</option>
                <option value="MARKETING">MARKETING</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
              </select>
            </div>
            <div>
              <label className={settingsLabel}>{t("settings.evoTplLanguage")}</label>
              <input
                className={settingsInput}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="pt_BR"
                maxLength={32}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className={settingsLabel}>{t("settings.evoTplBody")}</label>
              <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={insertVariable}>
                <Plus className="h-3.5 w-3.5" />
                {t("settings.evoTplInsertVariable")}
              </button>
            </div>
            <textarea
              className={clsx(settingsInput, "min-h-[140px] font-mono text-sm")}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("settings.evoTplBodyPlaceholder")}
              maxLength={4096}
            />
            <p className={clsx("mt-1", settingsMuted)}>{t("settings.evoTplVariablesHint")}</p>
          </div>
          <div>
            <label className={settingsLabel}>{t("settings.evoTplFooter")}</label>
            <input
              className={settingsInput}
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              maxLength={160}
              placeholder={t("settings.evoTplFooterPlaceholder")}
            />
          </div>
          {placeholderIndices.length > 0 ? (
            <div className="rounded-xl border border-ink-200/80 bg-ink-50/80 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs font-semibold text-ink-700 dark:text-ink-300">{t("settings.evoTplTestVariables")}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {placeholderIndices.map((idx) => (
                  <div key={idx}>
                    <label className="text-xs text-ink-500">{`{{${idx}}}`}</label>
                    <input
                      className={clsx(settingsInput, "mt-1")}
                      value={previewValues[idx] ?? ""}
                      onChange={(e) => setPreviewValues((prev) => ({ ...prev, [idx]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("settings.evoTplPreviewTitle")}</p>
          <div className="flex flex-1 flex-col rounded-2xl border border-ink-200/80 bg-[#e5ddd5] p-4 dark:border-white/10 dark:bg-[#0b141a]/80">
            <div className="mx-auto w-full max-w-[280px] flex-1">
              <div className="rounded-lg rounded-tl-none bg-[#dcf8c6] px-3 py-2 text-sm text-ink-900 shadow-sm dark:bg-emerald-900/40 dark:text-ink-50">
                <p className="whitespace-pre-wrap break-words">{previewBody || t("settings.evoTplPreviewEmpty")}</p>
                {previewFooter ? (
                  <p className="mt-2 border-t border-ink-900/10 pt-2 text-xs text-ink-600 dark:border-white/10 dark:text-ink-300">
                    {previewFooter}
                  </p>
                ) : null}
              </div>
              <p className="mt-2 text-center text-[10px] text-ink-600 dark:text-ink-400">
                {normalizedName || "template_name"} · {language} · {category}
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          {error ? (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="mb-3 text-sm text-green-700 dark:text-green-400" role="status">
              {successMode === "local_only" ? t("settings.evoTplSuccessLocalOnly") : t("settings.evoTplSuccess")}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {busy ? t("common.loading") : t("settings.evoTplSubmit")}
          </button>
        </div>
      </form>
    </div>
  );
}
