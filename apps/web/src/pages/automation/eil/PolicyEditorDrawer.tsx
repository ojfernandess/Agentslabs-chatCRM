import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CircleAlert, X } from "lucide-react";
import { EIL_OPERATOR_CATALOG, operatorsForFactType, slugifyPolicyId } from "@/lib/eil/catalog.js";
import type { ResolvedActionEntry } from "@/lib/eil/categoryCatalog.js";
import type { ResolvedFactEntry } from "@/lib/eil/factCatalog.js";
import { ensurePolicyId } from "@/lib/eil/policyVisual.js";
import type { AgentEilConfigDraft, AgentEilPolicyDraft, EilPredicateDraft } from "@/lib/eil/types.js";
import { SearchableActionSelect } from "./SearchableActionSelect.js";

type Translate = (key: string) => string;

type Props = {
  open: boolean;
  policy: AgentEilPolicyDraft | null;
  facts: ResolvedFactEntry[];
  eilConfig: AgentEilConfigDraft;
  actionCatalog: ResolvedActionEntry[];
  locale: "pt" | "en";
  t: Translate;
  onClose: () => void;
  onSave: (policy: AgentEilPolicyDraft) => void;
  existingIds: string[];
};

function emptyCondition(): EilPredicateDraft {
  return { fact: "", op: "exists" };
}

