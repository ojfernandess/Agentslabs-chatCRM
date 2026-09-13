import { EIL_ACTION_CATALOG, EIL_POLICY_TEMPLATES, type EilActionDef } from "./catalog.js";
import { EIL_CATEGORIES, type EilCategoryDef, type EilCategoryId } from "./eilCategories.js";
import type { AgentEilConfigDraft, EilCustomActionDef } from "./types.js";

export type { EilCategoryId } from "./eilCategories.js";
export { EIL_CATEGORIES } from "./eilCategories.js";

/** IDs das 7 ações originais de hotelaria (runtime + detectReplyActions). */
export const EIL_HOSPITALITY_ACTION_IDS = EIL_ACTION_CATALOG.map((a) => a.id);

const categoryById = new Map(EIL_CATEGORIES.map((c) => [c.id, c]));

export function getEilCategory(id: EilCategoryId | string | undefined | null): EilCategoryDef | undefined {
  if (!id) return undefined;
  return categoryById.get(id as EilCategoryId);
}

/** Categoria explícita no config; inferência de hotelaria só para exibição (não persiste sozinha). */
export function getEffectiveCategoryId(config: AgentEilConfigDraft): EilCategoryId | null {
  if (config.category) return config.category;
  const actions = (config.policies ?? []).map((p) => p.action).filter(Boolean) as string[];
  if (actions.length === 0) return null;
  const hospitalitySet = new Set(EIL_HOSPITALITY_ACTION_IDS);
  if (actions.every((a) => hospitalitySet.has(a))) return "hospitality";
  return null;
}

export function getCategoryLabel(categoryId: EilCategoryId | null | undefined, locale: "pt" | "en"): string {
  if (!categoryId) return "";
  const cat = getEilCategory(categoryId);
  if (!cat) return categoryId;
  return locale === "pt" ? cat.labelPt : cat.labelEn;
}

export function slugifyActionId(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export type ResolvedActionEntry = EilActionDef & {
  source: "builtin" | "category" | "custom" | "legacy";
  enabled: boolean;
  categoryId?: EilCategoryId;
};

function customToAction(c: EilCustomActionDef): EilActionDef {
  return {
    id: c.id,
    labelPt: c.label,
    labelEn: c.label,
    descriptionPt: c.description ?? c.label,
    descriptionEn: c.description ?? c.label,
  };
}

/** Catálogo completo: ações da categoria + custom + legado (policies fora da categoria). */
export function buildActionCatalog(params: {
  categoryId: EilCategoryId | null;
  customActions?: EilCustomActionDef[];
  locale: "pt" | "en";
  /** IDs usados em policies existentes — sempre incluídos para retrocompatibilidade. */
  legacyActionIds?: string[];
}): ResolvedActionEntry[] {
  const { categoryId, customActions = [], legacyActionIds = [] } = params;
  const seen = new Set<string>();
  const out: ResolvedActionEntry[] = [];

  const push = (action: EilActionDef, source: ResolvedActionEntry["source"], catId?: EilCategoryId, enabled = true) => {
    if (seen.has(action.id)) return;
    seen.add(action.id);
    out.push({ ...action, source, enabled, categoryId: catId });
  };

  if (categoryId === "custom") {
    for (const c of customActions) {
      if (c.enabled === false) continue;
      push(customToAction(c), "custom", "custom");
    }
  } else if (categoryId) {
    const cat = getEilCategory(categoryId);
    for (const a of cat?.actions ?? []) {
      push(a, a.id === "request_additional_party" || EIL_HOSPITALITY_ACTION_IDS.includes(a.id) ? "builtin" : "category", categoryId);
    }
    const customs = customActions.filter((c) => c.enabled !== false);
    for (const c of customs) push(customToAction(c), "custom", categoryId);
  }

  for (const legacyId of legacyActionIds) {
    if (seen.has(legacyId)) continue;
    const fromBuiltin = EIL_ACTION_CATALOG.find((a) => a.id === legacyId);
    if (fromBuiltin) {
      push(fromBuiltin, "legacy", "hospitality");
      continue;
    }
    for (const cat of EIL_CATEGORIES) {
      const found = cat.actions.find((a) => a.id === legacyId);
      if (found) {
        push(found, "legacy", cat.id);
        break;
      }
    }
    if (!seen.has(legacyId)) {
      const custom = customActions.find((c) => c.id === legacyId);
      if (custom) push(customToAction(custom), "legacy", categoryId ?? undefined);
      else {
        push(
          { id: legacyId, labelPt: legacyId, labelEn: legacyId, descriptionPt: legacyId, descriptionEn: legacyId },
          "legacy",
        );
      }
    }
  }

  return out;
}

export function isActionInCategory(actionId: string, categoryId: EilCategoryId | null, customActions: EilCustomActionDef[] = []): boolean {
  if (!categoryId) return true;
  if (categoryId === "custom") return customActions.some((c) => c.id === actionId && c.enabled !== false);
  const cat = getEilCategory(categoryId);
  if (cat?.actions.some((a) => a.id === actionId)) return true;
  return customActions.some((c) => c.id === actionId && c.enabled !== false);
}

export function resolveActionLabel(
  actionId: string,
  locale: "pt" | "en",
  config?: AgentEilConfigDraft,
): string {
  const catalog = buildActionCatalog({
    categoryId: config?.category ?? getEffectiveCategoryId(config ?? {}),
    customActions: config?.customActions,
    legacyActionIds: [actionId],
    locale,
  });
  const found = catalog.find((a) => a.id === actionId);
  if (!found) return actionId;
  return locale === "pt" ? found.labelPt : found.labelEn;
}

export function getTemplatesForCategory(categoryId: EilCategoryId | null) {
  if (!categoryId || categoryId === "custom") return [];
  return EIL_POLICY_TEMPLATES.filter((t) => t.eilCategory === categoryId);
}

export function getSuggestedFactsForCategory(categoryId: EilCategoryId | null): string[] {
  if (!categoryId) return [];
  return getEilCategory(categoryId)?.suggestedFacts ?? [];
}

export function allKnownActionIds(): Set<string> {
  const ids = new Set<string>();
  for (const a of EIL_ACTION_CATALOG) ids.add(a.id);
  for (const cat of EIL_CATEGORIES) for (const a of cat.actions) ids.add(a.id);
  return ids;
}

export function validateCustomActionId(id: string, existingIds: Set<string>): string | null {
  const trimmed = id.trim();
  if (!trimmed) return "required";
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) return "format";
  if (existingIds.has(trimmed)) return "duplicate";
  return null;
}
