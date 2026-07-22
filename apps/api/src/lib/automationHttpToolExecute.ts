import { Prisma } from "@prisma/client";
import { Blob } from "node:buffer";
import { prisma } from "../db.js";
import { getPublicOrigin } from "../config.js";
import { assertHttpUrlAllowed, buildToolExecutionRequestSummary, buildToolExecutionResponseSummary, truncateBody } from "./httpToolTest.js";
import { readMessageMediaFile } from "./mediaStorage.js";
import { secureHttpFetch } from "./secureHttpFetch.js";
import { buildNativeAgentInboundMediaWhere } from "./agentConversationHistory.js";

const LOCAL_MEDIA_FILENAME_RE = /^[a-f0-9]{32}\.[a-z0-9]+$/i;
const LOCAL_MEDIA_PATH = "/api/v1/messages/media/";
export const HTTP_TOOL_MEDIA_BASE64_MAX_BYTES = 4 * 1024 * 1024;

const INBOUND_MEDIA_MESSAGE_TYPES = new Set(["IMAGE", "DOCUMENT", "VIDEO", "AUDIO"]);

export type HttpToolInboundMediaPayload = {
  mediaUrl: string;
  mediaType: string;
  filename: string;
  buffer: Buffer;
  base64: string;
};

/** Anexo normalizado disponível em templates HTTP (`{{attachment.url}}`, `{{attachments.0.base64}}`, …). */
export type HttpToolMessageAttachment = {
  messageId: string;
  type: string;
  createdAt: string;
  url: string;
  mimeType: string;
  filename: string;
  base64: string;
  sizeBytes: number;
  /** Bytes carregados em memória (usados em multipart; não serializados no JSON do template). */
  hasBinary: boolean;
  base64Available: boolean;
};

