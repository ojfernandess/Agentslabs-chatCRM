import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import type { MercadoPagoCatalogRow, StripeCatalogRow } from "./paymentToolCatalog";

type Translate = (key: string) => string;

const fieldCls =
  "mt-1 w-full rounded border border-ink-200 px-2 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100";

export function StripeCatalogEditor({
  rows,
  t,
  onChange,
}: {
  rows: StripeCatalogRow[];
  t: Translate;
  onChange: (rows: StripeCatalogRow[]) => void;
}) {
  const updateRow = (id: string, patch: Partial<StripeCatalogRow>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
      <p className="text-xs font-medium text-ink-800 dark:text-ink-100">{t("automationPage.toolPaymentCatalogTitle")}</p>
      <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.toolStripeCatalogHelp")}</p>
      <div className="mt-3 space-y-3">
        {rows.map((row, index) => (
          <div key={row.id} className="rounded-lg border border-ink-100 bg-ink-50/50 p-2.5 dark:border-ink-700 dark:bg-ink-900/40">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-ink-600 dark:text-ink-300">
                {t("automationPage.toolPaymentCatalogItem")} {index + 1}
              </span>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-ink-600 dark:text-ink-400">
                  <input
                    type="radio"
                    name="stripe-default-plan"
                    checked={row.isDefault}
                    onChange={() => onChange(rows.map((r) => ({ ...r, isDefault: r.id === row.id })))}
                  />
                  {t("automationPage.toolPaymentCatalogDefault")}
                </label>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t("automationPage.toolPaymentCatalogRemove")}
                    onClick={() => {
                      const next = rows.filter((r) => r.id !== row.id);
                      if (next.length > 0 && !next.some((r) => r.isDefault)) next[0]!.isDefault = true;
                      onChange(next.length > 0 ? next : rows);
                    }}
                    className="rounded p-1 text-ink-400 hover:bg-ink-200/60 hover:text-rose-600 dark:hover:bg-ink-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-medium sm:col-span-2">
                {t("automationPage.toolPaymentCatalogLabel")}
                <input
                  value={row.label}
                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                  placeholder={t("automationPage.toolPaymentCatalogLabelPlaceholder")}
                  className={fieldCls}
                />
              </label>
              <label className="block text-[11px] font-medium">
                {t("automationPage.toolStripeCatalogProductId")}
                <input
                  value={row.productId}
                  onChange={(e) => updateRow(row.id, { productId: e.target.value })}
                  placeholder="prod_…"
                  className={clsx(fieldCls, "font-mono text-[11px]")}
                />
              </label>
              <label className="block text-[11px] font-medium">
                {t("automationPage.toolStripeCatalogPriceId")}
                <input
                  value={row.priceId}
                  onChange={(e) => updateRow(row.id, { priceId: e.target.value })}
                  placeholder="price_…"
                  className={clsx(fieldCls, "font-mono text-[11px]")}
                />
              </label>
              <label className="block text-[11px] font-medium">
                {t("automationPage.toolStripeCurrency")}
                <input
                  value={row.currency}
                  onChange={(e) => updateRow(row.id, { currency: e.target.value })}
                  placeholder="brl"
                  className={fieldCls}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, { id: `row-${Date.now()}`, label: "", productId: "", priceId: "", currency: "", isDefault: false }])}
        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-dashed border-ink-300 px-2.5 py-1.5 text-[11px] font-semibold text-ink-600 hover:border-brand-400 hover:text-brand-700 dark:border-ink-600 dark:text-ink-300"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("automationPage.toolPaymentCatalogAdd")}
      </button>
    </div>
  );
}

export function MercadoPagoCatalogEditor({
  rows,
  t,
  onChange,
}: {
  rows: MercadoPagoCatalogRow[];
  t: Translate;
  onChange: (rows: MercadoPagoCatalogRow[]) => void;
}) {
  const updateRow = (id: string, patch: Partial<MercadoPagoCatalogRow>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <div className="rounded-lg border border-ink-200 p-3 dark:border-ink-700">
      <p className="text-xs font-medium text-ink-800 dark:text-ink-100">{t("automationPage.toolPaymentCatalogTitle")}</p>
      <p className="mt-1 text-[11px] text-ink-500">{t("automationPage.toolMercadoPagoCatalogHelp")}</p>
      <div className="mt-3 space-y-3">
        {rows.map((row, index) => (
          <div key={row.id} className="rounded-lg border border-ink-100 bg-ink-50/50 p-2.5 dark:border-ink-700 dark:bg-ink-900/40">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-ink-600 dark:text-ink-300">
                {t("automationPage.toolPaymentCatalogItem")} {index + 1}
              </span>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-ink-600 dark:text-ink-400">
                  <input
                    type="radio"
                    name="mp-default-plan"
                    checked={row.isDefault}
                    onChange={() => onChange(rows.map((r) => ({ ...r, isDefault: r.id === row.id })))}
                  />
                  {t("automationPage.toolPaymentCatalogDefault")}
                </label>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t("automationPage.toolPaymentCatalogRemove")}
                    onClick={() => {
                      const next = rows.filter((r) => r.id !== row.id);
                      if (next.length > 0 && !next.some((r) => r.isDefault)) next[0]!.isDefault = true;
                      onChange(next.length > 0 ? next : rows);
                    }}
                    className="rounded p-1 text-ink-400 hover:bg-ink-200/60 hover:text-rose-600 dark:hover:bg-ink-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-medium sm:col-span-2">
                {t("automationPage.toolPaymentCatalogLabel")}
                <input
                  value={row.label}
                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                  placeholder={t("automationPage.toolPaymentCatalogLabelPlaceholder")}
                  className={fieldCls}
                />
              </label>
              <label className="block text-[11px] font-medium">
                {t("automationPage.toolMercadoPagoCatalogPlanId")}
                <input
                  value={row.planId}
                  onChange={(e) => updateRow(row.id, { planId: e.target.value })}
                  placeholder={t("automationPage.toolMercadoPagoCatalogPlanIdPlaceholder")}
                  className={clsx(fieldCls, "font-mono text-[11px]")}
                />
              </label>
              <label className="block text-[11px] font-medium">
                {t("automationPage.toolMercadoPagoDefaultAmountCents")}
                <input
                  value={row.amountCents}
                  onChange={(e) => updateRow(row.id, { amountCents: e.target.value })}
                  placeholder="9900"
                  className={fieldCls}
                />
              </label>
              <label className="block text-[11px] font-medium">
                {t("automationPage.toolMercadoPagoCurrency")}
                <input
                  value={row.currency}
                  onChange={(e) => updateRow(row.id, { currency: e.target.value })}
                  placeholder="BRL"
                  className={fieldCls}
                />
              </label>
              <label className="block text-[11px] font-medium sm:col-span-2">
                {t("automationPage.toolMercadoPagoDefaultTitle")}
                <input
                  value={row.defaultTitle}
                  onChange={(e) => updateRow(row.id, { defaultTitle: e.target.value })}
                  className={fieldCls}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            {
              id: `row-${Date.now()}`,
              label: "",
              planId: "",
              amountCents: "",
              currency: "",
              defaultTitle: "",
              isDefault: false,
            },
          ])
        }
        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-dashed border-ink-300 px-2.5 py-1.5 text-[11px] font-semibold text-ink-600 hover:border-brand-400 hover:text-brand-700 dark:border-ink-600 dark:text-ink-300"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("automationPage.toolPaymentCatalogAdd")}
      </button>
    </div>
  );
}
