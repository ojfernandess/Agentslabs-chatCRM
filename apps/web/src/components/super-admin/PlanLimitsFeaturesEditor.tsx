import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import {
  KNOWN_PLAN_FEATURE_KEYS,
  KNOWN_PLAN_LIMIT_KEYS,
  featuresToJson,
  isKnownFeatureKey,
  isKnownLimitKey,
  limitsToJson,
  parseFeaturesObject,
  parseLimitsObject,
} from "@/lib/planCatalog";

type PlanLimitsFeaturesEditorProps = {
  limitsJson: string;
  featuresJson: string;
  onLimitsJsonChange: (value: string) => void;
  onFeaturesJsonChange: (value: string) => void;
  limitsError?: string | null;
  featuresError?: string | null;
};

function limitLabelKey(key: string): string {
  if (isKnownLimitKey(key)) return `superAdmin.billingLimitKey_${key}`;
  return key;
}

function featureLabelKey(key: string): string {
  if (isKnownFeatureKey(key)) return `superAdmin.billingFeatureKey_${key}`;
  return key;
}

export function PlanLimitsFeaturesEditor({
  limitsJson,
  featuresJson,
  onLimitsJsonChange,
  onFeaturesJsonChange,
  limitsError,
  featuresError,
}: PlanLimitsFeaturesEditorProps) {
  const { t } = useI18n();
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [addLimitKey, setAddLimitKey] = useState("");
  const [addFeatureKey, setAddFeatureKey] = useState("");
  const [customLimitKey, setCustomLimitKey] = useState("");
  const [customFeatureKey, setCustomFeatureKey] = useState("");

  const limits = useMemo(() => {
    try {
      return parseLimitsObject(JSON.parse(limitsJson));
    } catch {
      return {};
    }
  }, [limitsJson]);

  const features = useMemo(() => {
    try {
      return parseFeaturesObject(JSON.parse(featuresJson));
    } catch {
      return {};
    }
  }, [featuresJson]);

  const customLimitKeys = useMemo(
    () => Object.keys(limits).filter((k) => !isKnownLimitKey(k)).sort(),
    [limits],
  );

  const customFeatureKeys = useMemo(
    () => Object.keys(features).filter((k) => !isKnownFeatureKey(k)).sort(),
    [features],
  );

  const availableLimitKeys = useMemo(
    () =>
      KNOWN_PLAN_LIMIT_KEYS.filter((k) => !(k in limits) && !customLimitKeys.includes(k)),
    [limits, customLimitKeys],
  );

  const availableFeatureKeys = useMemo(
    () =>
      KNOWN_PLAN_FEATURE_KEYS.filter((k) => !(k in features) && !customFeatureKeys.includes(k)),
    [features, customFeatureKeys],
  );

  const updateLimits = useCallback(
    (next: Record<string, number | null>) => {
      onLimitsJsonChange(limitsToJson(next));
    },
    [onLimitsJsonChange],
  );

  const updateFeatures = useCallback(
    (next: Record<string, boolean>) => {
      onFeaturesJsonChange(featuresToJson(next));
    },
    [onFeaturesJsonChange],
  );

  const setLimitValue = (key: string, value: number | null | undefined) => {
    const next = { ...limits };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    updateLimits(next);
  };

  const setFeatureValue = (key: string, enabled: boolean) => {
    const next = { ...features, [key]: enabled };
    updateFeatures(next);
  };

  const removeLimit = (key: string) => {
    const next = { ...limits };
    delete next[key];
    updateLimits(next);
  };

  const removeFeature = (key: string) => {
    const next = { ...features };
    delete next[key];
    updateFeatures(next);
  };

  const addLimit = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed || trimmed in limits) return;
    updateLimits({ ...limits, [trimmed]: 0 });
    setAddLimitKey("");
    setCustomLimitKey("");
  };

  const addFeature = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed || trimmed in features) return;
    updateFeatures({ ...features, [trimmed]: false });
    setAddFeatureKey("");
  };

  useEffect(() => {
    if (jsonMode) setJsonExpanded(true);
  }, [jsonMode]);

  const renderLimitRow = (key: string, removable: boolean) => {
    const inLimits = key in limits;
    const unlimited = inLimits && limits[key] === null;
    const value = inLimits ? limits[key] : undefined;
    const label = isKnownLimitKey(key) ? t(limitLabelKey(key)) : key;

    return (
      <div
        key={key}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-soft-border dark:bg-ink-900/30"
      >
        <span className="min-w-[8rem] flex-1 text-sm font-medium text-ink-800 dark:text-ink-100">{label}</span>
        <input
          type="number"
          min={0}
          disabled={unlimited}
          value={unlimited || value == null ? "" : String(value)}
          onChange={(e) => {
            const n = e.target.value.trim();
            if (!n) {
              setLimitValue(key, 0);
              return;
            }
            setLimitValue(key, Math.max(0, Number(n)));
          }}
          className="input-field w-28 py-1.5 text-sm"
          placeholder={inLimits ? "0" : "—"}
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600 dark:text-ink-400">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(e) => setLimitValue(key, e.target.checked ? null : 0)}
          />
          {t("superAdmin.billingLimitUnlimited")}
        </label>
        {removable ? (
          <button
            type="button"
            onClick={() => removeLimit(key)}
            className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
            title={t("common.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  };

  const renderFeatureRow = (key: string, removable: boolean) => {
    const enabled = key in features ? features[key] === true : false;
    const label = isKnownFeatureKey(key) ? t(featureLabelKey(key)) : key;

    return (
      <div
        key={key}
        className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-soft-border dark:bg-ink-900/30"
      >
        <span className="flex-1 text-sm font-medium text-ink-800 dark:text-ink-100">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setFeatureValue(key, !enabled)}
          className={clsx(
            "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
            enabled ? "bg-brand-600" : "bg-ink-200 dark:bg-ink-700",
          )}
        >
          <span
            className={clsx(
              "pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="w-14 text-xs text-ink-500">
          {enabled ? t("superAdmin.billingFeatureOn") : t("superAdmin.billingFeatureOff")}
        </span>
        {removable ? (
          <button
            type="button"
            onClick={() => removeFeature(key)}
            className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
            title={t("common.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  };

  if (jsonMode) {
    return (
      <div className="sm:col-span-2 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-500">{t("superAdmin.billingJsonModeHint")}</p>
          <button
            type="button"
            className="text-xs font-medium text-brand-600 hover:underline"
            onClick={() => setJsonMode(false)}
          >
            {t("superAdmin.billingSwitchVisualMode")}
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-600">limits (JSON)</label>
          <textarea
            value={limitsJson}
            onChange={(e) => onLimitsJsonChange(e.target.value)}
            className="input-field mt-1 min-h-[120px] font-mono text-xs"
          />
          {limitsError ? <p className="mt-1 text-xs text-red-600">{limitsError}</p> : null}
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-600">features (JSON)</label>
          <textarea
            value={featuresJson}
            onChange={(e) => onFeaturesJsonChange(e.target.value)}
            className="input-field mt-1 min-h-[100px] font-mono text-xs"
          />
          {featuresError ? <p className="mt-1 text-xs text-red-600">{featuresError}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sm:col-span-2 space-y-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
            {t("superAdmin.billingLimitsSection")}
          </h4>
          <button
            type="button"
            className="text-xs font-medium text-brand-600 hover:underline"
            onClick={() => setJsonMode(true)}
          >
            {t("superAdmin.billingSwitchJsonMode")}
          </button>
        </div>
        <div className="space-y-2">
          {KNOWN_PLAN_LIMIT_KEYS.map((key) => renderLimitRow(key, false))}
          {customLimitKeys.map((key) => renderLimitRow(key, true))}
        </div>

        <div className="flex flex-wrap items-end gap-2 pt-1">
          {availableLimitKeys.length > 0 ? (
            <select
              value={addLimitKey}
              onChange={(e) => setAddLimitKey(e.target.value)}
              className="input-field w-44 py-1.5 text-sm"
            >
              <option value="">{t("superAdmin.billingAddKnownLimit")}</option>
              {availableLimitKeys.map((k) => (
                <option key={k} value={k}>
                  {t(`superAdmin.billingLimitKey_${k}`)}
                </option>
              ))}
            </select>
          ) : null}
          {addLimitKey ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => addLimit(addLimitKey)}>
              {t("common.add")}
            </button>
          ) : null}
          <input
            value={customLimitKey}
            onChange={(e) => setCustomLimitKey(e.target.value)}
            placeholder={t("superAdmin.billingCustomLimitKey")}
            className="input-field min-w-[10rem] flex-1 py-1.5 text-sm"
          />
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1 text-xs"
            disabled={!customLimitKey.trim()}
            onClick={() => addLimit(customLimitKey)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("superAdmin.billingAddCustomLimit")}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
          {t("superAdmin.billingFeaturesSection")}
        </h4>
        <div className="space-y-2">
          {KNOWN_PLAN_FEATURE_KEYS.map((key) => renderFeatureRow(key, false))}
          {customFeatureKeys.map((key) => renderFeatureRow(key, true))}
        </div>

        <div className="flex flex-wrap items-end gap-2 pt-1">
          {availableFeatureKeys.length > 0 ? (
            <select
              value={addFeatureKey}
              onChange={(e) => setAddFeatureKey(e.target.value)}
              className="input-field w-52 py-1.5 text-sm"
            >
              <option value="">{t("superAdmin.billingAddKnownFeature")}</option>
              {availableFeatureKeys.map((k) => (
                <option key={k} value={k}>
                  {t(`superAdmin.billingFeatureKey_${k}`)}
                </option>
              ))}
            </select>
          ) : null}
          {addFeatureKey ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => addFeature(addFeatureKey)}>
              {t("common.add")}
            </button>
          ) : null}
          <input
            value={customFeatureKey}
            onChange={(e) => setCustomFeatureKey(e.target.value)}
            placeholder={t("superAdmin.billingCustomFeatureKey")}
            className="input-field min-w-[10rem] flex-1 py-1.5 text-sm"
          />
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1 text-xs"
            disabled={!customFeatureKey.trim()}
            onClick={() => {
              addFeature(customFeatureKey);
              setCustomFeatureKey("");
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("superAdmin.billingAddCustomFeature")}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-slate-200 dark:border-soft-border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-ink-500 hover:text-ink-700"
          onClick={() => setJsonExpanded((v) => !v)}
        >
          <span>{t("superAdmin.billingJsonPreview")}</span>
          {jsonExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {jsonExpanded ? (
          <div className="grid gap-3 border-t border-slate-200 px-3 pb-3 pt-2 dark:border-soft-border sm:grid-cols-2">
            <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-ink-700 dark:bg-ink-900/40">
              {limitsJson}
            </pre>
            <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-ink-700 dark:bg-ink-900/40">
              {featuresJson}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