function mimeFromMediaFilename(name: string, hint: string | null | undefined): string {
  const mt = (hint ?? "").split(";")[0].trim().toLowerCase();
  if (mt && mt !== "application/octet-stream") return mt;
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

function filenameFromMediaUrl(mediaUrl: string): string {
  try {
    const u = new URL(mediaUrl, getPublicOrigin());
    const idx = u.pathname.indexOf(LOCAL_MEDIA_PATH);
    if (idx !== -1) {
      const name = u.pathname.slice(idx + LOCAL_MEDIA_PATH.length);
      if (LOCAL_MEDIA_FILENAME_RE.test(name)) return name;
    }
    const tail = u.pathname.split("/").pop() ?? "upload.bin";
    return tail.includes(".") ? tail : "upload.bin";
  } catch {
    return "upload.bin";
  }
}

/** Carrega bytes de mediaUrl (storage local/MinIO ou URL pública). */
export async function loadHttpToolMediaBytes(
  mediaUrl: string,
  mediaType?: string | null,
): Promise<HttpToolInboundMediaPayload | null> {
  const trimmed = mediaUrl.trim();
  if (!trimmed) return null;

  try {
    const u = new URL(trimmed, getPublicOrigin());
    const idx = u.pathname.indexOf(LOCAL_MEDIA_PATH);
    if (idx !== -1) {
      const name = u.pathname.slice(idx + LOCAL_MEDIA_PATH.length);
      if (LOCAL_MEDIA_FILENAME_RE.test(name)) {
        const buffer = await readMessageMediaFile(name);
        if (buffer && buffer.length > 0) {
          const mime = mimeFromMediaFilename(name, mediaType);
          return {
            mediaUrl: trimmed,
            mediaType: mime,
            filename: name,
            buffer,
            base64: buffer.length <= HTTP_TOOL_MEDIA_BASE64_MAX_BYTES ? buffer.toString("base64") : "",
          };
        }
      }
    }

    if (u.protocol === "https:" || u.protocol === "http:") {
      assertHttpUrlAllowed(trimmed);
      const res = await secureHttpFetch(trimmed, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      if (buffer.length === 0) return null;
      const filename = filenameFromMediaUrl(trimmed);
      const mime = mimeFromMediaFilename(filename, res.headers.get("content-type") ?? mediaType);
      return {
        mediaUrl: trimmed,
        mediaType: mime,
        filename,
        buffer,
        base64: buffer.length <= HTTP_TOOL_MEDIA_BASE64_MAX_BYTES ? buffer.toString("base64") : "",
      };
    }
  } catch {
    return null;
  }
  return null;
}

function mediaSummaryForContext(media: HttpToolInboundMediaPayload | null): Record<string, unknown> | null {
  if (!media) return null;
  return {
    mediaUrl: media.mediaUrl,
    mediaType: media.mediaType,
    filename: media.filename,
    mediaBase64: media.base64 || undefined,
    sizeBytes: media.buffer.length,
    hasBinary: media.buffer.length > 0,
    base64Available: media.base64.length > 0,
  };
}

export function buildHttpToolAttachmentRecord(input: {
  messageId: string;
  type: string;
  createdAt: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  loaded?: HttpToolInboundMediaPayload | null;
}): HttpToolMessageAttachment | null {
  const url = (input.loaded?.mediaUrl ?? input.mediaUrl ?? "").trim();
  if (!url) return null;
  const loaded = input.loaded;
  const base64 = loaded?.base64 ?? "";
  return {
    messageId: input.messageId,
    type: input.type,
    createdAt: input.createdAt,
    url,
    mimeType: loaded?.mediaType ?? (input.mediaType ?? "").trim(),
    filename: loaded?.filename ?? filenameFromMediaUrl(url),
    base64,
    sizeBytes: loaded?.buffer.length ?? 0,
    hasBinary: Boolean(loaded?.buffer.length),
    base64Available: base64.length > 0,
  };
}

function isInboundMediaMessageType(type: string): boolean {
  return INBOUND_MEDIA_MESSAGE_TYPES.has(type);
}

/** Contexto automático para templates HTTP (mensagem, contacto, mídia recente). */
export async function buildNativeAgentHttpToolRuntimeContext(input: {
  organizationId: string;
  conversationId: string;
  lastClearedAt?: Date | null;
  message: {
    id: string;
    type: string;
    body: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    createdAt: Date;
  };
  contact?: { id: string; name: string | null; phone: string | null } | null;
}): Promise<Record<string, unknown>> {
  const lastClearedAt = input.lastClearedAt ?? null;
  const messageWithinContext =
    !lastClearedAt || input.message.createdAt.getTime() > lastClearedAt.getTime();

  const currentMedia =
    messageWithinContext &&
    input.message.mediaUrl?.trim() &&
    isInboundMediaMessageType(input.message.type)
      ? await loadHttpToolMediaBytes(input.message.mediaUrl, input.message.mediaType)
      : null;

  const recentRows = await prisma.message.findMany({
    where: buildNativeAgentInboundMediaWhere({
      conversationId: input.conversationId,
      lastClearedAt,
    }),
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      type: true,
      mediaUrl: true,
      mediaType: true,
      createdAt: true,
    },
  });

  const recentInboundMedia: Record<string, unknown>[] = [];
  const attachments: HttpToolMessageAttachment[] = [];
  const attachmentIds = new Set<string>();
  let fallbackMedia: HttpToolInboundMediaPayload | null = null;

  const pushAttachment = (record: HttpToolMessageAttachment | null) => {
    if (!record || attachmentIds.has(record.messageId)) return;
    attachmentIds.add(record.messageId);
    attachments.push(record);
  };

  for (const row of recentRows) {
    if (!row.mediaUrl?.trim()) continue;
    const loaded = await loadHttpToolMediaBytes(row.mediaUrl, row.mediaType);
    const summary = mediaSummaryForContext(loaded);
    if (summary) {
      recentInboundMedia.push({
        messageId: row.id,
        type: row.type,
        createdAt: row.createdAt.toISOString(),
        ...summary,
      });
      pushAttachment(
        buildHttpToolAttachmentRecord({
          messageId: row.id,
          type: row.type,
          createdAt: row.createdAt.toISOString(),
          mediaUrl: row.mediaUrl,
          mediaType: row.mediaType,
          loaded,
        }),
      );
      if (!fallbackMedia && loaded) fallbackMedia = loaded;
    }
  }

  const primaryMedia = currentMedia ?? fallbackMedia;

  const messageCtx: Record<string, unknown> = {
    id: input.message.id,
    type: input.message.type,
    body: (input.message.body ?? "").trim(),
    mediaUrl: input.message.mediaUrl ?? "",
    mediaType: input.message.mediaType ?? "",
    createdAt: input.message.createdAt.toISOString(),
  };
  const currentSummary = mediaSummaryForContext(currentMedia);
  if (currentSummary) Object.assign(messageCtx, currentSummary);

  const currentAttachment = buildHttpToolAttachmentRecord({
    messageId: input.message.id,
    type: input.message.type,
    createdAt: input.message.createdAt.toISOString(),
    mediaUrl: input.message.mediaUrl,
    mediaType: input.message.mediaType,
    loaded: currentMedia,
  });
  if (currentAttachment) {
    messageCtx.attachment = currentAttachment;
    pushAttachment(currentAttachment);
  }

  const primaryAttachment = currentAttachment ?? attachments[0] ?? null;

  const contactCtx = input.contact
    ? {
        id: input.contact.id,
        name: input.contact.name ?? "",
        phone: input.contact.phone ?? "",
      }
    : {};

  const messageType = input.message.type;
  const attachmentMime = primaryAttachment?.mimeType ?? input.message.mediaType ?? "";

  return {
    message: messageCtx,
    contact: contactCtx,
    conversation: { id: input.conversationId },
    attachment: primaryAttachment ?? {},
    attachments,
    recentInboundMedia,
    mediaUrl: primaryMedia?.mediaUrl ?? input.message.mediaUrl ?? "",
    mediaType: primaryMedia?.mediaType ?? input.message.mediaType ?? "",
    mediaBase64: primaryMedia?.base64 ?? "",
    mediaFilename: primaryMedia?.filename ?? "",
    attachmentUrl: primaryAttachment?.url ?? input.message.mediaUrl ?? "",
    attachmentMimeType: attachmentMime,
    attachmentFilename: primaryAttachment?.filename ?? "",
    attachmentBase64: primaryAttachment?.base64 ?? "",
    // Aliases convenientes para templates ({{type}} / {{mimeType}})
    type: messageType,
    mimeType: attachmentMime,
    hasInboundMedia: Boolean(primaryAttachment?.hasBinary || primaryMedia?.buffer.length),
    base64Available: Boolean(primaryAttachment?.base64Available || (primaryMedia?.base64?.length ?? 0) > 0),
  };
}

function mergeLlmArgsWithRuntimeContext(
  llmArgs: Record<string, unknown>,
  runtimeSampleContext?: Record<string, unknown>,
): Record<string, unknown> {
  if (!runtimeSampleContext || Object.keys(runtimeSampleContext).length === 0) return llmArgs;
  const existing =
    llmArgs.sampleContext && typeof llmArgs.sampleContext === "object" && !Array.isArray(llmArgs.sampleContext)
      ? (llmArgs.sampleContext as Record<string, unknown>)
      : {};
  return {
    ...llmArgs,
    sampleContext: { ...runtimeSampleContext, ...existing },
  };
}

function isMultipartBodyType(bodyType: string): boolean {
  const t = bodyType.trim().toLowerCase();
  return t === "multipart" || t === "multipart/form-data" || t === "form-data";
}

function buildMultipartFormData(input: {
  cfg: Record<string, unknown>;
  expandedBody: unknown;
  inboundMedia: HttpToolInboundMediaPayload | null;
}): FormData | null {
  const fileField = String(input.cfg.multipartFileField ?? "file").trim() || "file";
  if (!input.inboundMedia) return null;

  const form = new FormData();
  const blob = new Blob([input.inboundMedia.buffer], { type: input.inboundMedia.mediaType });
  form.append(fileField, blob, input.inboundMedia.filename);

  if (input.expandedBody && typeof input.expandedBody === "object" && !Array.isArray(input.expandedBody)) {
    for (const [k, v] of Object.entries(input.expandedBody as Record<string, unknown>)) {
      if (k === fileField || v === undefined || v === null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        form.append(k, String(v));
      } else {
        form.append(k, JSON.stringify(v));
      }
    }
  }

  return form;
}

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

  // Promove flowSlots para chaves de topo ({{reservationId}} além de {{flowSlots.reservationId}})
  const sample =
    args.sampleContext && typeof args.sampleContext === "object" && !Array.isArray(args.sampleContext)
      ? (args.sampleContext as Record<string, unknown>)
      : null;
  const slotBags: Record<string, unknown>[] = [];
  if (sample?.flowSlots && typeof sample.flowSlots === "object" && !Array.isArray(sample.flowSlots)) {
    slotBags.push(sample.flowSlots as Record<string, unknown>);
  }
  if (
    sample?.conversation &&
    typeof sample.conversation === "object" &&
    !Array.isArray(sample.conversation)
  ) {
    const conv = sample.conversation as Record<string, unknown>;
    if (conv.flowSlots && typeof conv.flowSlots === "object" && !Array.isArray(conv.flowSlots)) {
      slotBags.push(conv.flowSlots as Record<string, unknown>);
    }
  }
  for (const bag of slotBags) {
    for (const [k, v] of Object.entries(bag)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        if (!(k in flat) || !flat[k]) flat[k] = String(v);
      }
    }
  }

  if (extras) Object.assign(flat, extras);
  return flat;
}

