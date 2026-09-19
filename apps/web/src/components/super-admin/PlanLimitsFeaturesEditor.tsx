import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import {
  ALL_CATALOG_FEATURE_KEYS,
  ALL_CATALOG_LIMIT_KEYS,
  KNOWN_PLAN_FEATURE_KEYS,
  KNOWN_PLAN_LIMIT_KEYS,
  SUGGESTED_PLAN_EXTRA_KEYS,
  catalogExtraLabelKey,
  catalogFeatureLabelKey,
  catalogLimitLabelKey,
  extrasToJson,
  featuresToJson,
  isKnownFeatureKey,
  isKnownLimitKey,
  isSuggestedExtraKey,
  isInternalPlanFeatureKey,
  isPlanLimitEnabled,
  isSuggestedFeatureKey,
  isSuggestedLimitKey,
  limitsDocumentToJson,
  parseExtrasObject,
  parseFeaturesObject,
  parseLimitsDocument,
} from "@/lib/planCatalog";

type PlanLimitsFeaturesEditorProps = {
  limitsJson: string;
  featuresJson: string;
  extrasJson?: string;
  onLimitsJsonChange: (value: string) => void;
  onFeaturesJsonChange: (value: string) => void;
  onExtrasJsonChange?: (value: string) => void;
  limitsError?: string | null;
  featuresError?: string | null;
  extrasError?: string | null;
};

function resolveLabel(t: (key: string) => string, catalogKey: string | null, fallback: string): string {
  if (catalogKey) {
    const translated = t(catalogKey);
    if (translated !== catalogKey) return translated;
  }
  return fallback.replace(/_/g, " ");
}

