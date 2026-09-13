import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  CheckCircle2,
  CircleAlert,
  Code2,
  Database,
  Gauge,
  Loader2,
  Plus,
  Shield,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { EIL_ACTION_CATALOG, EIL_POLICY_TEMPLATES } from "@/lib/eil/catalog.js";
import { buildFactCatalog, countPoliciesUsingAction, type ToolEilSource } from "@/lib/eil/factCatalog.js";
import {
  buildFactStoreFromInputs,
  evaluatePolicies,
  evaluatePredicateDetailed,
  toEilPolicyEval,
  type PredicateEvalResult,
} from "@/lib/eil/policyEval.js";
import {
  createEmptyPolicy,
  formatPolicySummary,
  parsePoliciesFromJson,
  policiesToJson,
  policyFromTemplate,
} from "@/lib/eil/policyVisual.js";
import type { AutomationCustomToolRow } from "../automationToolTypes.js";
import type { AgentEilPolicyDraft } from "@/lib/eil/types.js";
import { parseAgentEilJson } from "../AgentEilConfigSection.js";
import { EilActiveBadge, EilHelpHint } from "./EilHelpHint.js";
import { PolicyEditorDrawer } from "./PolicyEditorDrawer.js";

type Translate = (key: string) => string;
type TabId = "policies" | "facts" | "actions" | "simulator" | "json";

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  json: string;
  onJsonChange: (json: string) => void;
  t: Translate;
  locale: "pt" | "en";
  tools: AutomationCustomToolRow[];
  connectedToolNames: string[];
  editBotId: string | null;
  onApplyDefault?: () => Promise<void>;
  applyingDefault?: boolean;
  lastApplySummary?: { toolsUpdated: number; policyIds: string[] } | null;
  helpSections: Array<{ title: string; body: string }>;
};

const TABS: Array<{ id: TabId; icon: typeof Shield; labelKey: string }> = [
  { id: "policies", icon: Shield, labelKey: "automationPage.agentEilTabPolicies" },
  { id: "facts", icon: Database, labelKey: "automationPage.agentEilTabFacts" },
  { id: "actions", icon: Zap, labelKey: "automationPage.agentEilTabActions" },
  { id: "simulator", icon: Gauge, labelKey: "automationPage.agentEilTabSimulator" },
  { id: "json", icon: Code2, labelKey: "automationPage.agentEilTabJson" },
];