export function resolveHttpRequestBody(options: {
  cfg: Record<string, unknown>;
  args: Record<string, unknown>;
  flat: Record<string, string>;
  inboundMedia?: HttpToolInboundMediaPayload | null;
}): {
  bodyStr?: string;
  multipartFormData?: FormData;
  contentType?: string;
  source?: "explicit" | "template" | "inline" | "none" | "multipart";
} {
  const { cfg, args, flat, inboundMedia } = options;
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

  if (isMultipartBodyType(bodyType)) {
    const form = buildMultipartFormData({ cfg, expandedBody: expanded, inboundMedia: inboundMedia ?? null });
    if (form) {
      return { multipartFormData: form, source: "multipart" };
    }
    return { source: "none" };
  }

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

const AUTOMATION_TOOL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve UUID da ferramenta a partir de campos persistidos no log de execução. */
export function resolveAutomationToolIdFromLogNode(nodeId: string, nodeName: string): string | null {
  const fromId = parseAutomationToolIdFromOpenAiName(nodeId);
  if (fromId) return fromId;
  const stripped = nodeName.replace(/^Tool:\s*/i, "").trim();
  const fromName = parseAutomationToolIdFromOpenAiName(stripped);
  if (fromName) return fromName;
  const ocMatch =
    nodeName.match(/oc_tool_[a-f0-9]{32}/i)?.[0] ?? nodeId.match(/oc_tool_[a-f0-9]{32}/i)?.[0];
  if (ocMatch) return parseAutomationToolIdFromOpenAiName(ocMatch);
  if (AUTOMATION_TOOL_UUID_RE.test(nodeId)) return nodeId;
  return null;
}

function safeOpenAiParametersSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const o = schema as Record<string, unknown>;
    if (o.type === "object") return o;
  }
  return { type: "object", properties: {} };
}

