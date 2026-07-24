import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Download, Loader2, Save, Settings2 } from "lucide-react";
import { api } from "@/lib/api";

type OrgMemoryConfig = {
  mem0Enabled: boolean;
  provider: "openconduit" | "mem0";
  maxMemories: number;
  retentionDays: number;
  minScore: number;
  minConfidence: number;
  autoSummarize: boolean;
  autoCleanup: boolean;
};

export function MemoryAdminPanel({ t }: { t: (key: string) => string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<OrgMemoryConfig | null>(null);
  const [mem0Configured, setMem0Configured] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{
        data: { config: OrgMemoryConfig; mem0Configured: boolean };
      }>("/automation/memory-engine/admin");
      setConfig(res.data.config);
      setMem0Configured(res.data.mem0Configured);
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      await api.patch("/automation/memory-engine/admin", config);
      await load();
    } catch {
      setError("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const exportGlobal = async () => {
    try {
      const res = await fetch("/api/automation/memory-engine/global/export", { credentials: "include" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "memory-engine-global.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("export_failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("automationPage.memoryAdminLoading")}
      </div>
    );
  }

  if (!config) {
    return <p className="text-sm text-red-600">{t("automationPage.memoryAdminError")}</p>;
  }

  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/20 p-4 dark:border-amber-900/40 dark:bg-amber-950/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="inline-flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
            <Settings2 className="h-4 w-4 text-amber-600" />
            {t("automationPage.memoryAdminTitle")}
          </h4>
          <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.memoryAdminHelp")}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void exportGlobal()}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-semibold dark:border-ink-700"
          >
            <Download className="h-3.5 w-3.5" />
            {t("automationPage.memoryAdminExport")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t("automationPage.memoryAdminSave")}
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600">{t("automationPage.memoryAdminError")}</p> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.mem0Enabled}
            onChange={(e) => setConfig({ ...config, mem0Enabled: e.target.checked })}
          />
          {t("automationPage.memoryAdminMem0Enabled")}
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.memoryAdminProvider")}</span>
          <select
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.provider}
            onChange={(e) =>
              setConfig({ ...config, provider: e.target.value === "mem0" ? "mem0" : "openconduit" })
            }
          >
            <option value="openconduit">{t("automationPage.agentEngineMemory_openconduit")}</option>
            <option value="mem0">{t("automationPage.agentEngineMemory_mem0")}</option>
          </select>
        </label>
        <p className="text-[11px] text-ink-500">
          Mem0 API: {mem0Configured ? t("automationPage.memoryAdminMem0Ok") : t("automationPage.memoryAdminMem0Missing")}
        </p>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.memoryEngineMaxMemories")}</span>
          <input
            type="number"
            min={10}
            max={500}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.maxMemories}
            onChange={(e) => setConfig({ ...config, maxMemories: Number(e.target.value) || 100 })}
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">{t("automationPage.memoryAdminRetention")}</span>
          <input
            type="number"
            min={1}
            max={3650}
            className="w-full rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={config.retentionDays}
            onChange={(e) => setConfig({ ...config, retentionDays: Number(e.target.value) || 365 })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.autoSummarize}
            onChange={(e) => setConfig({ ...config, autoSummarize: e.target.checked })}
          />
          {t("automationPage.memoryAdminAutoSummarize")}
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.autoCleanup}
            onChange={(e) => setConfig({ ...config, autoCleanup: e.target.checked })}
          />
          {t("automationPage.memoryAdminAutoCleanup")}
        </label>
      </div>
    </div>
  );
}