export function PolicyEditorDrawer({ open, policy, facts, eilConfig, actionCatalog, locale, t, onClose, onSave, existingIds }: Props) {
  const [draft, setDraft] = useState<AgentEilPolicyDraft | null>(null);
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);

  useEffect(() => {
    if (open && policy) {
      setDraft({
        ...policy,
        requires: policy.requires ? [...policy.requires] : [],
        forbids: policy.forbids ? [...policy.forbids] : [],
      });
      setIdManuallyEdited(Boolean(policy.idManuallyEdited));
    } else if (!open) {
      setDraft(null);
      setIdManuallyEdited(false);
    }
  }, [open, policy]);

  const factMap = useMemo(() => new Map(facts.map((f) => [f.key, f])), [facts]);

  if (!open || !draft) return null;

  const update = (patch: Partial<AgentEilPolicyDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const selectedFact = (key: string) => factMap.get(key);

  const id = draft.id?.trim() || slugifyPolicyId(draft.name ?? "");
  const validationErrors: string[] = [];
  if (!draft.name?.trim()) validationErrors.push(t("automationPage.agentEilPolicyNameRequired"));
  if (!draft.action?.trim()) validationErrors.push(t("automationPage.agentEilPolicyActionRequired"));
  if (existingIds.filter((x) => x !== policy?.id).includes(id)) {
    validationErrors.push(t("automationPage.agentEilPolicyIdDuplicate"));
  }

  const requires = draft.requires ?? [];
  const forbids = draft.forbids ?? [];

  const renderConditionRows = (items: EilPredicateDraft[], field: "requires" | "forbids") => (
    <div className="space-y-2">
      {items.map((cond, idx) => {
        const factDef = selectedFact(cond.fact);
        const ops = factDef ? operatorsForFactType(factDef.type) : EIL_OPERATOR_CATALOG;
        const opDef = ops.find((o) => o.op === cond.op) ?? ops[0];
        const needsValue = opDef?.needsValue ?? false;
        return (
          <div key={`${field}-${idx}`} className="flex flex-wrap items-center gap-2">
            <select
              value={cond.fact}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...cond, fact: e.target.value };
                update({ [field]: next });
              }}
              className="min-w-[140px] flex-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-900"
            >
              <option value="">{t("automationPage.agentEilSelectFact")}</option>
              {facts.map((f) => (
                <option key={f.key} value={f.key}>
                  {locale === "pt" ? f.labelPt : f.labelEn}
                </option>
              ))}
            </select>
            <select
              value={cond.op}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...cond, op: e.target.value };
                update({ [field]: next });
              }}
              className="min-w-[120px] rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-900"
            >
              {ops.map((o) => (
                <option key={o.op} value={o.op}>
                  {locale === "pt" ? o.labelPt : o.labelEn}
                </option>
              ))}
            </select>
            {needsValue ? (
              <input
                type="text"
                value={cond.value != null ? String(cond.value) : ""}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...cond, value: e.target.value };
                  update({ [field]: next });
                }}
                placeholder={t("automationPage.agentEilConditionValue")}
                className="min-w-[80px] flex-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-ink-600 dark:bg-ink-900"
              />
            ) : null}
            <button
              type="button"
              onClick={() => update({ [field]: items.filter((_, i) => i !== idx) })}
              className="rounded-lg px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              {t("automationPage.agentEilRemoveCondition")}
            </button>
            {cond.fact && factDef && !factDef.available ? (
              <p className="w-full text-[10px] text-amber-700 dark:text-amber-300">
                {t("automationPage.agentEilFactNotProduced").replace("{fact}", cond.fact)}
              </p>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => update({ [field]: [...items, emptyCondition()] })}
        className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
      >
        + {t("automationPage.agentEilAddCondition")}
      </button>
    </div>
  );

  const handleSave = () => {
    if (validationErrors.length > 0) return;
    const normalized = ensurePolicyId(
      {
        ...draft,
        id: draft.id?.trim() || slugifyPolicyId(draft.name ?? ""),
        requires: requires.filter((r) => r.fact?.trim()),
        forbids: forbids.filter((r) => r.fact?.trim()),
        blockWhenUnmet: draft.onViolation !== "warn" ? true : draft.blockWhenUnmet,
        idManuallyEdited,
      },
      locale,
    );
    onSave(normalized);
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/40 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-md flex-col border-l border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-700">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
            {draft.name?.trim() ? draft.name : t("automationPage.agentEilNewPolicy")}
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <label className="block">
            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
              {t("automationPage.agentEilPolicyName")} *
            </span>
            <input
              type="text"
              value={draft.name ?? ""}
              onChange={(e) => {
                const name = e.target.value;
                update({
                  name,
                  id: idManuallyEdited ? draft.id : slugifyPolicyId(name) || draft.id,
                });
              }}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
              {t("automationPage.agentEilPolicyDescription")}
            </span>
            <textarea
              value={draft.description ?? ""}
              onChange={(e) => update({ description: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
              {t("automationPage.agentEilPolicyId")}
            </span>
            <input
              type="text"
              value={draft.id ?? ""}
              onChange={(e) => {
                setIdManuallyEdited(true);
                update({ id: e.target.value, idManuallyEdited: true });
              }}
              className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
            />
          </label>

          <section>
            <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-200">
              1. {t("automationPage.agentEilWhenAgentTries")}
            </p>
            <SearchableActionSelect
              value={draft.action ?? ""}
              onChange={(actionId) => update({ action: actionId })}
              catalog={actionCatalog}
              eilConfig={eilConfig}
              locale={locale}
              t={t}
              className="mt-2"
            />
          </section>

          <section>
            <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-200">
              2. {t("automationPage.agentEilAllowWhen")}
            </p>
            <p className="mt-1 text-[10px] text-ink-500">{t("automationPage.agentEilRequireModeAnd")}</p>
            {renderConditionRows(requires, "requires")}
          </section>

          <section>
            <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-200">
              {t("automationPage.agentEilNeverAllowWhen")}
            </p>
            {renderConditionRows(forbids, "forbids")}
          </section>

          <section>
            <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-200">
              3. {t("automationPage.agentEilWhenUnknown")}
            </p>
            <select
              value={draft.onUnknown ?? "fetch"}
              onChange={(e) => update({ onUnknown: e.target.value as AgentEilPolicyDraft["onUnknown"] })}
              className="mt-2 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            >
              <option value="fetch">{t("automationPage.agentEilOnUnknownFetch")}</option>
              <option value="ask">{t("automationPage.agentEilOnUnknownAsk")}</option>
              <option value="block">{t("automationPage.agentEilOnUnknownBlock")}</option>
              <option value="ignore">{t("automationPage.agentEilOnUnknownIgnore")}</option>
            </select>
          </section>

          <section>
            <p className="text-[11px] font-semibold text-ink-800 dark:text-ink-200">
              4. {t("automationPage.agentEilWhenViolation")}
            </p>
            <select
              value={draft.onViolation ?? "block"}
              onChange={(e) => update({ onViolation: e.target.value as AgentEilPolicyDraft["onViolation"] })}
              className="mt-2 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            >
              <option value="block">{t("automationPage.agentEilOnViolationBlock")}</option>
              <option value="guide">{t("automationPage.agentEilOnViolationGuide")}</option>
              <option value="escalate">{t("automationPage.agentEilOnViolationEscalate")}</option>
              <option value="alert">{t("automationPage.agentEilOnViolationAlert")}</option>
              <option value="warn">{t("automationPage.agentEilOnViolationWarn")}</option>
            </select>
            {(draft.onViolation ?? "block") === "block" ? (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {t("automationPage.agentEilBlockWarning")}
              </p>
            ) : null}
          </section>

          <label className="block">
            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
              5. {t("automationPage.agentEilAgentInstruction")}
            </span>
            <textarea
              value={draft.instruction ?? ""}
              onChange={(e) => update({ instruction: e.target.value })}
              rows={3}
              placeholder={t("automationPage.agentEilAgentInstructionPlaceholder")}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            />
          </label>

          {validationErrors.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
              {validationErrors.map((err) => (
                <p key={err} className="flex items-start gap-1.5 text-[11px] text-amber-900 dark:text-amber-100">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {err}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-ink-100 px-4 py-3 dark:border-ink-700">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-xs font-semibold dark:border-ink-600"
          >
            {t("automationPage.cancel")}
          </button>
          <button
            type="button"
            disabled={validationErrors.length > 0}
            onClick={handleSave}
            className={clsx(
              "flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white",
              validationErrors.length > 0 ? "bg-brand-400/60" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {t("automationPage.agentEilSavePolicy")}
          </button>
        </div>
      </div>
    </div>
  );
}
