import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { assertHttpUrlAllowed, truncateBody } from "./httpToolTest.js";

function asJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export const HTTP_TOOL_RESERVED_ARG_KEYS = new Set([
  "pathParams",
  "query",
  "headers",
  "body",
  "sampleContext",
]);

export function flattenTemplateContext(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj == null || typeof obj !== "object") return out;

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const p = prefix ? `${prefix}.${index}` : String(index);
      if (item !== null && typeof item === "object") {
        Object.assign(out, flattenTemplateContext(item, p));
      } else if (item !== undefined && item !== null) {
        out[p] =
          typeof item === "string" || typeof item === "number" || typeof item === "boolean"
            ? String(item)
            : JSON.stringify(item);
      }
    });
    return out;
  }

  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      Object.assign(out, flattenTemplateContext(v, p));
    } else if (v !== undefined && v !== null) {
      out[p] =
        typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    }
  }
  return out;
}

export function expandTemplateString(template: string, flat: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    return flat[key] ?? "";
  });
}

export function expandTemplateValue(value: unknown, flat: Record<string, string>): unknown {
  if (typeof value === "string") return expandTemplateString(value, flat);
  if (Array.isArray(value)) return value.map((item) => expandTemplateValue(item, flat));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandTemplateValue(v, flat);
    }
    return out;
  }
  return value;
}

