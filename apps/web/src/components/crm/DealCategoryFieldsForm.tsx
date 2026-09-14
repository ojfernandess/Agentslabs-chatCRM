import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { getDealCategoryById, suggestAmountCentsFromCategoryData } from "@openconduit/shared";

export type DealCategoryFieldDef = {
  key: string;
  labelPt: string;
  labelEn: string;
  type: string;
  required?: boolean;
  enabled?: boolean;
  sortOrder: number;
  optionSetKey?: string;
  computeHint?: string;
};

export type DealOptionSetOption = {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
};

export type DealOptionSet = {
  id: string;
  setKey: string;
  label: string;
  categoryKey: string | null;
  options: DealOptionSetOption[];
};

export type DealCategoryCatalogItem = {
  id: string;
  labelPt: string;
  labelEn: string;
  dealTypes?: { key: string; labelPt: string; labelEn: string }[];
};

export type DealCategoryContext = {
  settings: { activeCategory: string; autoGenerateLineItems: boolean };
  fields: DealCategoryFieldDef[];
  optionSets: DealOptionSet[];
  catalog: DealCategoryCatalogItem[];
};

type Props = {
  context: DealCategoryContext;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onSuggestedAmountCents?: (cents: number | null) => void;
  compact?: boolean;
};

function moneyInputFromCents(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (n / 100).toFixed(2);
}

function parseMoneyToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Input monetário com rascunho local — evita reformatar a cada tecla (ex.: "4" → "4.00"). */
function MoneyFieldInput({
  fieldKey,
  centsValue,
  onCommit,
  inputClass,
  placeholder,
}: {
  fieldKey: string;
  centsValue: unknown;
  onCommit: (cents: number | undefined) => void;
  inputClass: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(() => moneyInputFromCents(centsValue));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(moneyInputFromCents(centsValue));
    }
  }, [centsValue, fieldKey]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const cents = parseMoneyToCents(draft);
        onCommit(cents ?? undefined);
        if (cents != null) {
          setDraft(moneyInputFromCents(cents));
        }
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const cents = parseMoneyToCents(raw);
        onCommit(cents ?? undefined);
      }}
      className={inputClass}
      placeholder={placeholder}
    />
  );
}

