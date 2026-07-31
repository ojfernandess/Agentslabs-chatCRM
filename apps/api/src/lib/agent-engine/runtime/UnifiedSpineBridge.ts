/**
 * Fase 2 — Unified Execution Spine bridge para Motor Padrão (openconduit).
 * beginTurn → refresh → finalize com shadow compare opcional.
 */
import type { AutomationExecutionLogPort } from "../../automationExecutionLog.js";
import type { AgentEngineConfig, AgentRuntimeExecuteInput } from "../types.js";
import type { TurnContext } from "../core/types.js";
import type { ToolOutcomeForEil } from "../eil/types.js";
import type { FactStore } from "../eil/types.js";
import {
  sharedExecutionEngine,
  timelineToInspectorEntries,
  type EngineTurnState,
} from "../engine/index.js";

export type UnifiedSpineMode = "off" | "shadow" | "primary" | "only";

export type SpineShadowReport = {
  equivalent: boolean;
  diffs: string[];
};

export type SpineCompareOpts = {
  /** Ignora promptHash — só required/pending/intent (decisão de fallback 2b). */
  criticalOnly?: boolean;
};

export function resolveUnifiedSpineMode(config: AgentEngineConfig): UnifiedSpineMode {
  const env = (process.env.AGENT_ENGINE_UNIFIED_SPINE ?? "").trim().toLowerCase();
  if (env === "only") return "only";
  if (env === "primary") return "primary";
  if (env === "shadow" || env === "true" || env === "1") return "shadow";
  if (env === "off" || env === "false" || env === "0") return "off";
  const cfg = config.unifiedSpineMode;
  if (cfg === "shadow" || cfg === "primary" || cfg === "only" || cfg === "off") return cfg;
  return "off";
}

export function shouldUseEngineTurnContext(mode: UnifiedSpineMode): boolean {
  return mode === "primary" || mode === "only";
}

/** Modo `only` — plan/contract exclusivamente via ExecutionEngine (2c). */
export function isSpineOnlyMode(mode: UnifiedSpineMode): boolean {
  return mode === "only";
}

/** Legacy buildTurnContext ainda necessário (shadow compare ou primary fallback). */
export function requiresLegacyTurnContextBuilder(mode: UnifiedSpineMode): boolean {
  return mode === "off" || mode === "shadow" || mode === "primary";
}

function sortedTools(names: string[]): string[] {
  return [...names].map((n) => n.toLowerCase()).sort();
}

/** Compara TurnContext legacy vs ExecutionEngine — shadow ou fallback primary. */
export function compareTurnContextShadow(
  legacy: TurnContext,
  engine: TurnContext,
  opts?: SpineCompareOpts,
): SpineShadowReport {
  const diffs: string[] = [];
  if (
    !opts?.criticalOnly &&
    legacy.promptContract.promptHash !== engine.promptContract.promptHash
  ) {
    diffs.push(
      `promptHash legacy=${legacy.promptContract.promptHash} engine=${engine.promptContract.promptHash}`,
    );
  }
  const lReq = sortedTools(legacy.promptContract.requiredToolNames);
  const eReq = sortedTools(engine.promptContract.requiredToolNames);
  if (JSON.stringify(lReq) !== JSON.stringify(eReq)) {
    diffs.push(`requiredTools legacy=[${lReq.join(",")}] engine=[${eReq.join(",")}]`);
  }
  const lPending = sortedTools(legacy.executionContract.pendingToolNames);
  const ePending = sortedTools(engine.executionContract.pendingToolNames);
  if (JSON.stringify(lPending) !== JSON.stringify(ePending)) {
    diffs.push(`pendingTools legacy=[${lPending.join(",")}] engine=[${ePending.join(",")}]`);
  }
  if (legacy.intent.kind !== engine.intent.kind) {
    diffs.push(`intent legacy=${legacy.intent.kind} engine=${engine.intent.kind}`);
  }
  return { equivalent: diffs.length === 0, diffs };
}

/** Divergência que exige fallback legacy em modo primary (2b). */
export function compareTurnContextCritical(
  legacy: TurnContext,
  engine: TurnContext,
): SpineShadowReport {
  return compareTurnContextShadow(legacy, engine, { criticalOnly: true });
}

export type SpineTurnContextResolution = {
  context: TurnContext;
  source: "engine" | "legacy";
  fallbackActivated: boolean;
  criticalReport: SpineShadowReport;
};