export function isNonEmptyBodyTemplate(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function extractInlineBodyFromArgs(args: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (HTTP_TOOL_RESERVED_ARG_KEYS.has(k)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function buildHttpToolFlatContext(
  args: Record<string, unknown>,
  extras?: Record<string, string>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  Object.assign(flat, flattenTemplateContext(args.sampleContext));
  const inline = extractInlineBodyFromArgs(args);
  if (inline) Object.assign(flat, flattenTemplateContext(inline));
  if (args.body !== undefined && args.body !== null && typeof args.body === "object") {
    Object.assign(flat, flattenTemplateContext(args.body));
  } else if (typeof args.body === "string") {
    flat.body = args.body;
  }

  for (const [k, v] of Object.entries(args)) {
    if (HTTP_TOOL_RESERVED_ARG_KEYS.has(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      flat[k] = String(v);
    }
  }

  const pathParams = args.pathParams;
  if (pathParams && typeof pathParams === "object" && !Array.isArray(pathParams)) {
    for (const [k, v] of Object.entries(pathParams as Record<string, unknown>)) {
      if (v !== undefined && v !== null) flat[k] = String(v);
    }
  }

  const query = args.query;
  if (query && typeof query === "object" && !Array.isArray(query)) {
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
      if (v !== undefined && v !== null) flat[k] = String(v);
    }
  }

  if (extras) Object.assign(flat, extras);
  return flat;
}

export function resolveHttpRequestBody(options: {
  cfg: Record<string, unknown>;
  args: Record<string, unknown>;
  flat: Record<string, string>;
}): { bodyStr?: string; contentType?: string; source?: "explicit" | "template" | "inline" | "none" } {
  const { cfg, args, flat } = options;
  const bodyType = String(cfg.bodyType ?? "json").trim().toLowerCase();
  const configuredTemplate = cfg.bodyTemplate ?? cfg.body;

  let bodyPayload: unknown;
  let source: "explicit" | "template" | "inline" | "none" = "none";

  if (args.body !== undefined) {
    bodyPayload = args.body;
    source = "explicit";
  } else if (isNonEmptyBodyTemplate(configuredTemplate)) {
    bodyPayload = configuredTemplate;
    source = "template";
  } else {
    bodyPayload = extractInlineBodyFromArgs(args);
    if (bodyPayload) source = "inline";
  }

  if (bodyPayload === undefined || bodyPayload === null) {
    return { bodyStr: undefined, source: "none" };
  }

  const expanded = expandTemplateValue(bodyPayload, flat);

  if (bodyType === "text" || bodyType === "plain" || bodyType === "text/plain") {
    const text = typeof expanded === "string" ? expanded : JSON.stringify(expanded);
    return text.trim() ? { bodyStr: text, contentType: "text/plain", source } : { source: "none" };
  }

  if (
    bodyType === "form" ||
    bodyType === "form-urlencoded" ||
    bodyType === "application/x-www-form-urlencoded"
  ) {
    const entries =
      expanded && typeof expanded === "object" && !Array.isArray(expanded)
        ? Object.entries(expanded as Record<string, unknown>)
        : [];
    const params = new URLSearchParams();
    for (const [k, v] of entries) {
      if (v === undefined || v === null) continue;
      params.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    const bodyStr = params.toString();
    return bodyStr
      ? { bodyStr, contentType: "application/x-www-form-urlencoded", source }
      : { source: "none" };
  }

  if (typeof expanded === "string") {
    const trimmed = expanded.trim();
    if (!trimmed) return { source: "none" };
    try {
      return { bodyStr: JSON.stringify(JSON.parse(trimmed)), contentType: "application/json", source };
    } catch {
      return { bodyStr: expanded, contentType: "application/json", source };
    }
  }

  return { bodyStr: JSON.stringify(expanded), contentType: "application/json", source };
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Nome estável para OpenAI function calling (a-z, 0-9, _). Manter alinhado com `nativeOpenAiToolFunctionName` no web (`agentPromptBuilder.ts`). */
export function openAiFunctionNameForAutomationTool(toolId: string): string {
  return `oc_tool_${toolId.replace(/-/g, "")}`;
}

export function parseAutomationToolIdFromOpenAiName(name: string): string | null {
  if (!name.startsWith("oc_tool_")) return null;
  const hex = name.slice("oc_tool_".length);
  if (!/^[a-f0-9]{32}$/i.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function safeOpenAiParametersSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const o = schema as Record<string, unknown>;
    if (o.type === "object") return o;
  }
  return { type: "object", properties: {} };
}

/** Verifica campos `required` do JSON Schema (níveis aninhados) antes de chamar a API externa. */
export function collectMissingRequiredSchemaFields(schema: unknown, data: unknown, pathPrefix = ""): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const s = schema as Record<string, unknown>;
  const missing: string[] = [];

  const isObjectSchema =
    s.type === "object" || (s.properties != null && typeof s.properties === "object");
  if (!isObjectSchema) return missing;

  const obj =
    data !== null && data !== undefined && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  const props =
    s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)
      ? (s.properties as Record<string, unknown>)
      : null;

  const required = Array.isArray(s.required)
    ? s.required.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  for (const key of required) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    const val = obj?.[key];
    if (val === undefined || val === null) {
      missing.push(path);
      continue;
    }
    const childSchema = props?.[key];
    if (childSchema) {
      missing.push(...collectMissingRequiredSchemaFields(childSchema, val, path));
    }
  }

  // Objetos com chaves dinâmicas (ex.: room_units[room_type_id])
  const additional = s.additionalProperties;
  if (
    additional &&
    typeof additional === "object" &&
    !Array.isArray(additional) &&
    obj &&
    typeof obj === "object"
  ) {
    for (const [dynKey, dynVal] of Object.entries(obj)) {
      if (props && dynKey in props) continue;
      const dynPath = pathPrefix ? `${pathPrefix}.${dynKey}` : dynKey;
      missing.push(...collectMissingRequiredSchemaFields(additional, dynVal, dynPath));
    }
  }

  return missing;
}

function buildValidationErrorPayload(missing: string[]): string {
  return JSON.stringify({
    ok: false,
    validationError: true,
    missingFields: missing,
    message:
      "Argumentos incompletos para a ferramenta HTTP. O modelo deve incluir todos os campos obrigatórios do schema antes de repetir a chamada. " +
      (missing.includes("body.room_units") || missing.some((m) => m.endsWith(".room_units"))
        ? "Para reservas: body.room_units é obrigatório — use um objeto cuja chave é o room_type_id devolvido pela consulta de disponibilidade, com adults, kids e guests em cada unidade."
        : `Campos em falta: ${missing.join(", ")}.`),
  });
}

export type AutomationHttpToolRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  toolType: string;
  config: unknown;
  parametersSchema: unknown;
};

/**
 * Executa ferramenta HTTP_API / WEBHOOK (mesma lógica do teste no painel), usando argumentos JSON do modelo.
 * Grava linha em `automation_tool_executions` com `source` indicado.
 */
export async function runAutomationHttpLikeTool(input: {
  tool: AutomationHttpToolRow;
  llmArgs: Record<string, unknown>;
  organizationId: string;
  botId: string;
  conversationId: string;
  executionSource: string;
}): Promise<{ ok: boolean; statusCode: number | null; responseText: string; error: string | null; durationMs: number }> {
  const { tool, llmArgs, organizationId, botId, conversationId, executionSource } = input;
  if (tool.toolType !== "HTTP_API" && tool.toolType !== "WEBHOOK") {
    return { ok: false, statusCode: null, responseText: "", error: "unsupported_tool_type", durationMs: 0 };
  }
  if (tool.organizationId !== organizationId) {
    return { ok: false, statusCode: null, responseText: "", error: "organization_mismatch", durationMs: 0 };
  }

  const paramSchema = safeOpenAiParametersSchema(tool.parametersSchema);
  const missingRequired = collectMissingRequiredSchemaFields(paramSchema, llmArgs);
  if (missingRequired.length > 0) {
    const responseText = buildValidationErrorPayload(missingRequired);
    const durationMs = 0;
    await prisma.$transaction(async (tx) => {
      await tx.automationToolExecution.create({
        data: {
          organizationId,
          toolId: tool.id,
          source: executionSource.slice(0, 32),
          ok: false,
          statusCode: null,
          durationMs,
          requestSummary: asJson({ validation: true, missingFields: missingRequired }),
          responseSummary: asJson({ preview: responseText.slice(0, 8000) }),
          errorMessage: "schema_validation_failed",
          tokensUsed: null,
          botId,
        },
      });
    });
    return {
      ok: false,
      statusCode: null,
      responseText,
      error: "schema_validation_failed",
      durationMs,
    };
  }

  const cfg = tool.config && typeof tool.config === "object" ? (tool.config as Record<string, unknown>) : {};

  const flat = buildHttpToolFlatContext(llmArgs, {
    organizationId,
    botId,
    conversationId,
  });

  const pathParamsObj = llmArgs.pathParams;
  const queryObj = llmArgs.query;
  const reservedPathMergeKeys = new Set([...HTTP_TOOL_RESERVED_ARG_KEYS]);

  let method = String(cfg.httpMethod ?? "GET").toUpperCase();
  let pathPart = expandTemplateString(String(cfg.httpPath ?? "/"), flat);
  let base = String(cfg.baseUrl ?? "").replace(/\/$/, "");
  let fullUrlStr = "";

  if (tool.toolType === "WEBHOOK") {
    const wUrl = expandTemplateString(String(cfg.webhookUrl ?? ""), flat);
    if (!wUrl.trim()) {
      return { ok: false, statusCode: null, responseText: "", error: "webhookUrl_missing", durationMs: 0 };
    }
    fullUrlStr = wUrl;
    method = String(cfg.httpMethod ?? "POST").toUpperCase();
  } else {
    if (!base) {
      return { ok: false, statusCode: null, responseText: "", error: "baseUrl_missing", durationMs: 0 };
    }
    const pp: Record<string, string> = {};
    if (pathParamsObj && typeof pathParamsObj === "object" && !Array.isArray(pathParamsObj)) {
      for (const [pk, pv] of Object.entries(pathParamsObj as Record<string, unknown>)) {
        if (pv !== undefined && pv !== null) pp[pk] = String(pv);
      }
    } else {
      for (const [k, v] of Object.entries(llmArgs)) {
        if (reservedPathMergeKeys.has(k)) continue;
        if (isScalar(v)) pp[k] = String(v);
      }
    }
    for (const [pk, pv] of Object.entries(pp)) {
      pathPart = pathPart.split(`{${pk}}`).join(encodeURIComponent(pv));
    }
    pathPart = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
    fullUrlStr = `${base}${pathPart}`;
  }

  let url: URL;
  try {
    url = assertHttpUrlAllowed(fullUrlStr);
  } catch (e) {
    return {
      ok: false,
      statusCode: null,
      responseText: "",
      error: e instanceof Error ? e.message : "invalid_url",
      durationMs: 0,
    };
  }

  const defaultQuery = cfg.defaultQuery && typeof cfg.defaultQuery === "object" ? (cfg.defaultQuery as Record<string, unknown>) : {};
  for (const [qk, qv] of Object.entries(defaultQuery)) {
    if (typeof qv === "string") {
      const expanded = expandTemplateString(qv, flat);
      if (!url.searchParams.has(qk)) url.searchParams.set(qk, expanded);
    } else if (typeof qv === "number" || typeof qv === "boolean") {
      if (!url.searchParams.has(qk)) url.searchParams.set(qk, String(qv));
    }
  }

  if (queryObj && typeof queryObj === "object" && !Array.isArray(queryObj)) {
    for (const [qk, qv] of Object.entries(queryObj)) {
      url.searchParams.set(qk, String(qv));
    }
  }

  const headers = new Headers();
  const defaultHeaders =
    cfg.defaultHeaders && typeof cfg.defaultHeaders === "object" ? (cfg.defaultHeaders as Record<string, unknown>) : {};
  for (const [hk, hv] of Object.entries(defaultHeaders)) {
    if (typeof hv === "string") headers.set(hk, expandTemplateString(hv, flat));
  }
  const hdrObj = llmArgs.headers;
  if (hdrObj && typeof hdrObj === "object" && !Array.isArray(hdrObj)) {
    for (const [hk, hv] of Object.entries(hdrObj)) {
      if (typeof hv === "string") headers.set(hk, expandTemplateString(hv, flat));
    }
  }

  const authType = String(cfg.authType ?? "none");
  if (authType === "bearer" || authType === "bearer_token") {
    const tok = String(cfg.bearerToken ?? "");
    if (tok) headers.set("Authorization", `Bearer ${tok}`);
  } else if (authType === "api_key") {
    const hName = String(cfg.apiKeyHeader ?? "X-Api-Key");
    const hVal = String(cfg.apiKeyValue ?? "");
    if (hVal) headers.set(hName, hVal);
  } else if (authType === "basic") {
    const u = String(cfg.basicUser ?? "");
    const p = String(cfg.basicPassword ?? "");
    if (u || p) {
      const b64 = Buffer.from(`${u}:${p}`).toString("base64");
      headers.set("Authorization", `Basic ${b64}`);
    }
  } else if (authType === "custom_header") {
    const hn = String(cfg.customAuthHeader ?? "");
    const hv = String(cfg.customAuthValue ?? "");
    if (hn && hv) headers.set(hn, hv);
  }

  let bodyStr: string | undefined;
  let bodySource: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const resolvedBody = resolveHttpRequestBody({ cfg, args: llmArgs, flat });
    bodyStr = resolvedBody.bodyStr;
    bodySource = resolvedBody.source;
    if (bodyStr && resolvedBody.contentType && !headers.has("Content-Type")) {
      headers.set("Content-Type", resolvedBody.contentType);
    }
  }

  const started = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let responseText = "";
  let errMsg: string | null = null;

  const reqSummary = {
    method,
    url: url.toString(),
    headerKeys: [...headers.keys()],
    bodySource,
    bodyBytes: bodyStr?.length ?? 0,
    bodyPreview: bodyStr ? truncateBody(bodyStr, 4000) : null,
  };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch(url.toString(), { method, headers, body: bodyStr, signal: ctrl.signal });
    clearTimeout(t);
    statusCode = res.status;
    ok = res.ok;
    responseText = truncateBody(await res.text(), 50_000);
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }

  const durationMs = Date.now() - started;

  await prisma.$transaction(async (tx) => {
    await tx.automationToolExecution.create({
      data: {
        organizationId,
        toolId: tool.id,
        source: executionSource.slice(0, 32),
        ok: ok && statusCode !== null && !errMsg,
        statusCode,
        durationMs,
        requestSummary: asJson(reqSummary),
        responseSummary: asJson({
          preview: responseText.slice(0, 8000),
          truncated: responseText.length > 8000,
        }),
        errorMessage: errMsg,
        tokensUsed: null,
        botId,
      },
    });
    const current = await tx.automationCustomTool.findUnique({ where: { id: tool.id } });
    if (current) {
      const n = current.executionCount + 1;
      const nextAvg =
        current.avgDurationMs != null
          ? (current.avgDurationMs * current.executionCount + durationMs) / n
          : durationMs;
      await tx.automationCustomTool.update({
        where: { id: tool.id },
        data: {
          executionCount: n,
          avgDurationMs: nextAvg,
          lastExecutedAt: new Date(),
        },
      });
    }
  });

  return {
    ok: ok && !errMsg,
    statusCode,
    responseText,
    error: errMsg,
    durationMs,
  };
}

export function openAiToolDefinitionForAutomationTool(
  tool: AutomationHttpToolRow,
  opts?: { agentInstruction?: string },
): {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  const name = openAiFunctionNameForAutomationTool(tool.id);
  const baseDesc =
    (tool.description ?? "").trim() ||
    `Ferramenta HTTP da organização «${tool.name}». Invoque quando o cliente precisar dos dados que esta API fornece.`;
  const extra = (opts?.agentInstruction ?? "").trim();
  const combined = extra
    ? `${baseDesc}\n\n[Instruções do configurador do agente]\n${extra}`.trim()
    : baseDesc;
  const description = combined.slice(0, 4000);
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: safeOpenAiParametersSchema(tool.parametersSchema),
    },
  };
}
