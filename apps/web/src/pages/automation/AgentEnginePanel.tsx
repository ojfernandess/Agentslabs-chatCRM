import clsx from "clsx";
import { Brain, Cpu, Gauge, History, Layers, ShieldCheck } from "lucide-react";
import { HitlPendingPanel } from "@/pages/automation/HitlPendingPanel";

export type AgentEngineRuntimeOption =
  | "openconduit"
  | "langgraph"
  | "crewai"
  | "autogen"
  | "mastra";

export type AgentEngineMemoryOption = "openconduit" | "mem0";
export type AgentEngineObservabilityOption = "basic" | "full";
export type UnifiedSpineModeOption = "off" | "shadow" | "primary" | "only";

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
  supervisorMode: "structural" | "llm" | "both";
  strictMode: boolean;
  observability: AgentEngineObservabilityOption;
  checkpointStore: "memory" | "redis";
  streamingEnabled: boolean;
  humanInTheLoopEnabled: boolean;
  humanInTheLoopNativeEnabled: boolean;
  executionQueueEnabled: boolean;
  clientTokenStreamingEnabled: boolean;
  clientOutboundStreamingEnabled: boolean;
  parallelKbPrefetchEnabled: boolean;
  /** Invoca tools obrigatórias do contrato antes do LLM (LangGraph). */
  schedulerEnabled: boolean;
  /** Recupera tools em falta e envia fallback em bloqueio strict. */
  resilienceEnabled: boolean;
  /** Unified Execution Spine — Prompt → IR → ExecutionEngine (Motor Padrão). */
  unifiedSpineMode: UnifiedSpineModeOption;
  maxMandatoryRecoveries: number;
  blockedFallbackMessage: string;
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

