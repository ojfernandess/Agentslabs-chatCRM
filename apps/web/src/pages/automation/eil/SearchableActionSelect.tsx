import { useMemo, useState } from "react";
import clsx from "clsx";
import type { ResolvedActionEntry } from "@/lib/eil/categoryCatalog.js";
import { isActionInCategory } from "@/lib/eil/categoryCatalog.js";
import type { AgentEilConfigDraft } from "@/lib/eil/types.js";

type Translate = (key: string) => string;

type Props = {
  value: string;
  onChange: (actionId: string) => void;
  catalog: ResolvedActionEntry[];
  eilConfig: AgentEilConfigDraft;
  locale: "pt" | "en";
  t: Translate;
  className?: string;
};

export function SearchableActionSelect({ value, onChange, catalog, eilConfig, locale, t, className }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((a) => {
      const label = locale === "pt" ? a.labelPt : a.labelEn;
      return label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
    });
  }, [catalog, query, locale]);

  const standard = filtered.filter((a) => a.source !== "custom" && a.source !== "legacy");
  const custom = filtered.filter((a) => a.source === "custom");
  const legacy = filtered.filter((a) => a.source === "legacy");

  const renderOption = (action: ResolvedActionEntry) => {
    const label = locale === "pt" ? action.labelPt : action.labelEn;
    const disabled = action.enabled === false;
    return (
      <option key={action.id} value={action.id} disabled={disabled}>
        {label}
        {action.source === "legacy" ? ` (${t("automationPage.agentEilOutOfCategoryBadge")})` : ""}
        {disabled ? ` (${t("automationPage.agentEilActionDisabled")})` : ""}
      </option>
    );
  };

  return (
    <div className={clsx("space-y-2", className)}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("automationPage.agentEilSearchAction")}
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
      >
        <option value="">{t("automationPage.agentEilSelectAction")}</option>
        {standard.map(renderOption)}
        {custom.length > 0 ? (
          <optgroup label={t("automationPage.agentEilCustomActionsGroup")}>{custom.map(renderOption)}</optgroup>
        ) : null}
        {legacy.length > 0 ? (
          <optgroup label={t("automationPage.agentEilLegacyActionsGroup")}>{legacy.map(renderOption)}</optgroup>
        ) : null}
      </select>
      {value &&
      eilConfig.category &&
      !isActionInCategory(value, eilConfig.category, eilConfig.customActions ?? []) ? (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">
          {t("automationPage.agentEilOutOfCategoryHint")}
        </p>
      ) : null}
    </div>
  );
}