function schemaProperties(schema: Record<string, unknown>): Record<string, unknown> | null {
  const props = schema.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  return props as Record<string, unknown>;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function maxTypoDistanceForKey(key: string): number {
  return Math.max(5, Math.floor(key.length * 0.2));
}

function findLikelySchemaKeyAlias(
  argKey: string,
  expectedKey: string,
): boolean {
  if (argKey === expectedKey) return true;
  const argLower = argKey.toLowerCase();
  const expLower = expectedKey.toLowerCase();
  if (argLower === expLower) return true;
  return levenshteinDistance(argLower, expLower) <= maxTypoDistanceForKey(expectedKey);
}

/** Corrige typos frequentes do LLM nos nomes dos argumentos (ex.: reservationIdOrLocalLocalizer). */
export function normalizeLlmArgsKeyAliases(
  llmArgs: Record<string, unknown>,
  schema: unknown,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return llmArgs;
  const s = schema as Record<string, unknown>;
  const props = schemaProperties(s);
  if (!props) return llmArgs;

  const normalized: Record<string, unknown> = { ...llmArgs };
  const claimedArgKeys = new Set<string>();

  for (const expectedKey of Object.keys(props)) {
    const current = normalized[expectedKey];
    if (current !== undefined && current !== null) {
      claimedArgKeys.add(expectedKey);
      continue;
    }

    for (const [argKey, val] of Object.entries(llmArgs)) {
      if (val === undefined || val === null) continue;
      if (claimedArgKeys.has(argKey)) continue;
      if (!findLikelySchemaKeyAlias(argKey, expectedKey)) continue;
      normalized[expectedKey] = val;
      claimedArgKeys.add(argKey);
      break;
    }
  }

  for (const [key, childSchema] of Object.entries(props)) {
    const val = normalized[key];
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    if (!childSchema || typeof childSchema !== "object" || Array.isArray(childSchema)) continue;
    normalized[key] = normalizeLlmArgsKeyAliases(val as Record<string, unknown>, childSchema);
  }

  return normalized;
}

function collectSimilarArgKeyHints(
  missing: string[],
  llmArgs: Record<string, unknown>,
): string[] {
  const hints: string[] = [];
  const argKeys = Object.keys(llmArgs);
  for (const field of missing) {
    const rootField = field.split(".")[0] ?? field;
    if (rootField in llmArgs && llmArgs[rootField] !== undefined && llmArgs[rootField] !== null) continue;
    for (const argKey of argKeys) {
      if (argKey === rootField) continue;
      if (!findLikelySchemaKeyAlias(argKey, rootField)) continue;
      hints.push(`Recebido «${argKey}» — o schema espera «${rootField}».`);
      break;
    }
  }
  return hints;
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

const CONTEXT_FILL_SKIP_KEYS = new Set([
  ...HTTP_TOOL_RESERVED_ARG_KEYS,
  "sampleContext",
]);

function isFillableScalar(v: unknown): v is string | number | boolean {
  if (typeof v === "boolean" || typeof v === "number") return typeof v === "number" ? Number.isFinite(v) : true;
  if (typeof v === "string") return true;
  return false;
}

function lookupFillValue(sources: Record<string, unknown>, key: string): unknown {
  if (key in sources && sources[key] !== undefined && sources[key] !== null) return sources[key];
  const lower = key.toLowerCase();
  for (const [sk, sv] of Object.entries(sources)) {
    if (sk.toLowerCase() === lower) return sv;
  }
  // Alias leve: reservationId ↔ reservationIdOrLocalizer, etc.
  for (const [sk, sv] of Object.entries(sources)) {
    const a = sk.toLowerCase();
    const b = lower;
    if (a.includes(b) || b.includes(a)) {
      if (Math.abs(a.length - b.length) <= Math.max(8, Math.floor(b.length * 0.35))) return sv;
    }
  }
  return undefined;
}

/**
 * Fontes genéricas para completar required omitidos pelo modelo:
 * argDefaults da tool, defaults do JSON Schema, flowSlots / sampleContext.
 */
export function buildSchemaFillSources(
  llmArgs: Record<string, unknown>,
  cfg?: Record<string, unknown>,
): Record<string, unknown> {
  const sources: Record<string, unknown> = {};

  const argDefaults =
    cfg?.argDefaults && typeof cfg.argDefaults === "object" && !Array.isArray(cfg.argDefaults)
      ? (cfg.argDefaults as Record<string, unknown>)
      : null;
  if (argDefaults) {
    for (const [k, v] of Object.entries(argDefaults)) {
      if (isFillableScalar(v) || (v && typeof v === "object")) sources[k] = v;
    }
  }

  const sample =
    llmArgs.sampleContext && typeof llmArgs.sampleContext === "object" && !Array.isArray(llmArgs.sampleContext)
      ? (llmArgs.sampleContext as Record<string, unknown>)
      : null;

  if (sample) {
    for (const [k, v] of Object.entries(sample)) {
      if (CONTEXT_FILL_SKIP_KEYS.has(k)) continue;
      if (isFillableScalar(v)) sources[k] = v;
    }

    const flowSlots =
      (sample.flowSlots && typeof sample.flowSlots === "object" && !Array.isArray(sample.flowSlots)
        ? (sample.flowSlots as Record<string, unknown>)
        : null) ??
      (sample.conversation &&
      typeof sample.conversation === "object" &&
      !Array.isArray(sample.conversation) &&
      (sample.conversation as Record<string, unknown>).flowSlots &&
      typeof (sample.conversation as Record<string, unknown>).flowSlots === "object"
        ? ((sample.conversation as Record<string, unknown>).flowSlots as Record<string, unknown>)
        : null);
    if (flowSlots) {
      for (const [k, v] of Object.entries(flowSlots)) {
        if (isFillableScalar(v)) sources[k] = v;
      }
    }

    const contact =
      sample.contact && typeof sample.contact === "object" && !Array.isArray(sample.contact)
        ? (sample.contact as Record<string, unknown>)
        : null;
    if (contact) {
      if (typeof contact.name === "string" && contact.name.trim()) {
        sources.contactName = contact.name;
        sources.name = sources.name ?? contact.name;
      }
      if (typeof contact.phone === "string" && contact.phone.trim()) {
        sources.contactPhone = contact.phone;
        sources.phone = sources.phone ?? contact.phone;
        sources.mobilePhoneNumber = sources.mobilePhoneNumber ?? contact.phone;
      }
    }
  }

  return sources;
}

/**
 * Preenche campos required em falta a partir de defaults do schema + contexto (retry antes de falhar).
 * Não inventa valores: só usa default explícito, argDefaults ou slots/contexto já conhecidos.
 */
export function fillMissingRequiredSchemaFields(input: {
  schema: unknown;
  data: Record<string, unknown>;
  fillSources: Record<string, unknown>;
}): { data: Record<string, unknown>; applied: string[] } {
  const applied: string[] = [];
  const schema = input.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { data: input.data, applied };
  }

  const fillAt = (
    childSchema: unknown,
    obj: Record<string, unknown>,
    pathPrefix: string,
  ): void => {
    if (!childSchema || typeof childSchema !== "object" || Array.isArray(childSchema)) return;
    const s = childSchema as Record<string, unknown>;
    const props =
      s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)
        ? (s.properties as Record<string, unknown>)
        : null;
    if (!props) return;

    const required = Array.isArray(s.required)
      ? s.required.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];

    for (const key of Object.keys(props)) {
      const propSchema = props[key];
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const current = obj[key];

      if (current === undefined || current === null) {
        let filled: unknown;
        if (propSchema && typeof propSchema === "object" && !Array.isArray(propSchema) && "default" in propSchema) {
          filled = (propSchema as Record<string, unknown>).default;
        }
        if (filled === undefined) {
          const fromCtx = lookupFillValue(input.fillSources, key);
          if (fromCtx !== undefined && fromCtx !== null) filled = fromCtx;
        }
        if (filled !== undefined) {
          obj[key] = filled;
          applied.push(path);
        }
      }

      const next = obj[key];
      if (
        next &&
        typeof next === "object" &&
        !Array.isArray(next) &&
        propSchema &&
        typeof propSchema === "object"
      ) {
        fillAt(propSchema, next as Record<string, unknown>, path);
      } else if (
        (next === undefined || next === null) &&
        required.includes(key) &&
        propSchema &&
        typeof propSchema === "object" &&
        !Array.isArray(propSchema) &&
        ((propSchema as Record<string, unknown>).type === "object" ||
          (propSchema as Record<string, unknown>).properties)
      ) {
        // Cria objecto vazio para permitir defaults aninhados
        obj[key] = {};
        applied.push(path);
        fillAt(propSchema, obj[key] as Record<string, unknown>, path);
      }
    }
  };

  const data = { ...input.data };
  fillAt(schema, data, "");
  return { data, applied };
}