/** Lógica pura de resolução — testável sem session. */
export function resolveSpineTurnContext(opts: {
  mode: UnifiedSpineMode;
  engineContext: TurnContext | null;
  legacyBuilder?: () => TurnContext;
  fallbackActive: boolean;
  onPrimaryFallback?: (report: SpineShadowReport) => void;
  onNonCriticalDiff?: (report: SpineShadowReport) => void;
}): SpineTurnContextResolution {
  if (opts.mode === "only") {
    if (!opts.engineContext) {
      throw new Error("resolveSpineTurnContext: only mode requires engineContext");
    }
    return {
      context: opts.engineContext,
      source: "engine",
      fallbackActivated: false,
      criticalReport: { equivalent: true, diffs: [] },
    };
  }
  if (!opts.legacyBuilder) {
    throw new Error("resolveSpineTurnContext: legacyBuilder required when mode is not only");
  }
  const legacy = opts.legacyBuilder();
  if (!opts.engineContext || opts.mode === "off") {
    return {
      context: legacy,
      source: "legacy",
      fallbackActivated: opts.fallbackActive,
      criticalReport: { equivalent: true, diffs: [] },
    };
  }
  if (opts.mode === "shadow") {
    const report = compareTurnContextShadow(legacy, opts.engineContext!);
    if (!report.equivalent) {
      opts.onNonCriticalDiff?.(report);
    }
    return {
      context: legacy,
      source: "legacy",
      fallbackActivated: opts.fallbackActive,
      criticalReport: compareTurnContextCritical(legacy, opts.engineContext!),
    };
  }
  if (!opts.engineContext) {
    return {
      context: legacy,
      source: "legacy",
      fallbackActivated: opts.fallbackActive,
      criticalReport: { equivalent: true, diffs: [] },
    };
  }
  // primary (2b)
  if (opts.fallbackActive) {
    return {
      context: legacy,
      source: "legacy",
      fallbackActivated: true,
      criticalReport: compareTurnContextCritical(legacy, opts.engineContext),
    };
  }
  const critical = compareTurnContextCritical(legacy, opts.engineContext);
  if (!critical.equivalent) {
    opts.onPrimaryFallback?.(critical);
    return {
      context: legacy,
      source: "legacy",
      fallbackActivated: true,
      criticalReport: critical,
    };
  }
  const full = compareTurnContextShadow(legacy, opts.engineContext);
  if (!full.equivalent) {
    opts.onNonCriticalDiff?.(full);
  }
  return {
    context: opts.engineContext,
    source: "engine",
    fallbackActivated: false,
    criticalReport: critical,
  };
}

export function emitEngineTimelineToLog(
  ex: AutomationExecutionLogPort | null | undefined,
  state: EngineTurnState,
): void {
  if (!ex) return;
  for (const entry of timelineToInspectorEntries(state.timeline)) {
    ex.info({ id: entry.id, name: entry.name }, entry.message, { at: entry.at });
  }
}

export type UnifiedSpineSessionOpts = {
  input: AgentRuntimeExecuteInput;
  memory?: Record<string, unknown>;
  availableToolNames?: string[];
  executionLog?: AutomationExecutionLogPort | null;
};

export class UnifiedSpineSession {
  readonly mode: UnifiedSpineMode;
  private _state: EngineTurnState | null;
  private _primaryFallbackActive = false;
  private _primaryFallbackCount = 0;
  private _lastResolutionSource: "engine" | "legacy" | null = null;

  private constructor(mode: UnifiedSpineMode, state: EngineTurnState | null) {
    this.mode = mode;
    this._state = state;
  }

  get primaryFallbackActive(): boolean {
    return this._primaryFallbackActive;
  }

  get primaryFallbackCount(): number {
    return this._primaryFallbackCount;
  }

  get lastResolutionSource(): "engine" | "legacy" | null {
    return this._lastResolutionSource;
  }

  static begin(opts: UnifiedSpineSessionOpts): UnifiedSpineSession {
    const mode = resolveUnifiedSpineMode(opts.input.engineConfig);
    if (mode === "off") {
      return new UnifiedSpineSession("off", null);
    }
    const state = sharedExecutionEngine.beginTurn({
      input: opts.input,
      memory: opts.memory,
      availableToolNames: opts.availableToolNames,
    });
    emitEngineTimelineToLog(opts.executionLog, state);
    if (mode === "shadow") {
      opts.executionLog?.debug(
        { id: "engine_shadow", name: "Unified Spine (shadow)" },
        "ExecutionEngine beginTurn — legacy path remains authoritative",
        {
          output: {
            mode,
            requiredTools: state.plan.requiredToolNames,
            promptIrHash: state.turnContext.promptIr.metadata.hash,
          },
        },
      );
    } else if (mode === "only") {
      opts.executionLog?.info(
        { id: "execution_engine", name: "Execution Engine" },
        "Unified spine only — legacy plan/contract disabled",
        {
          output: {
            mode,
            requiredTools: state.plan.requiredToolNames,
            promptIrHash: state.turnContext.promptIr.metadata.hash,
          },
        },
      );
    } else {
      opts.executionLog?.info(
        { id: "execution_engine", name: "Execution Engine" },
        `Unified spine active (${mode})`,
        {
          output: {
            mode,
            requiredTools: state.plan.requiredToolNames,
            promptIrHash: state.turnContext.promptIr.metadata.hash,
          },
        },
      );
    }
    return new UnifiedSpineSession(mode, state);
  }

  get engineState(): EngineTurnState | null {
    return this._state;
  }

