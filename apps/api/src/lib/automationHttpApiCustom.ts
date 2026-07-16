import { Prisma } from "@prisma/client";
import { normalizePhoneE164 } from "@openconduit/shared";
import { prisma } from "../db.js";
import { assertHttpUrlAllowed, truncateBody } from "./httpToolTest.js";
import { secureHttpFetch } from "./secureHttpFetch.js";
import {
  buildHttpToolFlatContext,
  expandTemplateString,
  expandTemplateValue,
  flattenTemplateContext,
} from "./automationHttpToolExecute.js";
import {
  parseSegmentRules,
  substituteContactVars,
  type BroadcastSegmentRules,
  type FollowUpAfterSendMode,
} from "./broadcastTypes.js";
import { materializeAndStartCampaign } from "./broadcastCampaignStart.js";
import type { FastifyInstance } from "fastify";

export type HttpApiCustomFieldRole = "phone" | "name" | "variable";

export type HttpApiCustomVariableMapping = {
  key: string;
  jsonPath: string;
  label?: string;
};

export type HttpApiCustomFieldMapping = {
  phone?: string;
  name?: string;
  variables?: HttpApiCustomVariableMapping[];
};

export type HttpApiCustomTemplateVarSlot = {
  slot: number;
  variableKey: string;
};

export type HttpApiCustomDispatchConfig = {
  inboxId?: string;
  messageType?: "TEXT" | "TEMPLATE";
  templateId?: string;
  body?: string;
  templateVariableMapping?: HttpApiCustomTemplateVarSlot[];
  executionMode?: "manual" | "scheduled";
  scheduledAt?: string;
  cronExpression?: string;
  autoCreateCampaign?: boolean;
  campaignName?: string;
  campaignKind?: "broadcast" | "followup";
  followUpAfterSend?: FollowUpAfterSendMode;
  followUpTagIds?: string[];
  followUpTagLogic?: "ANY" | "ALL";
  avoidDuplicates?: boolean;
  autoStart?: boolean;
};

export type HttpApiCustomToolConfig = {
  presetKey?: string;
  executor?: string;
  baseUrl?: string;
  httpMethod?: string;
  httpPath?: string;
  authType?: string;
  bearerToken?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
  basicUser?: string;
  basicPassword?: string;
  customAuthHeader?: string;
  customAuthValue?: string;
  defaultHeaders?: Record<string, unknown>;
  defaultQuery?: Record<string, unknown>;
  responseArrayPath?: string;
  fieldMapping?: HttpApiCustomFieldMapping;
  dispatch?: HttpApiCustomDispatchConfig;
};

export type MappedHttpApiContactRow = {
  phone: string;
  name: string;
  variables: Record<string, string>;
  sourceIndex: number;
};

function asJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export function parseHttpApiCustomConfig(raw: unknown): HttpApiCustomToolConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as HttpApiCustomToolConfig;
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

export function extractJsonArrayFromResponse(data: unknown, arrayPath?: string): unknown[] {
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

export function suggestJsonFieldPaths(sample: unknown, max = 24): string[] {
  if (!sample || typeof sample !== "object") return [];
  const flat = flattenTemplateContext(sample);
  return Object.keys(flat)
    .filter((k) => !k.includes("."))
    .slice(0, max)
    .sort();
}

function stringifyFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function mapRowFromJsonItem(
  item: unknown,
  mapping: HttpApiCustomFieldMapping,
): MappedHttpApiContactRow | null {
  if (!item || typeof item !== "object") return null;
  const phoneRaw = mapping.phone ? stringifyFieldValue(getByPath(item, mapping.phone)) : "";
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) return null;
  const nameRaw = mapping.name ? stringifyFieldValue(getByPath(item, mapping.name)) : "";
  const name = nameRaw.trim() || phone;
  const variables: Record<string, string> = {};
  if (nameRaw.trim()) variables.nome = nameRaw.trim();
  variables.telefone = phone;
  for (const v of mapping.variables ?? []) {
    if (!v.key?.trim() || !v.jsonPath?.trim()) continue;
    variables[v.key.trim()] = stringifyFieldValue(getByPath(item, v.jsonPath.trim()));
  }
  return { phone, name, variables, sourceIndex: 0 };
}

export function mapRowsFromResponse(
  rows: unknown[],
  mapping: HttpApiCustomFieldMapping,
): MappedHttpApiContactRow[] {
  const out: MappedHttpApiContactRow[] = [];
  rows.forEach((item, index) => {
    const mapped = mapRowFromJsonItem(item, mapping);
    if (mapped) out.push({ ...mapped, sourceIndex: index });
  });
  return out;
}