function templateReferencesMediaBase64(template: unknown): boolean {
  const raw =
    typeof template === "string"
      ? template
      : template != null
        ? JSON.stringify(template)
        : "";
  return /\{\{\s*(attachmentBase64|mediaBase64|attachment\.base64|attachments\.\d+\.base64)\s*\}\}/i.test(raw);
}

function buildValidationErrorPayload(missing: string[], llmArgs?: Record<string, unknown>): string {
  const hints = llmArgs ? collectSimilarArgKeyHints(missing, llmArgs) : [];
  const typoBlock =
    hints.length > 0
      ? ` Possíveis typos nos nomes dos campos: ${hints.join(" ")}`
      : "";
  return JSON.stringify({
    ok: false,
    validationError: true,
    missingFields: missing,
    message:
      "Argumentos incompletos para a ferramenta HTTP. Inclua os campos obrigatórios do schema (ou configure defaults/argDefaults / estado de conversa) antes de repetir a chamada. " +
      `Campos em falta: ${missing.join(", ")}.` +
      typoBlock,
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
  /** Contexto da conversa (mensagem, contacto, mídia) injectado em sampleContext. */
  runtimeSampleContext?: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  statusCode: number | null;
  responseText: string;
  error: string | null;
  durationMs: number;
  /** Campos preenchidos automaticamente a partir de defaults/contexto antes do HTTP. */
  autoFilledFields?: string[];
}> {
  const { tool, organizationId, botId, conversationId, executionSource, runtimeSampleContext } = input;
  const mergedArgs = mergeLlmArgsWithRuntimeContext(input.llmArgs, runtimeSampleContext);
  const paramSchema = safeOpenAiParametersSchema(tool.parametersSchema);
  const cfg = tool.config && typeof tool.config === "object" ? (tool.config as Record<string, unknown>) : {};
  let llmArgs = normalizeLlmArgsKeyAliases(mergedArgs, paramSchema);

  if (tool.toolType !== "HTTP_API" && tool.toolType !== "WEBHOOK") {
    return { ok: false, statusCode: null, responseText: "", error: "unsupported_tool_type", durationMs: 0 };
  }
  if (tool.organizationId !== organizationId) {
    return { ok: false, statusCode: null, responseText: "", error: "organization_mismatch", durationMs: 0 };
  }

  // Retry de schema: defaults JSON Schema + argDefaults + flowSlots/sampleContext
  const fillSources = buildSchemaFillSources(llmArgs, cfg);
  const filled = fillMissingRequiredSchemaFields({
    schema: paramSchema,
    data: llmArgs,
    fillSources,
  });
  llmArgs = filled.data;
  const autoFilledFields = filled.applied;

  let missingRequired = collectMissingRequiredSchemaFields(paramSchema, llmArgs);
  if (missingRequired.length > 0) {
    // Segunda passagem: aliases já normalizados + fontes após merge
    const filledAgain = fillMissingRequiredSchemaFields({
      schema: paramSchema,
      data: llmArgs,
      fillSources: { ...fillSources, ...buildSchemaFillSources(llmArgs, cfg) },
    });
    llmArgs = filledAgain.data;
    for (const p of filledAgain.applied) {
      if (!autoFilledFields.includes(p)) autoFilledFields.push(p);
    }
    missingRequired = collectMissingRequiredSchemaFields(paramSchema, llmArgs);
  }

  if (missingRequired.length > 0) {
    const responseText = buildValidationErrorPayload(missingRequired, mergedArgs);
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
          requestSummary: asJson({
            validation: true,
            missingFields: missingRequired,
            autoFilledFields: autoFilledFields.slice(0, 40),
          }),
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
      autoFilledFields,
    };
  }

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
  let multipartFormData: FormData | undefined;
  let bodySource: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const mediaUrlForUpload =
      typeof flat.mediaUrl === "string" && flat.mediaUrl.trim()
        ? flat.mediaUrl.trim()
        : typeof flat["message.mediaUrl"] === "string" && flat["message.mediaUrl"].trim()
          ? flat["message.mediaUrl"].trim()
          : "";
    const mediaTypeForUpload =
      flat.mediaType || flat["message.mediaType"] || undefined;
    const inboundMedia = isMultipartBodyType(String(cfg.bodyType ?? "json"))
      ? mediaUrlForUpload
        ? await loadHttpToolMediaBytes(mediaUrlForUpload, mediaTypeForUpload)
        : null
      : null;

    const configuredTemplate = cfg.bodyTemplate ?? cfg.body;
    if (
      !isMultipartBodyType(String(cfg.bodyType ?? "json")) &&
      templateReferencesMediaBase64(configuredTemplate)
    ) {
      const b64 =
        (typeof flat.attachmentBase64 === "string" && flat.attachmentBase64) ||
        (typeof flat.mediaBase64 === "string" && flat.mediaBase64) ||
        "";
      const hasBinaryFlag = flat.hasInboundMedia === "true" || flat.base64Available === "true";
      if (!b64) {
        const mediaPresent = Boolean(mediaUrlForUpload) || hasBinaryFlag;
        return {
          ok: false,
          statusCode: null,
          responseText: JSON.stringify({
            ok: false,
            error: mediaPresent ? "attachment_base64_unavailable" : "inbound_media_missing",
            message: mediaPresent
              ? "O template referencia {{attachmentBase64}}/{{mediaBase64}}, mas o binário não está disponível em base64 (ficheiro demasiado grande ou falha ao carregar). Use bodyType multipart para anexos grandes, ou garanta mídia inbound na mensagem actual."
              : "O template referencia anexo em base64, mas não há mídia inbound (imagem/documento) na mensagem actual nem no histórico recente. A transcrição OCR de imagem não substitui o ficheiro binário.",
          }),
          error: mediaPresent ? "attachment_base64_unavailable" : "inbound_media_missing",
          durationMs: 0,
          autoFilledFields,
        };
      }
    }

    const resolvedBody = resolveHttpRequestBody({ cfg, args: llmArgs, flat, inboundMedia });
    bodyStr = resolvedBody.bodyStr;
    multipartFormData = resolvedBody.multipartFormData;
    bodySource = resolvedBody.source;
    if (bodyStr && resolvedBody.contentType && !headers.has("Content-Type")) {
      headers.set("Content-Type", resolvedBody.contentType);
    }
    if (multipartFormData && headers.has("Content-Type")) {
      headers.delete("Content-Type");
    }
    if (
      isMultipartBodyType(String(cfg.bodyType ?? "json")) &&
      method !== "GET" &&
      method !== "HEAD" &&
      !multipartFormData
    ) {
      return {
        ok: false,
        statusCode: null,
        responseText: JSON.stringify({
          ok: false,
          error: "inbound_media_missing",
          message:
            "Ferramenta multipart requer mídia inbound (imagem/documento) na mensagem ou no histórico recente da conversa. A transcrição OCR não substitui o anexo binário.",
        }),
        error: "inbound_media_missing",
        durationMs: 0,
        autoFilledFields,
      };
    }
  }

  const requestBody: FormData | string | undefined = multipartFormData ?? bodyStr;

  const started = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let responseText = "";
  let errMsg: string | null = null;

  const reqSummary = buildToolExecutionRequestSummary({
    method,
    url: url.toString(),
    headers,
    bodyStr: multipartFormData ? `[multipart/form-data; file=${String(cfg.multipartFileField ?? "file")}]` : bodyStr,
    bodySource,
  });

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const res = await secureHttpFetch(url.toString(), { method, headers, body: requestBody, signal: ctrl.signal });
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
        requestSummary: asJson({
          ...reqSummary,
          ...(autoFilledFields.length > 0 ? { autoFilledFields: autoFilledFields.slice(0, 40) } : {}),
        }),
        responseSummary: asJson(buildToolExecutionResponseSummary(responseText)),
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
    autoFilledFields,
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