export function DealCategoryFieldsForm({
  context,
  values,
  onChange,
  onSuggestedAmountCents,
  compact = false,
}: Props) {
  const { locale } = useI18n();
  const pt = locale.startsWith("pt");

  const activeCategory = context.settings.activeCategory;
  const catDef = useMemo(() => getDealCategoryById(activeCategory), [activeCategory]);

  if (activeCategory === "default" || context.fields.length === 0) {
    return null;
  }

  const optionMap = useMemo(() => {
    const m = new Map<string, DealOptionSetOption[]>();
    for (const s of context.optionSets) {
      m.set(s.setKey, s.options.filter((o) => o.enabled));
    }
    return m;
  }, [context.optionSets]);

  const setField = (key: string, value: unknown) => {
    const next = { ...values, [key]: value };
    onChange(next);
    if (onSuggestedAmountCents) {
      onSuggestedAmountCents(suggestAmountCentsFromCategoryData(activeCategory, next));
    }
  };

  const labelFor = (f: DealCategoryFieldDef) => (pt ? f.labelPt : f.labelEn);

  const inputClass =
    "mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100";

  return (
    <div className={compact ? "space-y-3" : "space-y-4 rounded-xl border border-ink-200 bg-ink-50/60 p-4 dark:border-soft-border dark:bg-ink-800/40"}>
      {!compact ? (
        <div>
          <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
            {pt ? "Detalhes da oportunidade" : "Opportunity details"}
          </p>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            {pt ? catDef.labelPt : catDef.labelEn}
          </p>
        </div>
      ) : null}

      {context.fields.map((field) => {
        const req = field.required ? " *" : "";
        const val = values[field.key];

        if (field.key === "dealType" && catDef.dealTypes?.length) {
          return (
            <div key={field.key}>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                {labelFor(field)}
                {req}
              </label>
              <select
                value={typeof val === "string" ? val : ""}
                onChange={(e) => setField(field.key, e.target.value || undefined)}
                className={inputClass}
              >
                <option value="">{pt ? "Selecionar…" : "Select…"}</option>
                {catDef.dealTypes.map((dt) => (
                  <option key={dt.key} value={dt.key}>
                    {pt ? dt.labelPt : dt.labelEn}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (field.type === "select" && field.optionSetKey) {
          const opts = optionMap.get(field.optionSetKey) ?? [];
          return (
            <div key={field.key}>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                {labelFor(field)}
                {req}
              </label>
              <select
                value={typeof val === "string" ? val : ""}
                onChange={(e) => setField(field.key, e.target.value || undefined)}
                className={inputClass}
              >
                <option value="">{pt ? "Selecionar…" : "Select…"}</option>
                {opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (field.type === "money") {
          return (
            <div key={field.key}>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                {labelFor(field)}
                {req}
              </label>
              <MoneyFieldInput
                fieldKey={field.key}
                centsValue={val}
                onCommit={(cents) => setField(field.key, cents)}
                inputClass={inputClass}
                placeholder={pt ? "0,00" : "0.00"}
              />
            </div>
          );
        }

        if (field.type === "number" || field.type === "percentage") {
          return (
            <div key={field.key}>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                {labelFor(field)}
                {req}
              </label>
              <input
                type="number"
                value={val === undefined || val === null ? "" : String(val)}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  setField(field.key, Number.isFinite(n!) ? n : undefined);
                }}
                className={inputClass}
                min={0}
              />
            </div>
          );
        }

        if (field.type === "date") {
          return (
            <div key={field.key}>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                {labelFor(field)}
                {req}
              </label>
              <input
                type="date"
                value={typeof val === "string" ? val : ""}
                onChange={(e) => setField(field.key, e.target.value || undefined)}
                className={inputClass}
              />
            </div>
          );
        }

        if (field.type === "boolean") {
          return (
            <label key={field.key} className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
              <input
                type="checkbox"
                checked={Boolean(val)}
                onChange={(e) => setField(field.key, e.target.checked)}
                className="rounded border-ink-300"
              />
              {labelFor(field)}
              {req}
            </label>
          );
        }

        return (
          <div key={field.key}>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
              {labelFor(field)}
              {req}
            </label>
            <input
              type="text"
              value={typeof val === "string" ? val : val != null ? String(val) : ""}
              onChange={(e) => setField(field.key, e.target.value || undefined)}
              className={inputClass}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Exibe valores de categoryData no detalhe do negócio (somente leitura). */
export function DealCategoryDetailsReadonly({
  context,
  category,
  categoryData,
}: {
  context: DealCategoryContext | null;
  category: string | null | undefined;
  categoryData: Record<string, unknown> | null | undefined;
}) {
  const { locale } = useI18n();
  const pt = locale.startsWith("pt");
  if (!category || category === "default" || !categoryData || !context) return null;

  const catDef = getDealCategoryById(category);
  const fields = context.fields.length
    ? context.fields
    : catDef.fields.map((f) => ({ ...f, enabled: true, required: false }));

  const optionLabel = (setKey: string | undefined, id: unknown): string => {
    if (!setKey || typeof id !== "string") return typeof id === "string" ? id : "—";
    const set = context.optionSets.find((s) => s.setKey === setKey);
    return set?.options.find((o) => o.id === id)?.name ?? id;
  };

  const formatVal = (key: string, type: string, raw: unknown): string => {
    if (raw === undefined || raw === null || raw === "") return "—";
    if (key === "dealType" && typeof raw === "string") {
      const dt = catDef.dealTypes?.find((d) => d.key === raw);
      return dt ? (pt ? dt.labelPt : dt.labelEn) : raw;
    }
    if (type === "money") {
      const n = Number(raw);
      return Number.isFinite(n) ? `R$ ${(n / 100).toFixed(2)}` : "—";
    }
    if (type === "boolean") return raw ? (pt ? "Sim" : "Yes") : pt ? "Não" : "No";
    return String(raw);
  };

  const rows = fields
    .map((f) => {
      const raw = categoryData[f.key];
      if (raw === undefined || raw === null || raw === "") return null;
      if (f.type === "select" && f.optionSetKey) {
        return { label: pt ? f.labelPt : f.labelEn, value: optionLabel(f.optionSetKey, raw) };
      }
      return { label: pt ? f.labelPt : f.labelEn, value: formatVal(f.key, f.type, raw) };
    })
    .filter(Boolean) as { label: string; value: string }[];

  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-ink-200 p-4 dark:border-soft-border">
      <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
        {pt ? "Detalhes do negócio" : "Deal details"}
      </h4>
      <p className="mt-0.5 text-xs text-ink-500">{pt ? catDef.labelPt : catDef.labelEn}</p>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-4">
            <dt className="text-ink-500 dark:text-ink-400">{r.label}</dt>
            <dd className="font-medium text-ink-900 dark:text-ink-100">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
