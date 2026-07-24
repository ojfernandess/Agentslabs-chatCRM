import clsx from "clsx";
import { Brain, Cpu, Gauge, History, ShieldCheck } from "lucide-react";

export type AgentEngineRuntimeOption =
  | "openconduit"
  | "langgraph"
  | "crewai"
  | "autogen"
  | "mastra";

export type AgentEngineMemoryOption = "openconduit" | "mem0";
export type AgentEngineObservabilityOption = "basic" | "full";

export type MemoryEngineFormValues = {
  provider: AgentEngineMemoryOption;
  intelligentMemoryEnabled: boolean;
  autoSaveEnabled: boolean;
  rememberPreferences: boolean;
  rememberCommercialHistory: boolean;
  rememberTechnicalData: boolean;
  ignoreCasualConversations: boolean;
  maxMemories: number;
};

export type AgentEngineFormValues = {
  runtime: AgentEngineRuntimeOption;
  memory: AgentEngineMemoryOption;
  memoryEngine: MemoryEngineFormValues;
  supervisorEnabled: boolean;
  strictMode: boolean;
  observability: AgentEngineObservabilityOption;
};

export const defaultMemoryEngineFormValues = (): MemoryEngineFormValues => ({
  provider: "openconduit",
  intelligentMemoryEnabled: true,
  autoSaveEnabled: true,
  rememberPreferences: true,
  rememberCommercialHistory: true,
  rememberTechnicalData: true,
  ignoreCasualConversations: true,
  maxMemories: 100,
});

type Props = {
  value: AgentEngineFormValues;
  onChange: (next: AgentEngineFormValues) => void;
  promptScore?: number | null;
  onValidatePrompt?: () => void;
  validatingPrompt?: boolean;
  t: (key: string) => string;
};

const RUNTIMES: Array<{ id: AgentEngineRuntimeOption; future?: boolean }> = [
  { id: "openconduit" },
  { id: "langgraph" },
  { id: "crewai" },
  { id: "autogen" },
  { id: "mastra" },
];

