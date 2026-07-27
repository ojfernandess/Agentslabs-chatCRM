import { useMemo } from "react";
import clsx from "clsx";
import { CheckCircle2, CircleAlert } from "lucide-react";
import type { AutomationToolsTranslate } from "./automationToolTypes";

export type ToolEilConfigDraft = {
  produces?: string[];
  requiresFacts?: string[];
  capabilities?: string[];
  factPaths?: Record<string, string>;
};

const EMPTY_EIL_EXAMPLE: ToolEilConfigDraft = {
  produces: ["guestsQuantity", "reservationStatus"],
  capabilities: ["lookup_reservation"],
  requiresFacts: [],
  factPaths: {
    guestsQuantity: "stay.guestsQuantity",
    reservationStatus: "stay.status",
  },
};

export function extractToolEil(config: Record<string, unknown> | undefined | null): ToolEilConfigDraft | null {
  if (!config || typeof config !== "object") return null;
  const raw = config.eil;
  if (!raw || typeof raw !== "object") return null;
  return raw as ToolEilConfigDraft;
}

export function toolHasEilConfig(config: Record<string, unknown> | undefined | null): boolean {
  const eil = extractToolEil(config);
  if (!eil) return false;
  const produces = Array.isArray(eil.produces) ? eil.produces.length : 0;
  const caps = Array.isArray(eil.capabilities) ? eil.capabilities.length : 0;
  const req = Array.isArray(eil.requiresFacts) ? eil.requiresFacts.length : 0;
  const paths = eil.factPaths && typeof eil.factPaths === "object" ? Object.keys(eil.factPaths).length : 0;
  return produces + caps + req + paths > 0;
}

export type ParsedToolEilResult =
  | { ok: true; value: ToolEilConfigDraft; summary: { produces: number; capabilities: number; requiresFacts: number; factPaths: number } }
  | { ok: false; error: string };

/** Valida e normaliza o JSON de `config.eil`. */
export function parseToolEilJson(raw: string): ParsedToolEilResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, error: "json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "object" };
  }
  const obj = parsed as Record<string, unknown>;
  const out: ToolEilConfigDraft = {};

  if (obj.produces !== undefined) {
    if (!Array.isArray(obj.produces) || !obj.produces.every((x) => typeof x === "string")) {
      return { ok: false, error: "produces" };
    }
    out.produces = obj.produces.map((x) => x.trim()).filter(Boolean);
  }
  if (obj.requiresFacts !== undefined) {
    if (!Array.isArray(obj.requiresFacts) || !obj.requiresFacts.every((x) => typeof x === "string")) {
      return { ok: false, error: "requiresFacts" };
    }
    out.requiresFacts = obj.requiresFacts.map((x) => x.trim()).filter(Boolean);
  }
  if (obj.capabilities !== undefined) {
    if (!Array.isArray(obj.capabilities) || !obj.capabilities.every((x) => typeof x === "string")) {
      return { ok: false, error: "capabilities" };
    }
    out.capabilities = obj.capabilities.map((x) => x.trim()).filter(Boolean);
  }
  if (obj.factPaths !== undefined) {
    if (!obj.factPaths || typeof obj.factPaths !== "object" || Array.isArray(obj.factPaths)) {
      return { ok: false, error: "factPaths" };
    }
    const factPaths: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.factPaths as Record<string, unknown>)) {
      if (typeof v !== "string") return { ok: false, error: "factPaths" };
      const key = k.trim();
      const path = v.trim();
      if (key && path) factPaths[key] = path;
    }
    out.factPaths = factPaths;
  }

  return {
    ok: true,
    value: out,
    summary: {
      produces: out.produces?.length ?? 0,
      capabilities: out.capabilities?.length ?? 0,
      requiresFacts: out.requiresFacts?.length ?? 0,
      factPaths: out.factPaths ? Object.keys(out.factPaths).length : 0,
    },
  };
}

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  json: string;
  onJsonChange: (json: string) => void;
  t: AutomationToolsTranslate;
};

export function ToolEilConfigSection({ enabled, onEnabledChange, json, onJsonChange, t }: Props) {
  const parsed = useMemo(() => (enabled ? parseToolEilJson(json) : null), [enabled, json]);

  const validationMessage = (() => {
    if (!enabled || !parsed) return null;
    if (parsed.ok) return null;
    const map: Record<string, string> = {
      json: t("automationPage.toolEilInvalidJson"),
      object: t("automationPage.toolEilMustBeObject"),
      produces: t("automationPage.toolEilInvalidProduces"),
      requiresFacts: t("automationPage.toolEilInvalidRequires"),
      capabilities: t("automationPage.toolEilInvalidCapabilities"),
      factPaths: t("automationPage.toolEilInvalidFactPaths"),
    };
    return map[parsed.error] ?? t("automationPage.toolEilInvalidJson");
  })();

  return (
    <div className="rounded-xl border border-ink-200/80 bg-ink-50/60 p-4 dark:border-ink-700 dark:bg-ink-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">{t("automationPage.toolEilTitle")}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
            {t("automationPage.toolEilHelp")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-700 dark:text-ink-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              const next = e.target.checked;
              onEnabledChange(next);
              if (next && !json.trim()) {
                onJsonChange(JSON.stringify(EMPTY_EIL_EXAMPLE, null, 2));
              }
            }}
          />
          {t("automationPage.toolEilEnable")}
        </label>
      </div>

      {enabled ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {t("automationPage.toolEilJsonLabel")}
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  onJsonChange(JSON.stringify(JSON.parse(json || "{}"), null, 2));
                } catch {
                  /* keep as-is; validation shows below */
                }
              }}
              className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              {t("automationPage.toolsJsonBeautify")}
            </button>
          </div>
          <textarea
            value={json}
            onChange={(e) => onJsonChange(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded-lg border border-ink-200 bg-ink-950/90 p-2 font-mono text-xs text-ink-100 dark:border-ink-700"
          />

          {validationMessage ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{validationMessage}</span>
            </div>
          ) : parsed?.ok ? (
            <div
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs",
                "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100",
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("automationPage.toolEilValid")}
              </div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                <li>
                  {t("automationPage.toolEilSummaryProduces")}: {parsed.summary.produces}
                </li>
                <li>
                  {t("automationPage.toolEilSummaryCapabilities")}: {parsed.summary.capabilities}
                </li>
                <li>
                  {t("automationPage.toolEilSummaryRequires")}: {parsed.summary.requiresFacts}
                </li>
                <li>
                  {t("automationPage.toolEilSummaryFactPaths")}: {parsed.summary.factPaths}
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