export function PlanLimitsFeaturesEditor({
  limitsJson,
  featuresJson,
  extrasJson = "{}",
  onLimitsJsonChange,
  onFeaturesJsonChange,
  onExtrasJsonChange,
  limitsError,
  featuresError,
  extrasError,
}: PlanLimitsFeaturesEditorProps) {
  const { t } = useI18n();
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [pickLimitKey, setPickLimitKey] = useState("");
  const [pickFeatureKey, setPickFeatureKey] = useState("");
  const [pickExtraKey, setPickExtraKey] = useState("");
  const [customLimitKey, setCustomLimitKey] = useState("");
  const [customFeatureKey, setCustomFeatureKey] = useState("");
  const [customExtraKey, setCustomExtraKey] = useState("");

  const limitsDoc = useMemo(() => {
    try {
      return parseLimitsDocument(JSON.parse(limitsJson));
    } catch {
      return { limits: {}, enabled: {} };
    }
  }, [limitsJson]);

  const limits = limitsDoc.limits;
  const limitEnabled = limitsDoc.enabled;

  const features = useMemo(() => {
    try {
      return parseFeaturesObject(JSON.parse(featuresJson));
    } catch {
      return {};
    }
  }, [featuresJson]);

  const extras = useMemo(() => {
    try {
      return parseExtrasObject(JSON.parse(extrasJson));
    } catch {
      return {};
    }
  }, [extrasJson]);

  const customLimitKeys = useMemo(
    () =>
      Object.keys(limits)
        .filter((k) => !isKnownLimitKey(k) && !isSuggestedLimitKey(k))
        .sort(),
    [limits],
  );

  const suggestedLimitKeys = useMemo(
    () =>
      Object.keys(limits)
        .filter((k) => isSuggestedLimitKey(k))
        .sort(),
    [limits],
  );

  const customFeatureKeys = useMemo(
    () =>
      Object.keys(features)
        .filter((k) => !isKnownFeatureKey(k) && !isSuggestedFeatureKey(k) && !isInternalPlanFeatureKey(k))
        .sort(),
    [features],
  );

  const suggestedFeatureKeys = useMemo(
    () =>
      Object.keys(features)
        .filter((k) => isSuggestedFeatureKey(k))
        .sort(),
    [features],
  );

  const customExtraKeys = useMemo(
    () =>
      Object.keys(extras)
        .filter((k) => !isSuggestedExtraKey(k))
        .sort(),
    [extras],
  );

  const availableCatalogLimitKeys = useMemo(
    () => ALL_CATALOG_LIMIT_KEYS.filter((k) => !(k in limits)),
    [limits],
  );

  const availableCatalogFeatureKeys = useMemo(
    () => ALL_CATALOG_FEATURE_KEYS.filter((k) => !(k in features)),
    [features],
  );

  const availableSuggestedExtraKeys = useMemo(
    () => SUGGESTED_PLAN_EXTRA_KEYS.filter((k) => !(k in extras)),
    [extras],
  );

  const updateLimitsDocument = useCallback(
    (nextLimits: Record<string, number | null>, nextEnabled: Record<string, boolean>) => {
      onLimitsJsonChange(limitsDocumentToJson(nextLimits, nextEnabled));
    },
    [onLimitsJsonChange],
  );

  const updateFeatures = useCallback(
    (next: Record<string, boolean>) => {
      onFeaturesJsonChange(featuresToJson(next));
    },
    [onFeaturesJsonChange],
  );

  const updateExtras = useCallback(
    (next: Record<string, string>) => {
      onExtrasJsonChange?.(extrasToJson(next));
    },
    [onExtrasJsonChange],
  );

  const setLimitValue = (key: string, value: number | null | undefined) => {
    const next = { ...limits };
    if (value === undefined) delete next[key];
    else next[key] = value;
    updateLimitsDocument(next, limitEnabled);
  };

  const setLimitEnabledFlag = (key: string, active: boolean) => {
    const nextEnabled = { ...limitEnabled };
    if (active) delete nextEnabled[key];
    else nextEnabled[key] = false;
    updateLimitsDocument(limits, nextEnabled);
  };

  const setFeatureValue = (key: string, enabled: boolean) => {
    updateFeatures({ ...features, [key]: enabled });
  };

  const setExtraValue = (key: string, value: string) => {
    const next = { ...extras };
    const trimmed = value.trim();
    if (!trimmed) delete next[key];
    else next[key] = trimmed;
    updateExtras(next);
  };

  const removeLimit = (key: string) => {
    const next = { ...limits };
    delete next[key];
    const nextEnabled = { ...limitEnabled };
    delete nextEnabled[key];
    updateLimitsDocument(next, nextEnabled);
  };

  const removeFeature = (key: string) => {
    const next = { ...features };
    delete next[key];
    updateFeatures(next);
  };

  const removeExtra = (key: string) => {
    const next = { ...extras };
    delete next[key];
    updateExtras(next);
  };

  const addLimit = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed || trimmed in limits) return;
    const nextEnabled = { ...limitEnabled };
    delete nextEnabled[trimmed];
    updateLimitsDocument({ ...limits, [trimmed]: 0 }, nextEnabled);
    setPickLimitKey("");
    setCustomLimitKey("");
  };

  const addFeature = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed || trimmed in features) return;
    updateFeatures({ ...features, [trimmed]: false });
    setPickFeatureKey("");
    setCustomFeatureKey("");
  };

  const addExtra = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed || trimmed in extras) return;
    updateExtras({ ...extras, [trimmed]: "" });
    setPickExtraKey("");
    setCustomExtraKey("");
  };

  useEffect(() => {
    if (jsonMode) setJsonExpanded(true);
  }, [jsonMode]);

  const limitLabel = (key: string) =>
    resolveLabel(t, catalogLimitLabelKey(key), key);

  const featureLabel = (key: string) =>
    resolveLabel(t, catalogFeatureLabelKey(key), key);

  const extraLabel = (key: string) =>
    resolveLabel(t, catalogExtraLabelKey(key), key);

  const renderLimitRow = (key: string, removable: boolean) => {
    const inLimits = key in limits;
    const active = isPlanLimitEnabled(key, limitEnabled);
    const unlimited = inLimits && limits[key] === null;
    const value = inLimits ? limits[key] : undefined;

    return (
      <div
        key={key}
        className={clsx(
          "flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-soft-border dark:bg-ink-900/30",
          !active && "opacity-60",
        )}
      >
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={() => setLimitEnabledFlag(key, !active)}
          className={clsx(
            "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
            active ? "bg-brand-600" : "bg-ink-200 dark:bg-ink-700",
          )}
          title={active ? t("superAdmin.billingFeatureOn") : t("superAdmin.billingFeatureOff")}
        >
          <span
            className={clsx(
              "pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform",
              active ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="min-w-[8rem] flex-1 text-sm font-medium text-ink-800 dark:text-ink-100">
          {limitLabel(key)}
        </span>
        <input
          type="number"
          min={0}
          disabled={!active || unlimited}
          value={unlimited || value == null ? "" : String(value)}
          onChange={(e) => {
            const n = e.target.value.trim();
            if (!n) {
              setLimitValue(key, 0);
              return;
            }
            setLimitValue(key, Math.max(0, Number(n)));
          }}
          className="input-field w-28 py-1.5 text-sm disabled:cursor-not-allowed"
          placeholder={inLimits ? "0" : "—"}
        />
        <label
          className={clsx(
            "flex items-center gap-1.5 text-xs text-ink-600 dark:text-ink-400",
            active ? "cursor-pointer" : "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="checkbox"
            checked={unlimited}
            disabled={!active}
            onChange={(e) => setLimitValue(key, e.target.checked ? null : 0)}
          />
          {t("superAdmin.billingLimitUnlimited")}
        </label>
        <span className="w-14 text-xs text-ink-500">
          {active ? t("superAdmin.billingFeatureOn") : t("superAdmin.billingFeatureOff")}
        </span>
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

    return (
      <div
        key={key}
        className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-soft-border dark:bg-ink-900/30"
      >
        <span className="flex-1 text-sm font-medium text-ink-800 dark:text-ink-100">
          {featureLabel(key)}
        </span>
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

  const renderExtraRow = (key: string, removable: boolean) => (
    <div
      key={key}
      className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-soft-border dark:bg-ink-900/30"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-800 dark:text-ink-100">{extraLabel(key)}</span>
        {removable ? (
          <button
            type="button"
            onClick={() => removeExtra(key)}
            className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
            title={t("common.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <textarea
        value={extras[key] ?? ""}
        onChange={(e) => setExtraValue(key, e.target.value)}
        className="input-field min-h-[64px] w-full text-sm"
        placeholder={t("superAdmin.billingExtraValuePlaceholder")}
      />
    </div>
  );

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
        {onExtrasJsonChange ? (
          <div>
            <label className="block text-xs font-medium text-ink-600">extras (JSON)</label>
            <textarea
              value={extrasJson}
              onChange={(e) => onExtrasJsonChange(e.target.value)}
              className="input-field mt-1 min-h-[100px] font-mono text-xs"
            />
            {extrasError ? <p className="mt-1 text-xs text-red-600">{extrasError}</p> : null}
          </div>
        ) : null}
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
          {suggestedLimitKeys.map((key) => renderLimitRow(key, true))}
          {customLimitKeys.map((key) => renderLimitRow(key, true))}
        </div>

        <div className="flex flex-wrap items-end gap-2 pt-1">
          {availableCatalogLimitKeys.length > 0 ? (
            <select
              value={pickLimitKey}
              onChange={(e) => setPickLimitKey(e.target.value)}
              className="input-field w-52 py-1.5 text-sm"
            >
              <option value="">{t("superAdmin.billingPickCatalogLimit")}</option>
              {availableCatalogLimitKeys.map((k) => (
                <option key={k} value={k}>
                  {limitLabel(k)}
                </option>
              ))}
            </select>
          ) : null}
          {pickLimitKey ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => addLimit(pickLimitKey)}>
              {t("common.add")}
            </button>
          ) : null}
          <input
            value={customLimitKey}
            onChange={(e) => setCustomLimitKey(e.target.value)}
            list="plan-custom-limit-suggestions"
            placeholder={t("superAdmin.billingCustomLimitKey")}
            className="input-field min-w-[10rem] flex-1 py-1.5 text-sm"
          />
          <datalist id="plan-custom-limit-suggestions">
            {availableCatalogLimitKeys.map((k) => (
              <option key={k} value={k} label={limitLabel(k)} />
            ))}
          </datalist>
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
          {suggestedFeatureKeys.map((key) => renderFeatureRow(key, true))}
          {customFeatureKeys.map((key) => renderFeatureRow(key, true))}
        </div>

        <div className="flex flex-wrap items-end gap-2 pt-1">
          {availableCatalogFeatureKeys.length > 0 ? (
            <select
              value={pickFeatureKey}
              onChange={(e) => setPickFeatureKey(e.target.value)}
              className="input-field w-56 py-1.5 text-sm"
            >
              <option value="">{t("superAdmin.billingPickCatalogFeature")}</option>
              {availableCatalogFeatureKeys.map((k) => (
                <option key={k} value={k}>
                  {featureLabel(k)}
                </option>
              ))}
            </select>
          ) : null}
          {pickFeatureKey ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => addFeature(pickFeatureKey)}>
              {t("common.add")}
            </button>
          ) : null}
          <input
            value={customFeatureKey}
            onChange={(e) => setCustomFeatureKey(e.target.value)}
            list="plan-custom-feature-suggestions"
            placeholder={t("superAdmin.billingCustomFeatureKey")}
            className="input-field min-w-[10rem] flex-1 py-1.5 text-sm"
          />
          <datalist id="plan-custom-feature-suggestions">
            {availableCatalogFeatureKeys.map((k) => (
              <option key={k} value={k} label={featureLabel(k)} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1 text-xs"
            disabled={!customFeatureKey.trim()}
            onClick={() => addFeature(customFeatureKey)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("superAdmin.billingAddCustomFeature")}
          </button>
        </div>
      </div>

      {onExtrasJsonChange ? (
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
              {t("superAdmin.billingExtrasSection")}
            </h4>
            <p className="mt-1 text-xs text-ink-500">{t("superAdmin.billingExtrasSectionHint")}</p>
          </div>
          <div className="space-y-2">
            {SUGGESTED_PLAN_EXTRA_KEYS.filter((k) => k in extras).map((key) => renderExtraRow(key, true))}
            {customExtraKeys.map((key) => renderExtraRow(key, true))}
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            {availableSuggestedExtraKeys.length > 0 ? (
              <select
                value={pickExtraKey}
                onChange={(e) => setPickExtraKey(e.target.value)}
                className="input-field w-56 py-1.5 text-sm"
              >
                <option value="">{t("superAdmin.billingPickCatalogExtra")}</option>
                {availableSuggestedExtraKeys.map((k) => (
                  <option key={k} value={k}>
                    {extraLabel(k)}
                  </option>
                ))}
              </select>
            ) : null}
            {pickExtraKey ? (
              <button type="button" className="btn-secondary text-xs" onClick={() => addExtra(pickExtraKey)}>
                {t("common.add")}
              </button>
            ) : null}
            <input
              value={customExtraKey}
              onChange={(e) => setCustomExtraKey(e.target.value)}
              list="plan-custom-extra-suggestions"
              placeholder={t("superAdmin.billingCustomExtraKey")}
              className="input-field min-w-[10rem] flex-1 py-1.5 text-sm"
            />
            <datalist id="plan-custom-extra-suggestions">
              {availableSuggestedExtraKeys.map((k) => (
                <option key={k} value={k} label={extraLabel(k)} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1 text-xs"
              disabled={!customExtraKey.trim()}
              onClick={() => addExtra(customExtraKey)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("superAdmin.billingAddCustomExtra")}
            </button>
          </div>
          {extrasError ? <p className="text-xs text-red-600">{extrasError}</p> : null}
        </div>
      ) : null}

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
          <div
            className={clsx(
              "grid gap-3 border-t border-slate-200 px-3 pb-3 pt-2 dark:border-soft-border",
              onExtrasJsonChange ? "sm:grid-cols-3" : "sm:grid-cols-2",
            )}
          >
            <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-ink-700 dark:bg-ink-900/40">
              {limitsJson}
            </pre>
            <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-ink-700 dark:bg-ink-900/40">
              {featuresJson}
            </pre>
            {onExtrasJsonChange ? (
              <pre className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-ink-700 dark:bg-ink-900/40">
                {extrasJson}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
