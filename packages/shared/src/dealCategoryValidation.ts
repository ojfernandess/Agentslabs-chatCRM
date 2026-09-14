import { getDealCategoryById, type DealFieldDef, type DealFieldType } from "./dealCategoryCatalog.js";

export type DealFieldOverride = {
  fieldKey: string;
  enabled: boolean;
  required: boolean;
  sortOrder: number;
};

export type ResolvedDealField = DealFieldDef & {
  enabled: boolean;
  required: boolean;
  sortOrder: number;
};

export function resolveCategoryFields(
  categoryId: string,
  overrides: DealFieldOverride[] = [],
  customFields: DealFieldDef[] = [],
): ResolvedDealField[] {
  const cat = getDealCategoryById(categoryId);
  const overrideMap = new Map(overrides.map((o) => [o.fieldKey, o]));

  const builtIn: ResolvedDealField[] = cat.fields.map((f) => {
    const o = overrideMap.get(f.key);
    return {
      ...f,
      enabled: o?.enabled ?? f.enabled !== false,
      required: o?.required ?? f.required === true,
      sortOrder: o?.sortOrder ?? f.sortOrder,
    };
  });

  const custom: ResolvedDealField[] = customFields.map((f, i) => {
    const o = overrideMap.get(f.key);
    return {
      ...f,
      enabled: o?.enabled ?? f.enabled !== false,
      required: o?.required ?? f.required === true,
      sortOrder: o?.sortOrder ?? f.sortOrder ?? 1000 + i,
    };
  });

  return [...builtIn, ...custom]
    .filter((f) => f.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function isEmptyValue(type: DealFieldType, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (type === "boolean") return false;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function validateCategoryData(
  categoryId: string,
  data: Record<string, unknown> | null | undefined,
  fields: ResolvedDealField[],
): { ok: true; data: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const out: Record<string, unknown> = { ...(data ?? {}) };
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const raw = out[field.key];
    if (field.required && isEmptyValue(field.type, raw)) {
      errors[field.key] = "required";
      continue;
    }
    if (isEmptyValue(field.type, raw)) {
      delete out[field.key];
      continue;
    }
    switch (field.type) {
      case "number":
      case "percentage": {
        const n = Number(raw);
        if (!Number.isFinite(n)) errors[field.key] = "invalid_number";
        else out[field.key] = n;
        break;
      }
      case "money": {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) errors[field.key] = "invalid_money";
        else out[field.key] = Math.round(n);
        break;
      }
      case "boolean":
        out[field.key] = Boolean(raw);
        break;
      case "multiselect":
        out[field.key] = Array.isArray(raw) ? raw : [raw];
        break;
      default:
        out[field.key] = typeof raw === "string" ? raw.trim() : raw;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: out };
}