export function deduplicateMappedRows(
  rows: MappedHttpApiContactRow[],
  avoidDuplicates: boolean,
): MappedHttpApiContactRow[] {
  if (!avoidDuplicates) return rows;
  const seen = new Set<string>();
  const out: MappedHttpApiContactRow[] = [];
  for (const row of rows) {
    if (seen.has(row.phone)) continue;
    seen.add(row.phone);
    out.push(row);
  }
  return out;
}

export async function fetchHttpApiCustomJson(tool: {
  config: unknown;
}): Promise<{ ok: boolean; statusCode: number | null; data: unknown; error: string | null; durationMs: number }> {
  const cfg = parseHttpApiCustomConfig(tool.config);
  const flat = buildHttpToolFlatContext({});
  const base = String(cfg.baseUrl ?? "").replace(/\/$/, "");
  if (!base) {
    return { ok: false, statusCode: null, data: null, error: "baseUrl_missing", durationMs: 0 };
  }
  let pathPart = expandTemplateString(String(cfg.httpPath ?? "/"), flat);
  pathPart = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const url = assertHttpUrlAllowed(`${base}${pathPart}`);
  const method = String(cfg.httpMethod ?? "GET").toUpperCase();
  const defaultQuery =
    cfg.defaultQuery && typeof cfg.defaultQuery === "object" ? (cfg.defaultQuery as Record<string, unknown>) : {};
  for (const [qk, qv] of Object.entries(defaultQuery)) {
    if (typeof qv === "string") url.searchParams.set(qk, expandTemplateString(qv, flat));
    else if (typeof qv === "number" || typeof qv === "boolean") url.searchParams.set(qk, String(qv));
  }
  const headers = new Headers();
  const defaultHeaders =
    cfg.defaultHeaders && typeof cfg.defaultHeaders === "object" ? (cfg.defaultHeaders as Record<string, unknown>) : {};
  for (const [hk, hv] of Object.entries(defaultHeaders)) {
    if (typeof hv === "string") headers.set(hk, expandTemplateString(hv, flat));
  }
  const authType = String(cfg.authType ?? "none");
  if (authType === "bearer" && cfg.bearerToken) {
    headers.set("Authorization", `Bearer ${String(cfg.bearerToken)}`);
  } else if (authType === "api_key" && cfg.apiKeyHeader && cfg.apiKeyValue) {
    headers.set(String(cfg.apiKeyHeader), String(cfg.apiKeyValue));
  } else if (authType === "basic" && cfg.basicUser) {
    const token = Buffer.from(`${cfg.basicUser}:${cfg.basicPassword ?? ""}`).toString("base64");
    headers.set("Authorization", `Basic ${token}`);
  } else if (authType === "custom_header" && cfg.customAuthHeader && cfg.customAuthValue) {
    headers.set(String(cfg.customAuthHeader), String(cfg.customAuthValue));
  }
  const started = Date.now();
  try {
    const res = await secureHttpFetch(url.toString(), { method, headers, signal: AbortSignal.timeout(25_000) });
    const text = await res.text();
    const durationMs = Date.now() - started;
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        statusCode: res.status,
        data: truncateBody(text, 8000),
        error: "invalid_json_response",
        durationMs,
      };
    }
    return { ok: res.ok, statusCode: res.status, data, error: res.ok ? null : `http_${res.status}`, durationMs };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      data: null,
      error: err instanceof Error ? err.message : "fetch_failed",
      durationMs: Date.now() - started,
    };
  }
}

export function renderHttpApiCustomText(
  template: string,
  contact: { name: string; email?: string | null },
  variables: Record<string, string>,
): string {
  const flat: Record<string, string> = {
    ...variables,
    nome: variables.nome ?? contact.name,
    name: variables.nome ?? contact.name,
    telefone: variables.telefone ?? "",
    email: contact.email ?? variables.email ?? "",
  };
  const withContact = substituteContactVars(template, contact);
  return expandTemplateString(withContact, flat);
}

export function buildTemplateBodyParameters(
  mapping: HttpApiCustomTemplateVarSlot[] | undefined,
  variables: Record<string, string>,
  contact: { name: string },
  variableCount: number,
): string[] {
  const firstName = contact.name.trim().split(/\s+/)[0] || contact.name.trim() || "";
  const params = Array.from({ length: variableCount }, (_, i) => (i === 0 ? firstName : ""));
  for (const slot of mapping ?? []) {
    const idx = slot.slot - 1;
    if (idx < 0 || idx >= variableCount) continue;
    const val = variables[slot.variableKey] ?? "";
    params[idx] = val;
  }
  return params;
}

export async function resolveMappedRowsToContacts(
  organizationId: string,
  userId: string,
  rows: MappedHttpApiContactRow[],
): Promise<{ contactId: string; variables: Record<string, string> }[]> {
  const out: { contactId: string; variables: Record<string, string> }[] = [];
  for (const row of rows) {
    let contact = await prisma.contact.findFirst({
      where: { organizationId, phone: row.phone, isGroupChat: false },
      select: { id: true },
    });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          organizationId,
          phone: row.phone,
          name: row.name,
          createdById: userId,
        },
        select: { id: true },
      });
    }
    out.push({ contactId: contact.id, variables: row.variables });
  }
  return out;
}

