import { prisma } from "../db.js";
import type { AutomationHttpToolRow } from "./automationHttpToolExecute.js";
import { assertHttpUrlAllowed, truncateBody } from "./httpToolTest.js";

export const CAL_COM_DEFAULT_BASE_URL = "https://api.cal.com/v2";
export const CAL_COM_VERSION_BOOKINGS = "2026-02-25";
export const CAL_COM_VERSION_SLOTS = "2024-09-04";
export const CAL_COM_VERSION_EVENT_TYPES = "2024-06-14";

export type CalComAction = "list_event_types" | "get_slots" | "create_booking" | "cancel_booking";

export type CalComToolConfig = {
  apiKey: string;
  baseUrl: string;
  eventTypeId: number | null;
  eventTypeSlug: string;
  username: string;
  teamSlug: string;
  organizationSlug: string;
  timeZone: string;
  language: string;
};

export type CalComEventIdentity = {
  eventTypeId: number | null;
  eventTypeSlug: string;
  username: string;
  teamSlug: string;
  organizationSlug: string;
};

export type CalComContactHint = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

const CAL_COM_ACTIONS = new Set<CalComAction>([
  "list_event_types",
  "get_slots",
  "create_booking",
  "cancel_booking",
]);

function asJson(v: unknown): object {
  return v as object;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optionalNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isCalComToolType(toolType: string): boolean {
  return toolType.toUpperCase().replace(/-/g, "_") === "CAL_COM";
}

export function parseCalComAction(raw: unknown): CalComAction | null {
  const action = str(raw).toLowerCase().replace(/-/g, "_") as CalComAction;
  return CAL_COM_ACTIONS.has(action) ? action : null;
}

export function readCalComToolConfig(cfg: unknown): CalComToolConfig {
  const c = asRecord(cfg);
  const timeZone = str(c.timeZone) || "America/Sao_Paulo";
  const language = str(c.language) || "pt-BR";
  const baseUrl = (str(c.baseUrl) || CAL_COM_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    apiKey: str(c.apiKey),
    baseUrl,
    eventTypeId: optionalNumber(c.eventTypeId),
    eventTypeSlug: str(c.eventTypeSlug),
    username: str(c.username),
    teamSlug: str(c.teamSlug),
    organizationSlug: str(c.organizationSlug),
    timeZone,
    language,
  };
}

export function resolveCalComEventIdentity(
  cfg: CalComToolConfig,
  llmArgs: Record<string, unknown>,
): CalComEventIdentity {
  return {
    eventTypeId: optionalNumber(llmArgs.eventTypeId) ?? cfg.eventTypeId,
    eventTypeSlug: str(llmArgs.eventTypeSlug) || cfg.eventTypeSlug,
    username: str(llmArgs.username) || cfg.username,
    teamSlug: str(llmArgs.teamSlug) || cfg.teamSlug,
    organizationSlug: str(llmArgs.organizationSlug) || cfg.organizationSlug,
  };
}

export function hasCalComEventIdentity(identity: CalComEventIdentity): boolean {
  if (identity.eventTypeId != null) return true;
  if (!identity.eventTypeSlug) return false;
  return Boolean(identity.username || identity.teamSlug);
}

export function normalizeCalComStartToUtc(startIso: string): string | null {
  const trimmed = startIso.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function contactFromRuntimeContext(ctx: unknown): CalComContactHint | undefined {
  const root = asRecord(ctx);
  const contact = asRecord(root.contact);
  if (!contact.id && !contact.name && !contact.email && !contact.phone) return undefined;
  return {
    name: str(contact.name) || null,
    email: str(contact.email) || null,
    phone: str(contact.phone) || null,
  };
}

export function fillCalComAttendee(
  llmArgs: Record<string, unknown>,
  cfg: CalComToolConfig,
  contact?: CalComContactHint,
): {
  name: string;
  email: string;
  phoneNumber: string;
  timeZone: string;
  language: string;
  autoFilledFields: string[];
} {
  const autoFilledFields: string[] = [];
  let name = str(llmArgs.name) || str(llmArgs.attendeeName);
  let email = str(llmArgs.email) || str(llmArgs.attendeeEmail);
  let phoneNumber = str(llmArgs.phoneNumber) || str(llmArgs.phone);
  if (!name && contact?.name) {
    name = contact.name.trim();
    if (name) autoFilledFields.push("name");
  }
  if (!email && contact?.email) {
    email = contact.email.trim();
    if (email) autoFilledFields.push("email");
  }
  if (!phoneNumber && contact?.phone) {
    phoneNumber = contact.phone.trim();
    if (phoneNumber) autoFilledFields.push("phoneNumber");
  }
  const timeZone = str(llmArgs.timeZone) || cfg.timeZone;
  const language = str(llmArgs.language) || cfg.language;
  return { name, email, phoneNumber, timeZone, language, autoFilledFields };
}

function appendIdentityQuery(query: URLSearchParams, identity: CalComEventIdentity): void {
  if (identity.eventTypeId != null) query.set("eventTypeId", String(identity.eventTypeId));
  if (identity.eventTypeSlug) query.set("eventTypeSlug", identity.eventTypeSlug);
  if (identity.username) query.set("username", identity.username);
  if (identity.teamSlug) query.set("teamSlug", identity.teamSlug);
  if (identity.organizationSlug) query.set("organizationSlug", identity.organizationSlug);
}

export function buildCalComSlotsQuery(
  identity: CalComEventIdentity,
  llmArgs: Record<string, unknown>,
  cfg: CalComToolConfig,
): { query: URLSearchParams; missing: string[] } {
  const missing: string[] = [];
  const start = str(llmArgs.start);
  const end = str(llmArgs.end);
  if (!start) missing.push("start");
  if (!end) missing.push("end");
  if (!hasCalComEventIdentity(identity)) missing.push("eventTypeId_or_slug");
  const query = new URLSearchParams();
  if (start) query.set("start", start);
  if (end) query.set("end", end);
  appendIdentityQuery(query, identity);
  const timeZone = str(llmArgs.timeZone) || cfg.timeZone;
  if (timeZone) query.set("timeZone", timeZone);
  const duration = optionalNumber(llmArgs.duration ?? llmArgs.lengthInMinutes);
  if (duration != null) query.set("duration", String(duration));
  const format = str(llmArgs.format) || "range";
  if (format) query.set("format", format);
  const bookingUidToReschedule = str(llmArgs.bookingUidToReschedule);
  if (bookingUidToReschedule) query.set("bookingUidToReschedule", bookingUidToReschedule);
  return { query, missing };
}

export function buildCalComCreateBookingBody(
  identity: CalComEventIdentity,
  llmArgs: Record<string, unknown>,
  attendee: ReturnType<typeof fillCalComAttendee>,
): { body: Record<string, unknown>; missing: string[] } {
  const missing: string[] = [];
  const startRaw = str(llmArgs.start);
  const start = startRaw ? normalizeCalComStartToUtc(startRaw) : null;
  if (!start) missing.push("start");
  if (!attendee.name) missing.push("name");
  if (!attendee.email) missing.push("email");
  if (!attendee.timeZone) missing.push("timeZone");
  if (!hasCalComEventIdentity(identity)) missing.push("eventTypeId_or_slug");

  const attendeeBody: Record<string, unknown> = {
    name: attendee.name,
    timeZone: attendee.timeZone,
    language: attendee.language || "pt-BR",
  };
  if (attendee.email) attendeeBody.email = attendee.email;
  if (attendee.phoneNumber) attendeeBody.phoneNumber = attendee.phoneNumber;

  const body: Record<string, unknown> = {
    start,
    attendee: attendeeBody,
  };
  if (identity.eventTypeId != null) body.eventTypeId = identity.eventTypeId;
  if (identity.eventTypeSlug) body.eventTypeSlug = identity.eventTypeSlug;
  if (identity.username) body.username = identity.username;
  if (identity.teamSlug) body.teamSlug = identity.teamSlug;
  if (identity.organizationSlug) body.organizationSlug = identity.organizationSlug;

  const lengthInMinutes = optionalNumber(llmArgs.lengthInMinutes ?? llmArgs.duration);
  if (lengthInMinutes != null) body.lengthInMinutes = lengthInMinutes;

  const guestsRaw = llmArgs.guests;
  if (Array.isArray(guestsRaw)) {
    const guests = guestsRaw.map((g) => str(g)).filter(Boolean);
    if (guests.length) body.guests = guests;
  } else if (typeof guestsRaw === "string" && guestsRaw.trim()) {
    body.guests = guestsRaw
      .split(/[,;\s]+/)
      .map((g) => g.trim())
      .filter(Boolean);
  }

  const metadata = asRecord(llmArgs.metadata);
  if (Object.keys(metadata).length > 0) body.metadata = metadata;

  return { body, missing };
}

export function buildCalComAgentToolDescription(config: unknown): string {
  const cfg = readCalComToolConfig(config);
  const parts: string[] = [
    "Agendamento Cal.com (API v2). Fluxo: list_event_types → get_slots (intervalo start/end) → create_booking com o start UTC devolvido nos slots. Nunca invente horários.",
  ];
  if (cfg.eventTypeId != null) {
    parts.push(`Event type padrão: id ${cfg.eventTypeId}.`);
  } else if (cfg.eventTypeSlug) {
    const owner = cfg.username
      ? `user «${cfg.username}»`
      : cfg.teamSlug
        ? `equipa «${cfg.teamSlug}»`
        : "conta configurada";
    parts.push(`Event type padrão: slug «${cfg.eventTypeSlug}» (${owner}).`);
  } else {
    parts.push("Se o tipo de evento não estiver no config, use list_event_types ou passe eventTypeId.");
  }
  parts.push(`Fuso horário do participante por omissão: ${cfg.timeZone}.`);
  parts.push("start de create_booking deve ser ISO 8601 em UTC (ex.: 2026-08-20T14:00:00.000Z).");
  return parts.join(" ");
}

async function logCalComExecution(input: {
  organizationId: string;
  toolId: string;
  botId: string;
  source: string;
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  errorMessage: string | null;
}): Promise<void> {
  await prisma.automationToolExecution.create({
    data: {
      organizationId: input.organizationId,
      toolId: input.toolId,
      source: input.source.slice(0, 32),
      ok: input.ok,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      requestSummary: asJson(input.requestSummary),
      responseSummary: asJson(input.responseSummary),
      errorMessage: input.errorMessage,
      tokensUsed: null,
      botId: input.botId.trim() ? input.botId : null,
    },
  });
}

function failResult(input: {
  started: number;
  statusCode?: number | null;
  error: string;
  payload: Record<string, unknown>;
}): {
  ok: false;
  statusCode: number | null;
  responseText: string;
  error: string;
  durationMs: number;
  autoFilledFields?: string[];
} {
  return {
    ok: false,
    statusCode: input.statusCode ?? null,
    responseText: JSON.stringify({ ok: false, error: input.error, ...input.payload }),
    error: input.error,
    durationMs: Date.now() - input.started,
  };
}

async function calComRequest(input: {
  cfg: CalComToolConfig;
  method: "GET" | "POST";
  path: string;
  version: string;
  query?: URLSearchParams;
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = new URL(`${input.cfg.baseUrl}${path}`);
  if (input.query) {
    for (const [k, v] of input.query.entries()) url.searchParams.set(k, v);
  }
  assertHttpUrlAllowed(url.toString());
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.cfg.apiKey}`,
    "cal-api-version": input.version,
    Accept: "application/json",
  };
  if (input.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url.toString(), {
    method: input.method,
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.trim()) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { ok: res.ok, status: res.status, text, json };
}

function previewCalResponse(text: string, json: unknown): Record<string, unknown> {
  return {
    preview: truncateBody(text, 8000),
    ...(json && typeof json === "object" ? { parsed: true } : {}),
  };
}

/**
 * Executa ferramenta CAL_COM (agendar_calcom) com API key em config.
 * Auth: Authorization Bearer cal_ / cal_live_ — https://cal.com/docs/api-reference/v2/introduction
 */
export async function runCalComTool(input: {
  tool: AutomationHttpToolRow;
  llmArgs: Record<string, unknown>;
  organizationId: string;
  botId: string;
  conversationId: string;
  executionSource: string;
  runtimeSampleContext?: Record<string, unknown>;
  contact?: CalComContactHint;
}): Promise<{
  ok: boolean;
  statusCode: number | null;
  responseText: string;
  error: string | null;
  durationMs: number;
  autoFilledFields?: string[];
}> {
  const started = Date.now();
  const { tool, organizationId, botId, conversationId, executionSource } = input;

  if (!isCalComToolType(tool.toolType)) {
    return failResult({ started, error: "unsupported_tool_type", payload: {} });
  }
  if (tool.organizationId !== organizationId) {
    return failResult({ started, error: "organization_mismatch", payload: {} });
  }

  const cfg = readCalComToolConfig(tool.config);
  const action = parseCalComAction(input.llmArgs.action);
  const contact = input.contact ?? contactFromRuntimeContext(input.runtimeSampleContext);
  const identity = resolveCalComEventIdentity(cfg, input.llmArgs);
  const attendee = fillCalComAttendee(input.llmArgs, cfg, contact);

  const persist = async (result: {
    ok: boolean;
    statusCode: number | null;
    responseText: string;
    error: string | null;
    requestSummary: Record<string, unknown>;
  }) => {
    await logCalComExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: result.ok,
      statusCode: result.statusCode,
      durationMs: Date.now() - started,
      requestSummary: {
        conversationId,
        action: action ?? (str(input.llmArgs.action) || null),
        ...result.requestSummary,
      },
      responseSummary: { preview: result.responseText.slice(0, 8000) },
      errorMessage: result.error,
    });
  };

  if (!action) {
    const out = failResult({
      started,
      error: "missing_fields",
      payload: {
        missingFields: ["action"],
        allowed: [...CAL_COM_ACTIONS],
      },
    });
    await persist({
      ok: false,
      statusCode: null,
      responseText: out.responseText,
      error: out.error,
      requestSummary: { llmArgsKeys: Object.keys(input.llmArgs) },
    });
    return { ...out, autoFilledFields: attendee.autoFilledFields };
  }

  if (!cfg.apiKey || cfg.apiKey === "***") {
    const out = failResult({
      started,
      error: "cal_com_not_connected",
      payload: {
        message:
          "Cal.com não está ligado. Guarde a API key (Settings → Security) no painel da ferramenta.",
      },
    });
    await persist({
      ok: false,
      statusCode: null,
      responseText: out.responseText,
      error: out.error,
      requestSummary: { action },
    });
    return out;
  }

  try {
    let method: "GET" | "POST" = "GET";
    let path = "/event-types";
    let version = CAL_COM_VERSION_EVENT_TYPES;
    let query: URLSearchParams | undefined;
    let body: Record<string, unknown> | undefined;
    const missing: string[] = [];

    if (action === "list_event_types") {
      const q = new URLSearchParams();
      const username = str(input.llmArgs.username) || cfg.username;
      const eventSlug = str(input.llmArgs.eventTypeSlug) || cfg.eventTypeSlug;
      if (username) q.set("username", username);
      if (eventSlug) q.set("eventSlug", eventSlug);
      query = q;
    } else if (action === "get_slots") {
      version = CAL_COM_VERSION_SLOTS;
      path = "/slots";
      const built = buildCalComSlotsQuery(identity, input.llmArgs, cfg);
      missing.push(...built.missing);
      query = built.query;
    } else if (action === "create_booking") {
      method = "POST";
      version = CAL_COM_VERSION_BOOKINGS;
      path = "/bookings";
      const built = buildCalComCreateBookingBody(identity, input.llmArgs, attendee);
      missing.push(...built.missing);
      body = built.body;
    } else {
      method = "POST";
      version = CAL_COM_VERSION_BOOKINGS;
      const bookingUid = str(input.llmArgs.bookingUid) || str(input.llmArgs.uid);
      if (!bookingUid) missing.push("bookingUid");
      path = `/bookings/${encodeURIComponent(bookingUid || "_")}/cancel`;
      const cancellationReason = str(input.llmArgs.cancellationReason) || "Cancelled by assistant";
      body = { cancellationReason };
    }

    if (missing.length > 0) {
      const out = failResult({
        started,
        error: "missing_fields",
        payload: { missingFields: missing, action },
      });
      await persist({
        ok: false,
        statusCode: null,
        responseText: out.responseText,
        error: out.error,
        requestSummary: { action, missing },
      });
      return { ...out, autoFilledFields: attendee.autoFilledFields };
    }

    const calRes = await calComRequest({ cfg, method, path, version, query, body });
    const responseText = JSON.stringify({
      ok: calRes.ok,
      statusCode: calRes.status,
      action,
      data: calRes.json ?? truncateBody(calRes.text, 8000),
    });
    const durationMs = Date.now() - started;
    await logCalComExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: calRes.ok,
      statusCode: calRes.status,
      durationMs,
      requestSummary: {
        conversationId,
        action,
        method,
        path,
        query: query ? Object.fromEntries(query.entries()) : undefined,
        body: body ? { ...body, attendee: body.attendee ?? undefined } : undefined,
      },
      responseSummary: previewCalResponse(calRes.text, calRes.json),
      errorMessage: calRes.ok ? null : `cal_com_http_${calRes.status}`,
    });
    return {
      ok: calRes.ok,
      statusCode: calRes.status,
      responseText,
      error: calRes.ok ? null : "cal_com_api_error",
      durationMs,
      autoFilledFields: attendee.autoFilledFields,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const out = failResult({
      started,
      error: "cal_com_api_error",
      payload: { message: msg },
    });
    await persist({
      ok: false,
      statusCode: null,
      responseText: out.responseText,
      error: out.error,
      requestSummary: { action },
    });
    return { ...out, autoFilledFields: attendee.autoFilledFields };
  }
}
