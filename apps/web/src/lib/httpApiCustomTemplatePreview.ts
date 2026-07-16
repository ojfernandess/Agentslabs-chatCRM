import { substituteBodyPlaceholders } from "@/lib/templatePreview";

export type MappedSampleRow = {
  phone: string;
  name: string;
  variables: Record<string, string>;
};

export type TemplateVarSlot = { slot: number; variableKey: string };

function substituteContactVars(text: string, contact: { name: string }): string {
  return text
    .replace(/\{\{nome\}\}/gi, contact.name)
    .replace(/\{\{name\}\}/gi, contact.name);
}

export function expandTemplateString(template: string, flat: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    return flat[key] ?? "";
  });
}

export function resolveHttpCustomSample(
  mappedPreview: MappedSampleRow[] | undefined,
): { variables: Record<string, string>; contactName: string; phone: string; isSample: boolean } {
  const first = mappedPreview?.[0];
  if (first) {
    return {
      variables: {
        ...first.variables,
        nome: first.variables.nome ?? first.name,
        telefone: first.variables.telefone ?? first.phone,
      },
      contactName: first.name,
      phone: first.phone,
      isSample: false,
    };
  }
  return {
    variables: {
      nome: "Maria Silva",
      telefone: "+5511999999999",
      valor: "R$ 150,00",
      vencimento: "15/07/2026",
    },
    contactName: "Maria Silva",
    phone: "+5511999999999",
    isSample: true,
  };
}

export function renderHttpCustomTextPreview(
  template: string,
  variables: Record<string, string>,
  contactName: string,
): string {
  const flat: Record<string, string> = {
    ...variables,
    nome: variables.nome ?? contactName,
    name: variables.nome ?? contactName,
    telefone: variables.telefone ?? "",
  };
  const withContact = substituteContactVars(template, { name: contactName });
  return expandTemplateString(withContact, flat);
}

export function buildTemplateParameterValues(
  mapping: TemplateVarSlot[] | undefined,
  variables: Record<string, string>,
  contactName: string,
  variableCount: number,
): string[] {
  const firstName = contactName.trim().split(/\s+/)[0] || contactName.trim() || "";
  const params = Array.from({ length: variableCount }, (_, i) => (i === 0 ? firstName : ""));
  for (const slot of mapping ?? []) {
    const idx = slot.slot - 1;
    if (idx < 0 || idx >= variableCount) continue;
    const val = variables[slot.variableKey] ?? "";
    params[idx] = val;
  }
  return params;
}

export function previewWhatsappTemplateBody(body: string, params: string[]): string {
  const valuesByIndex: Record<number, string> = {};
  params.forEach((value, i) => {
    valuesByIndex[i + 1] = value;
  });
  return substituteBodyPlaceholders(body, valuesByIndex);
}

function getByPath(obj: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
      continue;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringifyFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function extractJsonArrayFromResponse(data: unknown, arrayPath?: string): unknown[] {
  if (arrayPath?.trim()) {
    const found = getByPath(data, arrayPath.trim());
    return Array.isArray(found) ? found : [];
  }
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
        return value;
      }
    }
  }
  return [];
}

export function remapFirstMappedRow(
  sampleJson: unknown,
  arrayPath: string,
  phoneField: string,
  nameField: string,
  variableMappings: { key: string; jsonPath: string }[],
): MappedSampleRow | null {
  const rows = extractJsonArrayFromResponse(sampleJson, arrayPath);
  const item = rows[0];
  if (!item || typeof item !== "object") return null;
  const phoneRaw = phoneField ? stringifyFieldValue(getByPath(item, phoneField)) : "";
  const phone = phoneRaw.trim();
  if (!phone) return null;
  const nameRaw = nameField ? stringifyFieldValue(getByPath(item, nameField)) : "";
  const name = nameRaw.trim() || phone;
  const variables: Record<string, string> = {};
  if (nameRaw.trim()) variables.nome = nameRaw.trim();
  variables.telefone = phone;
  for (const v of variableMappings) {
    if (!v.key.trim() || !v.jsonPath.trim()) continue;
    variables[v.key.trim()] = stringifyFieldValue(getByPath(item, v.jsonPath.trim()));
  }
  return { phone, name, variables };
}