export async function filterContactsAlreadyDispatched(
  organizationId: string,
  toolId: string,
  contactIds: string[],
): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const campaigns = await prisma.broadcastCampaign.findMany({
    where: {
      organizationId,
      status: { in: ["DRAFT", "RUNNING", "PAUSED", "COMPLETED"] },
    },
    select: { id: true, segmentRules: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });
  const relatedCampaignIds = campaigns
    .filter((c) => {
      const rules = parseSegmentRules(c.segmentRules);
      return rules?.httpApiCustomToolId === toolId;
    })
    .map((c) => c.id);
  if (relatedCampaignIds.length === 0) return contactIds;
  const existing = await prisma.broadcastCampaignRecipient.findMany({
    where: { campaignId: { in: relatedCampaignIds }, contactId: { in: contactIds } },
    select: { contactId: true },
  });
  const skip = new Set(existing.map((r) => r.contactId));
  return contactIds.filter((id) => !skip.has(id));
}

export async function previewHttpApiCustomTool(tool: {
  id: string;
  config: unknown;
}): Promise<{
  ok: boolean;
  statusCode: number | null;
  sampleJson: unknown;
  suggestedFields: string[];
  mappedPreview: MappedHttpApiContactRow[];
  arrayPath: string;
  totalRows: number;
  error: string | null;
}> {
  const cfg = parseHttpApiCustomConfig(tool.config);
  const fetchRes = await fetchHttpApiCustomJson(tool);
  if (!fetchRes.ok || fetchRes.data == null) {
    return {
      ok: false,
      statusCode: fetchRes.statusCode,
      sampleJson: fetchRes.data,
      suggestedFields: [],
      mappedPreview: [],
      arrayPath: cfg.responseArrayPath ?? "",
      totalRows: 0,
      error: fetchRes.error,
    };
  }
  const arrayPath = cfg.responseArrayPath ?? "";
  const rows = extractJsonArrayFromResponse(fetchRes.data, arrayPath);
  const first = rows[0];
  const suggestedFields = suggestJsonFieldPaths(first);
  const mapping = cfg.fieldMapping ?? {};
  const mappedPreview = mapRowsFromResponse(rows.slice(0, 5), mapping);
  return {
    ok: true,
    statusCode: fetchRes.statusCode,
    sampleJson: fetchRes.data,
    suggestedFields,
    mappedPreview,
    arrayPath,
    totalRows: rows.length,
    error: null,
  };
}