export function AgentEilPolicyBuilder({
  enabled,
  onEnabledChange,
  json,
  onJsonChange,
  t,
  locale,
  tools,
  connectedToolNames,
  editBotId,
  onApplyDefault,
  applyingDefault,
  lastApplySummary,
  helpSections,
}: Props) {
  const [tab, setTab] = useState<TabId>("policies");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<AgentEilPolicyDraft | null>(null);
  const [simAction, setSimAction] = useState("request_additional_party");
  const [simFacts, setSimFacts] = useState<Record<string, string>>({ guestsQuantity: "1" });
  const [simPolicyId, setSimPolicyId] = useState("");
  const [factsFilter, setFactsFilter] = useState("");
  const [simResult, setSimResult] = useState<{
    blocked: boolean;
    details: PredicateEvalResult[];
    violations: ReturnType<typeof evaluatePolicies>;
  } | null>(null);

  const parsed = useMemo(() => (enabled ? parseAgentEilJson(json) : null), [enabled, json]);
  const policies = parsed?.ok ? (parsed.value.policies ?? []) : parsePoliciesFromJson(json);

  const enabledToolSet = useMemo(() => new Set(connectedToolNames), [connectedToolNames]);
  const toolSources: ToolEilSource[] = useMemo(
    () => tools.map((tl) => ({ name: tl.name, config: tl.config })),
    [tools],
  );
  const factCatalog = useMemo(() => buildFactCatalog(toolSources, enabledToolSet), [toolSources, enabledToolSet]);
  const filteredFacts = useMemo(() => {
    const q = factsFilter.trim().toLowerCase();
    if (!q) return factCatalog;
    return factCatalog.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.labelPt.toLowerCase().includes(q) ||
        f.labelEn.toLowerCase().includes(q) ||
        f.producedBy.some((p) => p.toLowerCase().includes(q)),
    );
  }, [factCatalog, factsFilter]);

  const syncPolicies = (nextPolicies: AgentEilPolicyDraft[]) => {
    onJsonChange(policiesToJson(nextPolicies));
  };

  const openNewPolicy = () => {
    setEditingPolicy(createEmptyPolicy());
    setEditorOpen(true);
  };

  const openEditPolicy = (p: AgentEilPolicyDraft) => {
    setEditingPolicy({ ...p, requires: p.requires ? [...p.requires] : [], forbids: p.forbids ? [...p.forbids] : [] });
    setEditorOpen(true);
  };

  const handleSavePolicy = (policy: AgentEilPolicyDraft) => {
    const idx = policies.findIndex((p) => p.id === policy.id);
    if (idx >= 0) {
      const next = [...policies];
      next[idx] = policy;
      syncPolicies(next);
    } else {
      syncPolicies([...policies, policy]);
    }
    setEditorOpen(false);
    setEditingPolicy(null);
  };

  const validationMessage = (() => {
    if (!enabled || !parsed) return null;
    if (parsed.ok) return null;
    const map: Record<string, string> = {
      json: t("automationPage.agentEilInvalidJson"),
      object: t("automationPage.agentEilMustBeObject"),
      enabled: t("automationPage.agentEilInvalidEnabled"),
      policies: t("automationPage.agentEilInvalidPolicies"),
      policy: t("automationPage.agentEilInvalidPolicy"),
      policyId: t("automationPage.agentEilInvalidPolicyId"),
      requires: t("automationPage.agentEilInvalidRequires"),
      forbids: t("automationPage.agentEilInvalidForbids"),
    };
    return map[parsed.error] ?? t("automationPage.agentEilInvalidJson");
  })();

  const activeCount = policies.filter((p) => p.active !== false).length;

  const runSimulation = () => {
    const store = buildFactStoreFromInputs(simFacts);
    const targetPolicies = simPolicyId ? policies.filter((p) => p.id === simPolicyId) : policies;
    const policy = targetPolicies[0];
    const details: PredicateEvalResult[] = [];
    if (policy?.requires) {
      for (const pred of policy.requires) details.push(evaluatePredicateDetailed(store, pred));
    }
    const violations = evaluatePolicies({
      policies: targetPolicies.filter((p) => p.active !== false).map(toEilPolicyEval),
      facts: store,
      replyActions: [simAction],
    });
    setSimResult({ blocked: violations.length > 0, details, violations });
  };

  useEffect(() => {
    if (policies.length > 0 && !simPolicyId) setSimPolicyId(policies[0].id);
  }, [policies, simPolicyId]);

  return (
    <div className="rounded-xl border border-violet-200/80 bg-violet-50/40 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-ink-800 dark:text-ink-100">{t("automationPage.agentEilTitle")}</p>
            <EilHelpHint label={t("automationPage.agentEilHelpTitle")} title={t("automationPage.agentEilHelpTitle")} sections={helpSections} />
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">{t("automationPage.agentEilSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {enabled ? <EilActiveBadge active label={t("automationPage.agentEilStatusActive")} /> : null}
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-700 dark:text-ink-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
            />
            {t("automationPage.agentEilEnable")}
          </label>
        </div>
      </div>

      {editBotId && onApplyDefault ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={applyingDefault}
            onClick={() => void onApplyDefault()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100"
          >
            {applyingDefault ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {t("automationPage.agentEilApplyDefault")}
          </button>
          <p className="text-[11px] text-ink-500">{t("automationPage.agentEilApplyDefaultHelp")}</p>
        </div>
      ) : null}

      {lastApplySummary ? (
        <p className="mt-2 text-[11px] text-emerald-800 dark:text-emerald-200">
          {t("automationPage.agentEilApplyDone")
            .replace("{tools}", String(lastApplySummary.toolsUpdated))
            .replace("{policies}", lastApplySummary.policyIds.join(", ") || "—")}
        </p>
      ) : null}

      {enabled ? (
        <>
          <div className="mt-4 flex flex-wrap gap-1 border-b border-violet-200/60 dark:border-violet-900/40">
            {TABS.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={clsx(
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors",
                  tab === id
                    ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300"
                    : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(labelKey)}
              </button>
            ))}
          </div>

          {tab === "policies" ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
                  {t("automationPage.agentEilPoliciesHeading").replace("{count}", String(activeCount))}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openNewPolicy}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("automationPage.agentEilNewPolicy")}
                  </button>
                </div>
              </div>

              {policies.length === 0 ? (
                <div className="rounded-xl border border-dashed border-ink-200 bg-white/60 px-4 py-8 text-center dark:border-ink-700 dark:bg-ink-900/30">
                  <p className="text-xs text-ink-500">{t("automationPage.agentEilNoPolicies")}</p>
                  <button type="button" onClick={openNewPolicy} className="mt-3 text-[11px] font-semibold text-brand-600 hover:underline">
                    + {t("automationPage.agentEilNewPolicy")}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {policies.map((policy) => {
                    const summary = formatPolicySummary(policy, locale);
                    const isActive = policy.active !== false;
                    return (
                      <div
                        key={policy.id}
                        className="rounded-xl border border-ink-200/80 bg-white p-4 dark:border-ink-700 dark:bg-ink-900/50"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                                {policy.name?.trim() || policy.id}
                              </p>
                              <EilActiveBadge
                                active={isActive}
                                label={isActive ? t("automationPage.agentEilPolicyActive") : t("automationPage.agentEilPolicyInactive")}
                              />
                            </div>
                            {policy.description ? (
                              <p className="mt-1 text-[11px] text-ink-500">{policy.description}</p>
                            ) : null}
                          </div>
                        </div>
                        <dl className="mt-3 grid gap-1 text-[11px] text-ink-600 dark:text-ink-400">
                          <div>
                            <dt className="inline font-semibold">{t("automationPage.agentEilCardAction")}: </dt>
                            <dd className="inline">{summary.actionLabel}</dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">{t("automationPage.agentEilCardCondition")}: </dt>
                            <dd className="inline">{summary.requiresLabel}</dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">{t("automationPage.agentEilCardFailure")}: </dt>
                            <dd className="inline">{summary.failureLabel}</dd>
                          </div>
                        </dl>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => openEditPolicy(policy)} className="rounded-lg border px-2 py-1 text-[10px] font-semibold dark:border-ink-600">
                            {t("automationPage.agentEilEdit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => syncPolicies([...policies, { ...policy, id: `${policy.id}_copy`, name: `${policy.name ?? policy.id} (cópia)` }])}
                            className="rounded-lg border px-2 py-1 text-[10px] font-semibold dark:border-ink-600"
                          >
                            {t("automationPage.agentEilDuplicate")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSimPolicyId(policy.id);
                              setSimAction(policy.action ?? "");
                              setTab("simulator");
                            }}
                            className="rounded-lg border px-2 py-1 text-[10px] font-semibold dark:border-ink-600"
                          >
                            {t("automationPage.agentEilTest")}
                          </button>
                          <button
                            type="button"
                            onClick={() => syncPolicies(policies.filter((p) => p.id !== policy.id))}
                            className="rounded-lg border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-700 dark:border-red-900/50"
                          >
                            <Trash2 className="inline h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-xl border border-ink-200/60 bg-white/50 p-3 dark:border-ink-700 dark:bg-ink-900/30">
                <p className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">{t("automationPage.agentEilTemplates")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {EIL_POLICY_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        if (policies.some((p) => p.id === tpl.id)) return;
                        syncPolicies([...policies, policyFromTemplate(tpl)]);
                      }}
                      disabled={policies.some((p) => p.id === tpl.id)}
                      className="rounded-lg border border-ink-200 px-2 py-1 text-[10px] disabled:opacity-40 dark:border-ink-600"
                      title={locale === "pt" ? tpl.descriptionPt : tpl.descriptionEn}
                    >
                      {locale === "pt" ? tpl.namePt : tpl.nameEn}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "facts" ? (
            <div className="mt-4 overflow-x-auto">
              <input
                type="search"
                value={factsFilter}
                placeholder={t("automationPage.agentEilFactsSearch")}
                className="mb-3 w-full max-w-xs rounded-lg border border-ink-200 px-3 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-950"
                onChange={(e) => setFactsFilter(e.target.value)}
              />
              <table className="w-full min-w-[520px] text-left text-[11px]">
                <thead>
                  <tr className="border-b border-ink-200 text-ink-500 dark:border-ink-700">
                    <th className="py-2 pr-3">{t("automationPage.agentEilFactsColFact")}</th>
                    <th className="py-2 pr-3">{t("automationPage.agentEilFactsColType")}</th>
                    <th className="py-2 pr-3">{t("automationPage.agentEilFactsColProducer")}</th>
                    <th className="py-2 pr-3">{t("automationPage.agentEilFactsColPath")}</th>
                    <th className="py-2">{t("automationPage.agentEilFactsColStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFacts.map((f) => (
                    <tr key={f.key} className="border-b border-ink-100 dark:border-ink-800">
                      <td className="py-2 pr-3 font-medium">{locale === "pt" ? f.labelPt : f.labelEn}</td>
                      <td className="py-2 pr-3">{f.type}</td>
                      <td className="py-2 pr-3">{f.producedBy.join(", ") || "—"}</td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{f.jsonPath ?? "—"}</td>
                      <td className="py-2">{f.available ? "✓" : "⚠"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "actions" ? (
            <div className="mt-4 space-y-2">
              {EIL_ACTION_CATALOG.map((action) => (
                <div key={action.id} className="rounded-lg border border-ink-200 bg-white px-3 py-2 dark:border-ink-700 dark:bg-ink-900/40">
                  <p className="text-xs font-semibold">{locale === "pt" ? action.labelPt : action.labelEn}</p>
                  <p className="font-mono text-[10px] text-ink-500">{action.id}</p>
                  <p className="mt-1 text-[11px] text-ink-600 dark:text-ink-400">
                    {locale === "pt" ? action.descriptionPt : action.descriptionEn}
                  </p>
                  <p className="mt-1 text-[10px] text-ink-500">
                    {t("automationPage.agentEilActionsPolicyCount")}: {countPoliciesUsingAction(policies, action.id)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "simulator" ? (
            <div className="mt-4 space-y-3">
              <label className="block text-[11px]">
                <span className="font-semibold">{t("automationPage.agentEilSimPolicy")}</span>
                <select
                  value={simPolicyId}
                  onChange={(e) => setSimPolicyId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-950"
                >
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name?.trim() || p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px]">
                <span className="font-semibold">{t("automationPage.agentEilSimAction")}</span>
                <select
                  value={simAction}
                  onChange={(e) => setSimAction(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-950"
                >
                  {EIL_ACTION_CATALOG.map((a) => (
                    <option key={a.id} value={a.id}>
                      {locale === "pt" ? a.labelPt : a.labelEn}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <p className="text-[11px] font-semibold">{t("automationPage.agentEilSimFacts")}</p>
                {Object.entries(simFacts).map(([key, val]) => (
                  <div key={key} className="mt-2 flex gap-2">
                    <input
                      value={key}
                      onChange={(e) => {
                        const next = { ...simFacts };
                        delete next[key];
                        next[e.target.value] = val;
                        setSimFacts(next);
                      }}
                      className="w-1/3 rounded border px-2 py-1 text-xs dark:border-ink-600 dark:bg-ink-950"
                    />
                    <input
                      value={val}
                      onChange={(e) => setSimFacts({ ...simFacts, [key]: e.target.value })}
                      className="flex-1 rounded border px-2 py-1 text-xs dark:border-ink-600 dark:bg-ink-950"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSimFacts({ ...simFacts, [`fact_${Object.keys(simFacts).length + 1}`]: "" })}
                  className="mt-2 text-[11px] font-semibold text-brand-600"
                >
                  + {t("automationPage.agentEilSimAddFact")}
                </button>
              </div>
              <button
                type="button"
                onClick={runSimulation}
                className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
              >
                {t("automationPage.agentEilSimRun")}
              </button>
              {simResult ? (
                <div
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-xs",
                    simResult.blocked
                      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30",
                  )}
                >
                  <p className="font-bold">
                    {simResult.blocked ? t("automationPage.agentEilSimBlocked") : t("automationPage.agentEilSimAllowed")}
                  </p>
                  {simResult.details.map((d) => (
                    <p key={`${d.fact}-${d.op}`} className="mt-1 font-mono text-[10px]">
                      {d.fact} {d.op} → {d.result} ({String(d.actual ?? "—")})
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "json" ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{t("automationPage.agentEilJsonLabel")}</p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      onJsonChange(JSON.stringify(JSON.parse(json || "{}"), null, 2));
                    } catch {
                      /* validation below */
                    }
                  }}
                  className="text-[11px] font-semibold text-brand-600 hover:underline"
                >
                  {t("automationPage.agentEilJsonFormat")}
                </button>
              </div>
              <textarea
                value={json}
                onChange={(e) => onJsonChange(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full rounded-lg border border-ink-200 bg-ink-950/90 p-2 font-mono text-xs text-ink-100 dark:border-ink-700"
              />
              {validationMessage ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{validationMessage}</span>
                </div>
              ) : parsed?.ok ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("automationPage.agentEilValid")}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {validationMessage && tab !== "json" ? (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-200">
              <CircleAlert className="h-3.5 w-3.5" />
              {validationMessage}
            </p>
          ) : null}
        </>
      ) : null}

      <PolicyEditorDrawer
        open={editorOpen}
        policy={editingPolicy}
        facts={factCatalog}
        locale={locale}
        t={t}
        onClose={() => {
          setEditorOpen(false);
          setEditingPolicy(null);
        }}
        onSave={handleSavePolicy}
        existingIds={policies.map((p) => p.id)}
      />
    </div>
  );
}
