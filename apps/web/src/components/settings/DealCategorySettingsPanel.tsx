import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { Briefcase, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { motion } from "@/components/Motion";
import type { DealCategoryContext } from "@/components/crm/DealCategoryFieldsForm";

type Tab = "general" | "fields" | "options" | "products" | "automation";

type CatalogItem = { id: string; labelPt: string; labelEn: string };

type FieldOverrideRow = {
  categoryKey: string;
  fieldKey: string;
  enabled: boolean;
  required: boolean;
  sortOrder: number;
};

type OptionSetRow = {
  id: string;
  setKey: string;
  label: string;
  options: { id: string; name: string; enabled: boolean; sortOrder: number }[];
};

type ProductCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
};

export function DealCategorySettingsPanel() {
  const { t, locale } = useI18n();
  const pt = locale.startsWith("pt");

  const [tab, setTab] = useState<Tab>("general");
  const [context, setContext] = useState<DealCategoryContext | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [optionSets, setOptionSets] = useState<OptionSetRow[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategoryRow[]>([]);
  const [fieldConfig, setFieldConfig] = useState<{
    categoryKey: string;
    fields: DealCategoryContext["fields"];
    overrides: FieldOverrideRow[];
  } | null>(null);

  const [activeCategory, setActiveCategory] = useState("default");
  const [autoLineItems, setAutoLineItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [newOptionName, setNewOptionName] = useState<Record<string, string>>({});
  const [newProductCatName, setNewProductCatName] = useState("");

  const loadAll = useCallback(async () => {
    const [ctxRes, catRes, setsRes, pcRes] = await Promise.all([
      api.get<{ data: DealCategoryContext }>("/crm/deal-category-context"),
      api.get<{ data: CatalogItem[] }>("/crm/deal-categories"),
      api.get<{ data: OptionSetRow[] }>("/crm/deal-option-sets"),
      api.get<{ data: ProductCategoryRow[] }>("/crm/product-categories"),
    ]);
    setContext(ctxRes.data);
    setCatalog(catRes.data);
    setOptionSets(setsRes.data);
    setProductCategories(pcRes.data);
    setActiveCategory(ctxRes.data.settings.activeCategory);
    setAutoLineItems(ctxRes.data.settings.autoGenerateLineItems);

    const fc = await api.get<{
      data: { categoryKey: string; fields: DealCategoryContext["fields"]; overrides: FieldOverrideRow[] };
    }>(`/crm/deal-field-config?categoryKey=${encodeURIComponent(ctxRes.data.settings.activeCategory)}`);
    setFieldConfig(fc.data);
  }, []);

  useEffect(() => {
    void loadAll().catch(() => setError(t("dealCategorySettings.loadError")));
  }, [loadAll, t]);

  const categoryLabel = (id: string) => {
    const c = catalog.find((x) => x.id === id);
    if (!c) return id;
    return pt ? c.labelPt : c.labelEn;
  };

  const relevantOptionSets = useMemo(() => {
    if (!activeCategory || activeCategory === "default") return optionSets;
    return optionSets.filter((s) => !s.setKey || true);
  }, [optionSets, activeCategory]);

  const saveGeneral = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.patch("/crm/deal-settings", {
        activeCategory,
        autoGenerateLineItems: autoLineItems,
      });
      setMessage(t("dealCategorySettings.saved"));
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("dealCategorySettings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const toggleField = async (fieldKey: string, patch: Partial<{ enabled: boolean; required: boolean }>) => {
    if (!fieldConfig) return;
    const existing = fieldConfig.overrides.find((o) => o.fieldKey === fieldKey);
    const field = fieldConfig.fields.find((f) => f.key === fieldKey);
    if (!field) return;
    const next: FieldOverrideRow = {
      categoryKey: fieldConfig.categoryKey,
      fieldKey,
      enabled: patch.enabled ?? existing?.enabled ?? field.enabled !== false,
      required: patch.required ?? existing?.required ?? field.required === true,
      sortOrder: existing?.sortOrder ?? field.sortOrder,
    };
    await api.put("/crm/deal-field-overrides", { overrides: [next] });
    await loadAll();
  };

  const addOption = async (setKey: string) => {
    const name = (newOptionName[setKey] ?? "").trim();
    if (!name) return;
    await api.post(`/crm/deal-option-sets/${encodeURIComponent(setKey)}/options`, { name });
    setNewOptionName((p) => ({ ...p, [setKey]: "" }));
    await loadAll();
  };

  const deleteOption = async (optionId: string) => {
    await api.delete(`/crm/deal-option-set-options/${optionId}`);
    await loadAll();
  };

  const addProductCategory = async () => {
    const name = newProductCatName.trim();
    if (!name) return;
    await api.post("/crm/product-categories", { name, dealCategoryKey: activeCategory !== "default" ? activeCategory : null });
    setNewProductCatName("");
    await loadAll();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: t("dealCategorySettings.tabGeneral") },
    { id: "fields", label: t("dealCategorySettings.tabFields") },
    { id: "options", label: t("dealCategorySettings.tabOptions") },
    { id: "products", label: t("dealCategorySettings.tabProducts") },
    { id: "automation", label: t("dealCategorySettings.tabAutomation") },
  ];

  return (
    <motion.div className="card-surface mt-6 rounded-xl p-6">
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
        <Briefcase className="h-5 w-5" />
        {t("dealCategorySettings.title")}
      </h2>
      <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">{t("dealCategorySettings.hint")}</p>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-ink-200 pb-2 dark:border-soft-border">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              tab === tb.id
                ? "bg-brand-100 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
                : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800",
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

      {tab === "general" ? (
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
              {t("dealCategorySettings.activeCategory")}
            </label>
            <select
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
              className="mt-1 w-full input-field"
            >
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {pt ? c.labelPt : c.labelEn}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-500">{t("dealCategorySettings.activeCategoryHint")}</p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveGeneral()}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      ) : null}

      {tab === "fields" && fieldConfig ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-500">
            {t("dealCategorySettings.fieldsFor")}: {categoryLabel(fieldConfig.categoryKey)}
          </p>
          {fieldConfig.fields.length === 0 ? (
            <p className="text-sm text-ink-500">{t("dealCategorySettings.noFields")}</p>
          ) : (
            <ul className="divide-y divide-ink-100 rounded-lg border dark:divide-white/10 dark:border-soft-border">
              {fieldConfig.fields.map((f) => {
                const ov = fieldConfig.overrides.find((o) => o.fieldKey === f.key);
                const enabled = ov?.enabled ?? f.enabled !== false;
                const required = ov?.required ?? f.required === true;
                return (
                  <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{pt ? f.labelPt : f.labelEn}</span>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => void toggleField(f.key, { enabled: e.target.checked })}
                        />
                        {t("dealCategorySettings.fieldEnabled")}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={required}
                          disabled={!enabled}
                          onChange={(e) => void toggleField(f.key, { required: e.target.checked })}
                        />
                        {t("dealCategorySettings.fieldRequired")}
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "options" ? (
        <div className="space-y-6">
          {relevantOptionSets.length === 0 ? (
            <p className="text-sm text-ink-500">{t("dealCategorySettings.noOptionSets")}</p>
          ) : (
            relevantOptionSets.map((set) => (
              <div key={set.id} className="rounded-lg border p-4 dark:border-soft-border">
                <h3 className="font-medium text-ink-900 dark:text-ink-50">{set.label}</h3>
                <ul className="mt-2 space-y-1">
                  {set.options.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{o.name}</span>
                      <button
                        type="button"
                        onClick={() => void deleteOption(o.id)}
                        className="text-red-600 hover:text-red-700"
                        title={t("common.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <input
                    value={newOptionName[set.setKey] ?? ""}
                    onChange={(e) => setNewOptionName((p) => ({ ...p, [set.setKey]: e.target.value }))}
                    placeholder={t("dealCategorySettings.newOptionPlaceholder")}
                    className="flex-1 input-field text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void addOption(set.setKey)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white"
                  >
                    <Plus className="h-4 w-4" />
                    {t("common.add")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "products" ? (
        <div className="space-y-4 max-w-lg">
          <ul className="divide-y rounded-lg border dark:divide-white/10 dark:border-soft-border">
            {productCategories.map((pc) => (
              <li key={pc.id} className="px-3 py-2 text-sm">
                {pc.name}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={newProductCatName}
              onChange={(e) => setNewProductCatName(e.target.value)}
              placeholder={t("dealCategorySettings.productCategoryName")}
              className="flex-1 input-field text-sm"
            />
            <button
              type="button"
              onClick={() => void addProductCategory()}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white"
            >
              {t("common.add")}
            </button>
          </div>
        </div>
      ) : null}

      {tab === "automation" ? (
        <div className="max-w-lg space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={autoLineItems}
              onChange={(e) => setAutoLineItems(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink-900 dark:text-ink-50">
                {t("dealCategorySettings.autoLineItems")}
              </span>
              <span className="mt-0.5 block text-ink-500">{t("dealCategorySettings.autoLineItemsHint")}</span>
            </span>
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveGeneral()}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      ) : null}
    </motion.div>
  );
}