  refresh(opts: {
    behaviorConfig: Record<string, unknown> | null | undefined;
    toolOutcomes?: ToolOutcomeForEil[];
    memory?: Record<string, unknown>;
    priorFacts?: FactStore;
    phase?: "schedule" | "validate" | "recover";
    executionLog?: AutomationExecutionLogPort | null;
  }): void {
    if (!this._state) return;
    const prevLen = this._state.timeline.length;
    this._state = sharedExecutionEngine.refreshTurnWithBehavior(this._state, opts.behaviorConfig, {
      toolOutcomes: opts.toolOutcomes,
      memory: opts.memory,
      priorFacts: opts.priorFacts,
      phase: opts.phase === "schedule" ? "schedule" : opts.phase === "recover" ? "recover" : "validate",
    });
    if (opts.executionLog) {
      const newEvents = timelineToInspectorEntries(this._state.timeline.slice(prevLen));
      for (const entry of newEvents) {
        opts.executionLog.info({ id: entry.id, name: entry.name }, entry.message, { at: entry.at });
      }
    }
  }

  recordPhase(
    phase: "execute_llm" | "schedule" | "finalize",
    detail?: string,
    executionLog?: AutomationExecutionLogPort | null,
  ): void {
    if (!this._state) return;
    const prevLen = this._state.timeline.length;
    this._state = sharedExecutionEngine.recordPhase(this._state, phase, detail);
    if (executionLog) {
      for (const entry of timelineToInspectorEntries(this._state.timeline.slice(prevLen))) {
        executionLog.info({ id: entry.id, name: entry.name }, entry.message, { at: entry.at });
      }
    }
  }

  /**
   * TurnContext do engine — modo `only` (sem legacy builder).
   */
  resolveEngineTurnContext(): TurnContext {
    if (this.mode !== "only") {
      throw new Error("resolveEngineTurnContext: only valid in only mode");
    }
    if (!this._state) {
      throw new Error("resolveEngineTurnContext: engine state missing");
    }
    this._lastResolutionSource = "engine";
    return this._state.turnContext;
  }

  /**
   * Devolve TurnContext — engine (primary/only), legacy (off/shadow), ou fallback (primary 2b).
   * Em `only`, omitir legacyBuilder e usar resolveEngineTurnContext().
   */
  resolveTurnContext(
    legacyBuilder: (() => TurnContext) | undefined,
    executionLog?: AutomationExecutionLogPort | null,
  ): TurnContext {
    if (this.mode === "only") {
      return this.resolveEngineTurnContext();
    }
    if (!legacyBuilder) {
      throw new Error("resolveTurnContext: legacyBuilder required unless mode is only");
    }
    const resolution = resolveSpineTurnContext({
      mode: this.mode,
      engineContext: this._state?.turnContext ?? null,
      legacyBuilder,
      fallbackActive: this._primaryFallbackActive,
      onPrimaryFallback: (report) => {
        this._primaryFallbackActive = true;
        this._primaryFallbackCount += 1;
        executionLog?.warn(
          { id: "engine_primary_fallback", name: "Unified Spine primary fallback" },
          report.diffs.join("; "),
          {
            output: {
              diffs: report.diffs,
              fallbackCount: this._primaryFallbackCount,
              mode: this.mode,
            },
          },
        );
      },
      onNonCriticalDiff: (report) => {
        if (this.mode === "shadow") {
          executionLog?.warn(
            { id: "engine_shadow", name: "Unified Spine divergence" },
            report.diffs.join("; "),
            { output: { diffs: report.diffs } },
          );
        } else {
          executionLog?.debug(
            { id: "engine_primary", name: "Unified Spine non-critical diff" },
            report.diffs.join("; "),
            { output: { diffs: report.diffs } },
          );
        }
      },
    });
    this._primaryFallbackActive = resolution.fallbackActivated;
    this._lastResolutionSource = resolution.source;
    return resolution.context;
  }

  finalize(executionLog?: AutomationExecutionLogPort | null, detail?: string): void {
    if (!this._state) return;
    if (this.mode === "only") {
      executionLog?.info(
        { id: "execution_engine", name: "Unified Spine only" },
        "Turno concluído — plan/contract exclusivamente via ExecutionEngine",
        {
          output: {
            lastSource: this._lastResolutionSource,
            requiredTools: this._state.plan.requiredToolNames,
          },
        },
      );
    }
    if (this.mode === "primary" && this._primaryFallbackCount > 0) {
      executionLog?.info(
        { id: "engine_primary_fallback", name: "Unified Spine primary summary" },
        `${this._primaryFallbackCount} fallback(s) legacy neste turno`,
        {
          output: {
            fallbackCount: this._primaryFallbackCount,
            lastSource: this._lastResolutionSource,
          },
        },
      );
    }
    const prevLen = this._state.timeline.length;
    this._state = sharedExecutionEngine.finalize(this._state, detail ?? "turn_complete");
    if (executionLog) {
      for (const entry of timelineToInspectorEntries(this._state.timeline.slice(prevLen))) {
        executionLog.info({ id: entry.id, name: entry.name }, entry.message, { at: entry.at });
      }
    }
  }
}