export async function dispatchHttpApiCustomTool(input: {
  app: FastifyInstance;
  organizationId: string;
  userId: string;
  tool: { id: string; name: string; config: unknown };
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  fetched: number;
  mapped: number;
  contacts: number;
  skippedDuplicates: number;
  campaignId: string | null;
  previewBody?: string;
  error: string | null;
}> {
  const { app, organizationId, userId, tool, dryRun } = input;
  const cfg = parseHttpApiCustomConfig(tool.config);
  const dispatch = cfg.dispatch ?? {};
  if (!dispatch.inboxId) {
    return { ok: false, fetched: 0, mapped: 0, contacts: 0, skippedDuplicates: 0, campaignId: null, error: "inbox_required" };
  }
  if (dispatch.messageType === "TEMPLATE" && !dispatch.templateId) {
    return { ok: false, fetched: 0, mapped: 0, contacts: 0, skippedDuplicates: 0, campaignId: null, error: "template_required" };
  }
  if (dispatch.messageType !== "TEMPLATE" && !dispatch.body?.trim()) {
    return { ok: false, fetched: 0, mapped: 0, contacts: 0, skippedDuplicates: 0, campaignId: null, error: "body_required" };
  }

  const fetchRes = await fetchHttpApiCustomJson(tool);
  if (!fetchRes.ok || fetchRes.data == null) {
    return {
      ok: false,
      fetched: 0,
      mapped: 0,
      contacts: 0,
      skippedDuplicates: 0,
      campaignId: null,
      error: fetchRes.error ?? "fetch_failed",
    };
  }
  const rows = extractJsonArrayFromResponse(fetchRes.data, cfg.responseArrayPath);
  const mappedRows = deduplicateMappedRows(
    mapRowsFromResponse(rows, cfg.fieldMapping ?? {}),
    dispatch.avoidDuplicates !== false,
  );
  if (mappedRows.length === 0) {
    return {
      ok: false,
      fetched: rows.length,
      mapped: 0,
      contacts: 0,
      skippedDuplicates: rows.length,
      campaignId: null,
      error: "no_valid_contacts",
    };
  }

  if (dryRun) {
    const sample = mappedRows[0];
    const previewBody = renderHttpApiCustomText(
      dispatch.body ?? "",
      { name: sample.name, email: null },
      sample.variables,
    );
    return {
      ok: true,
      fetched: rows.length,
      mapped: mappedRows.length,
      contacts: mappedRows.length,
      skippedDuplicates: rows.length - mappedRows.length,
      campaignId: null,
      previewBody,
      error: null,
    };
  }

  const resolved = await resolveMappedRowsToContacts(organizationId, userId, mappedRows);
  let contactIds = resolved.map((r) => r.contactId);
  const skippedBefore = contactIds.length;
  if (dispatch.avoidDuplicates !== false) {
    contactIds = await filterContactsAlreadyDispatched(organizationId, tool.id, contactIds);
  }
  const skippedDuplicates = skippedBefore - contactIds.length + (rows.length - mappedRows.length);
  if (contactIds.length === 0) {
    return {
      ok: false,
      fetched: rows.length,
      mapped: mappedRows.length,
      contacts: 0,
      skippedDuplicates,
      campaignId: null,
      error: "all_duplicates",
    };
  }

  const recipientVariables: Record<string, Record<string, string>> = {};
  for (const row of resolved) {
    if (contactIds.includes(row.contactId)) recipientVariables[row.contactId] = row.variables;
  }

  const segmentRules: BroadcastSegmentRules = {
    contactIds,
    recipientVariables,
    httpApiCustomToolId: tool.id,
    campaignKind: dispatch.campaignKind === "followup" ? "followup" : "broadcast",
    tagIds: dispatch.followUpTagIds,
    tagLogic: dispatch.followUpTagLogic ?? "ANY",
    followUpAfterSend: dispatch.followUpAfterSend,
    templateVariableMapping: dispatch.templateVariableMapping,
  };

  const campaignName =
    dispatch.campaignName?.trim() ||
    `${tool.name} · ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;

  const scheduleType =
    dispatch.executionMode === "scheduled"
      ? dispatch.cronExpression
        ? ("RECURRING" as const)
        : ("SCHEDULED" as const)
      : ("IMMEDIATE" as const);

  const scheduledDate = dispatch.scheduledAt ? new Date(dispatch.scheduledAt) : null;
  const nextRunAt =
    scheduleType === "SCHEDULED" && scheduledDate && !Number.isNaN(scheduledDate.getTime())
      ? scheduledDate
      : scheduleType === "IMMEDIATE"
        ? null
        : scheduledDate;

  const campaign = await prisma.broadcastCampaign.create({
    data: {
      organizationId,
      name: campaignName,
      channel: "WHATSAPP",
      inboxId: dispatch.inboxId,
      messageType: dispatch.messageType ?? "TEXT",
      body: dispatch.body ?? null,
      templateId: dispatch.templateId ?? null,
      scheduleType,
      scheduledAt: scheduledDate,
      cronExpression: dispatch.cronExpression ?? null,
      nextRunAt,
      segmentRules: asJson(segmentRules),
      createdById: userId,
      status: "DRAFT",
      approvalStatus: "NONE",
    },
  });

  if (
    dispatch.autoCreateCampaign !== false &&
    scheduleType === "IMMEDIATE" &&
    dispatch.autoStart !== false
  ) {
    try {
      await materializeAndStartCampaign(app, organizationId, campaign.id);
    } catch (err) {
      return {
        ok: false,
        fetched: rows.length,
        mapped: mappedRows.length,
        contacts: contactIds.length,
        skippedDuplicates,
        campaignId: campaign.id,
        error: err instanceof Error ? err.message : "campaign_start_failed",
      };
    }
  }

  await prisma.automationCustomTool.update({
    where: { id: tool.id },
    data: {
      executionCount: { increment: 1 },
      lastExecutedAt: new Date(),
    },
  });

  return {
    ok: true,
    fetched: rows.length,
    mapped: mappedRows.length,
    contacts: contactIds.length,
    skippedDuplicates,
    campaignId: campaign.id,
    error: null,
  };
}

export function mergeHttpApiCustomDispatchConfig(
  current: HttpApiCustomToolConfig,
  patch: Partial<HttpApiCustomDispatchConfig> & Partial<HttpApiCustomToolConfig>,
): HttpApiCustomToolConfig {
  const next: HttpApiCustomToolConfig = { ...current, ...patch };
  if (patch.dispatch || current.dispatch) {
    next.dispatch = { ...(current.dispatch ?? {}), ...(patch.dispatch ?? {}) };
  }
  if (patch.fieldMapping || current.fieldMapping) {
    next.fieldMapping = { ...(current.fieldMapping ?? {}), ...(patch.fieldMapping ?? {}) };
  }
  return next;
}