const UNIFIED_SPINE_MODES: UnifiedSpineModeOption[] = ["off", "shadow", "primary", "only"];

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
                  onChange={() => patchMemory({ provider: id })}
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

      {value.supervisorEnabled ? (
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold text-ink-800 dark:text-ink-200">
            {t("automationPage.agentEngineSupervisorModeLabel")}
          </legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(["both", "structural", "llm"] as const).map((mode) => (
              <label key={mode} className="inline-flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="agentEngineSupervisorMode"
                  checked={value.supervisorMode === mode}
                  onChange={() => patch({ supervisorMode: mode })}
                />
                {t(`automationPage.agentEngineSupervisorMode_${mode}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

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

      {value.runtime === "openconduit" ? (
        <fieldset className="mt-4 rounded-lg border border-emerald-200/70 bg-emerald-50/30 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <legend className="inline-flex items-center gap-1.5 px-1 text-xs font-semibold text-ink-800 dark:text-ink-200">
            <Layers className="h-3.5 w-3.5 text-emerald-600" />
            {t("automationPage.agentEngineUnifiedSpineTitle")}
          </legend>
          <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.agentEngineUnifiedSpineHelp")}</p>
          <div className="mt-2 space-y-1.5">
            {UNIFIED_SPINE_MODES.map((mode) => (
              <label
                key={mode}
                className={clsx(
                  "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs",
                  value.unifiedSpineMode === mode
                    ? "border-emerald-400 bg-white dark:border-emerald-600 dark:bg-ink-950"
                    : "border-transparent hover:bg-white/60 dark:hover:bg-ink-950/40",
                )}
              >
                <input
                  type="radio"
                  name="agentEngineUnifiedSpineMode"
                  className="mt-0.5"
                  checked={value.unifiedSpineMode === mode}
                  onChange={() => patch({ unifiedSpineMode: mode })}
                />
                <span>
                  <span className="font-medium">{t(`automationPage.agentEngineUnifiedSpine_${mode}`)}</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-ink-500">
                    {t(`automationPage.agentEngineUnifiedSpine_${mode}Help`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink-400">{t("automationPage.agentEngineUnifiedSpineEnvNote")}</p>
        </fieldset>
      ) : null}

      {value.runtime === "langgraph" ? (
        <fieldset className="mt-4 rounded-lg border border-violet-200/60 bg-white/60 p-3 dark:border-violet-900/40 dark:bg-ink-950/30">
          <legend className="text-xs font-semibold text-violet-900 dark:text-violet-200">
            {t("automationPage.agentEngineLangGraphAdvanced")}
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.streamingEnabled}
                onChange={(e) => patch({ streamingEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium">{t("automationPage.agentEngineStreaming")}</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {t("automationPage.agentEngineStreamingHelp")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.humanInTheLoopEnabled}
                onChange={(e) =>
                  patch({
                    humanInTheLoopEnabled: e.target.checked,
                    humanInTheLoopNativeEnabled: e.target.checked
                      ? value.humanInTheLoopNativeEnabled
                      : false,
                  })
                }
              />
              <span>
                <span className="font-medium">{t("automationPage.agentEngineHitl")}</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {t("automationPage.agentEngineHitlHelp")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!value.humanInTheLoopEnabled}
                checked={value.humanInTheLoopNativeEnabled}
                onChange={(e) => patch({ humanInTheLoopNativeEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium">{t("automationPage.agentEngineHitlNative")}</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {t("automationPage.agentEngineHitlNativeHelp")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.executionQueueEnabled}
                onChange={(e) => patch({ executionQueueEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium">{t("automationPage.agentEngineExecutionQueue")}</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {t("automationPage.agentEngineExecutionQueueHelp")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.clientTokenStreamingEnabled}
                onChange={(e) => patch({ clientTokenStreamingEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium">{t("automationPage.agentEngineTokenStreaming")}</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {t("automationPage.agentEngineTokenStreamingHelp")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.clientOutboundStreamingEnabled}
                onChange={(e) => patch({ clientOutboundStreamingEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium">{t("automationPage.agentEngineOutboundStreaming")}</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {t("automationPage.agentEngineOutboundStreamingHelp")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.parallelKbPrefetchEnabled}
                onChange={(e) => patch({ parallelKbPrefetchEnabled: e.target.checked })}
              />
              <span>
                <span className="font-medium">{t("automationPage.agentEngineParallelKbPrefetch")}</span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {t("automationPage.agentEngineParallelKbPrefetchHelp")}
                </span>
              </span>
            </label>
          </div>

          <div className="mt-4 border-t border-violet-200/50 pt-3 dark:border-violet-900/40">
            <p className="text-xs font-semibold text-violet-900 dark:text-violet-200">
              {t("automationPage.agentEngineTurnRuntimeTitle")}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {t("automationPage.agentEngineTurnRuntimeHelp")}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex items-start gap-2 text-xs sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={value.schedulerEnabled}
                  onChange={(e) => patch({ schedulerEnabled: e.target.checked })}
                />
                <span>
                  <span className="font-medium">{t("automationPage.agentEngineScheduler")}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-500">
                    {t("automationPage.agentEngineSchedulerHelp")}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={value.resilienceEnabled}
                  onChange={(e) => patch({ resilienceEnabled: e.target.checked })}
                />
                <span>
                  <span className="font-medium">{t("automationPage.agentEngineResilience")}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-500">
                    {t("automationPage.agentEngineResilienceHelp")}
                  </span>
                </span>
              </label>
            </div>
            {value.resilienceEnabled ? (
              <div className="mt-3 space-y-2">
                <label className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{t("automationPage.agentEngineMaxMandatoryRecoveries")}</span>
                  <input
                    type="number"
                    min={0}
                    max={3}
                    className="w-16 rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
                    value={value.maxMandatoryRecoveries}
                    onChange={(e) =>
                      patch({
                        maxMandatoryRecoveries: Math.min(
                          3,
                          Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        ),
                      })
                    }
                  />
                  <span className="text-[11px] text-ink-500">
                    {t("automationPage.agentEngineMaxMandatoryRecoveriesHelp")}
                  </span>
                </label>
                <label className="block text-xs">
                  <span className="font-medium">{t("automationPage.agentEngineBlockedFallback")}</span>
                  <textarea
                    rows={2}
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-700 dark:bg-ink-950"
                    value={value.blockedFallbackMessage}
                    placeholder={t("automationPage.agentEngineBlockedFallbackPlaceholder")}
                    onChange={(e) =>
                      patch({ blockedFallbackMessage: e.target.value.slice(0, 500) })
                    }
                  />
                  <span className="mt-0.5 block text-[11px] text-ink-500">
                    {t("automationPage.agentEngineBlockedFallbackHelp")}
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <label className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">{t("automationPage.agentEngineCheckpointStore")}</span>
            <select
              className="rounded border border-ink-200 px-2 py-1 dark:border-ink-700 dark:bg-ink-950"
              value={value.checkpointStore}
              onChange={(e) =>
                patch({ checkpointStore: e.target.value === "redis" ? "redis" : "memory" })
              }
            >
              <option value="memory">{t("automationPage.agentEngineCheckpoint_memory")}</option>
              <option value="redis">{t("automationPage.agentEngineCheckpoint_redis")}</option>
            </select>
          </label>
        </fieldset>
      ) : null}

      <HitlPendingPanel enabled={value.humanInTheLoopEnabled} t={t} />
    </div>
  );
}
