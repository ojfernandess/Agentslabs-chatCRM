import { useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, ApiError } from "@/lib/api";

type ImportResult = {
  ok: boolean;
  mode: string;
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  warnings: string[];
};

type Props = {
  onImported?: () => void;
};

export function AutomationConfigTransferPanel({ onImported }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");

  const exportConfig = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const bundle = await api.get<Record<string, unknown>>("/automation/config/export");
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `openconduit-automation-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("automationPage.configTransferExportFailed"));
    } finally {
      setBusy(false);
    }
  };

  const importConfig = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as Record<string, unknown>;
      if (!bundle.config || typeof bundle.config !== "object") {
        setError(t("automationPage.configTransferInvalid"));
        return;
      }
      const res = await api.post<ImportResult>("/automation/config/import", {
        ...bundle,
        mode: importMode,
      });
      setResult(res);
      onImported?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("automationPage.configTransferImportFailed"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const summaryLines = (bucket: Record<string, number> | undefined) =>
    Object.entries(bucket ?? {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(", ");

  return (
    <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900/60">
      <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
        {t("automationPage.configTransferTitle")}
      </h3>
      <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
        {t("automationPage.configTransferHint")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportConfig()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {t("automationPage.configTransferExport")}
        </button>

        <label className="inline-flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300">
          <span>{t("automationPage.configTransferMode")}</span>
          <select
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as "merge" | "replace")}
            className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs dark:border-ink-700 dark:bg-ink-800"
          >
            <option value="merge">{t("automationPage.configTransferModeMerge")}</option>
            <option value="replace">{t("automationPage.configTransferModeReplace")}</option>
          </select>
        </label>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importConfig(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-60 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {t("automationPage.configTransferImport")}
        </button>
      </div>

      {importMode === "replace" ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {t("automationPage.configTransferReplaceWarning")}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-700 dark:bg-ink-800/50 dark:text-ink-200">
          <p className="font-semibold">{t("automationPage.configTransferImportDone")}</p>
          {summaryLines(result.created) ? (
            <p className="mt-1">
              {t("automationPage.configTransferCreated")}: {summaryLines(result.created)}
            </p>
          ) : null}
          {summaryLines(result.updated) ? (
            <p className="mt-1">
              {t("automationPage.configTransferUpdated")}: {summaryLines(result.updated)}
            </p>
          ) : null}
          {result.warnings.length > 0 ? (
            <p className="mt-1 text-amber-700 dark:text-amber-300">{result.warnings.join("; ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