export function AgentEnginePanel({
  value,
  onChange,
  promptScore,
  onValidatePrompt,
  validatingPrompt,
  t,
}: Props) {
  const patch = (p: Partial<AgentEngineFormValues>) => onChange({ ...value, ...p });
  const patchMemory = (p: Partial<MemoryEngineFormValues>) =>
    onChange({
      ...value,
      memory: p.provider ?? value.memoryEngine.provider ?? value.memory,
      memoryEngine: { ...value.memoryEngine, ...p, provider: p.provider ?? value.memoryEngine.provider },
    });

  const setProvider = (provider: AgentEngineMemoryOption) => {
    patchMemory({ provider });
    patch({ memory: provider });
  };

  return (
    <div className="rounded-xl border border-violet-200/70 bg-violet-50/30 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="inline-flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
            <Cpu className="h-4 w-4 text-violet-600" />
            {t("automationPage.agentEngineTitle")}
          </h4>
          <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentEngineHelp")}</p>
        </div>
        {onValidatePrompt ? (
          <div className="flex items-center gap-2">
            {promptScore != null ? (
              <span
                className={clsx(
                  "rounded-full px-2.5 py-1 text-xs font-bold",
                  promptScore >= 70
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                    : "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
                )}
              >
                {t("automationPage.agentEnginePromptScore").replace("{score}", String(promptScore))}
              </span>
            ) : null}
            <button
              type="button"
              disabled={validatingPrompt}
              onClick={onValidatePrompt}
              className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700 dark:bg-ink-950 dark:text-violet-100"
            >
              {validatingPrompt
                ? t("automationPage.agentEnginePromptValidating")
                : t("automationPage.agentEnginePromptValidate")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <fieldset>
          <legend className="text-xs font-semibold text-ink-800 dark:text-ink-200">
            {t("automationPage.agentEngineRuntimeLabel")}
          </legend>
          <div className="mt-2 space-y-1.5">
            {RUNTIMES.map((row) => (
              <label
                key={row.id}
                className={clsx(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs",
                  value.runtime === row.id
                    ? "border-violet-400 bg-white dark:border-violet-600 dark:bg-ink-950"
                    : "border-transparent hover:bg-white/60 dark:hover:bg-ink-950/40",
                  row.future && row.id !== value.runtime ? "opacity-60" : null,
                )}
              >
                <input
                  type="radio"
                  name="agentEngineRuntime"
                  checked={value.runtime === row.id}
                  disabled={row.future && row.id !== value.runtime}
                  onChange={() => patch({ runtime: row.id })}
                />
                <span>{t(`automationPage.agentEngineRuntime_${row.id}`)}</span>
                {row.future ? (
                  <span className="ml-auto text-[10px] text-ink-400">{t("automationPage.agentEngineFuture")}</span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-semibold text-ink-800 dark:text-ink-200">
            {t("automationPage.agentEngineMemoryLabel")}
          </legend>
          <div className="mt-2 space-y-1.5">
            {(["openconduit", "mem0"] as const).map((id) => (
              <label
                key={id}
                className={clsx(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs",
                  value.memoryEngine.provider === id
                    ? "border-violet-400 bg-white dark:border-violet-600 dark:bg-ink-950"
                    : "border-transparent hover:bg-white/60 dark:hover:bg-ink-950/40",
                )}
              >
                <input
                  type="radio"
                  name="agentEngineMemory"
                  checked={value.memoryEngine.provider === id}
                  onChange={() => setProvider(id)}
                />
                <History className="h-3.5 w-3.5 text-violet-600" />
                <span>{t(`automationPage.agentEngineMemory_${id}`)}</span>
                {id === "mem0" ? (
                  <span className="ml-auto text-[10px] text-ink-400">{t("automationPage.agentEngineMemory_mem0Help")}</span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <fieldset className="mt-4 rounded-lg border border-violet-200/60 bg-white/70 p-3 dark:border-violet-900/50 dark:bg-ink-950/40">
        <legend className="inline-flex items-center gap-1.5 px-1 text-xs font-semibold text-ink-800 dark:text-ink-200">
          <Brain className="h-3.5 w-3.5 text-violet-600" />
          {t("automationPage.memoryEngineIntelligentTitle")}
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["intelligentMemoryEnabled", "memoryEngineIntelligentEnabled"],
              ["autoSaveEnabled", "memoryEngineAutoSave"],
              ["rememberPreferences", "memoryEngineRememberPreferences"],
              ["rememberCommercialHistory", "memoryEngineRememberCommercial"],
              ["rememberTechnicalData", "memoryEngineRememberTechnical"],
              ["ignoreCasualConversations", "memoryEngineIgnoreCasual"],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={value.memoryEngine[key]}
                onChange={(e) => patchMemory({ [key]: e.target.checked })}
              />
              {t(`automationPage.${labelKey}`)}
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <span className="font-medium">{t("automationPage.memoryEngineMaxMemories")}</span>
          <input
            type="number"
            min={10}
            max={500}
            className="w-20 rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
            value={value.memoryEngine.maxMemories}
            onChange={(e) =>
              patchMemory({
                maxMemories: Math.min(500, Math.max(10, Number(e.target.value) || 100)),
              })
            }
          />
        </label>
      </fieldset>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2 rounded-lg border border-ink-200/80 bg-white/80 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950/50">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.supervisorEnabled}
            onChange={(e) => patch({ supervisorEnabled: e.target.checked })}
          />
          <span>
            <span className="inline-flex items-center gap-1 font-medium">
              <ShieldCheck className="h-4 w-4 text-fuchsia-600" />
              {t("automationPage.agentEngineSupervisor")}
            </span>
            <span className="mt-0.5 block text-[11px] font-normal text-ink-500">
              {t("automationPage.agentEngineSupervisorHelp")}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 rounded-lg border border-ink-200/80 bg-white/80 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950/50">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.strictMode}
            onChange={(e) => patch({ strictMode: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t("automationPage.agentEngineStrictMode")}</span>
            <span className="mt-0.5 block text-[11px] font-normal text-ink-500">
              {t("automationPage.agentEngineStrictModeHelp")}
            </span>
          </span>
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-800 dark:text-ink-200">
          <Gauge className="h-3.5 w-3.5" />
          {t("automationPage.agentEngineObservabilityLabel")}
        </legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {(["basic", "full"] as const).map((id) => (
            <label key={id} className="inline-flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="agentEngineObservability"
                checked={value.observability === id}
                onChange={() => patch({ observability: id })}
              />
              {t(`automationPage.agentEngineObservability_${id}`)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
