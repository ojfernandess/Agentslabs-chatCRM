import { prisma } from "../db.js";
import type { AutomationHttpToolRow } from "./automationHttpToolExecute.js";
import { refreshGoogleAccessToken } from "./googleCalendarOAuth.js";
import {
  readTeamMembers,
  resolveCalendarBookingTarget,
  type GoogleCalendarConnectedEntry,
} from "./googleCalendarTeam.js";

export type GoogleCalendarAvailability = {
  days: number[];
  start: string;
  end: string;
};

export type ConnectedCalendar = GoogleCalendarConnectedEntry;

function asJson(v: unknown): object {
  return v as object;
}

function readGoogleCalendarConfig(cfg: unknown): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  availability: GoogleCalendarAvailability;
  connectedCalendars: ConnectedCalendar[];
  teamMembers: ReturnType<typeof readTeamMembers>;
} {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const avRaw = c.availability && typeof c.availability === "object" ? (c.availability as Record<string, unknown>) : {};
  const daysRaw = Array.isArray(avRaw.days) ? avRaw.days : [1, 2, 3, 4, 5];
  const days = daysRaw.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6);
  const connectedRaw = Array.isArray(c.connectedCalendars) ? c.connectedCalendars : [];
  const connectedCalendars = connectedRaw
    .filter((x): x is Record<string, unknown> => x && typeof x === "object")
    .map((x) => ({
      id: String(x.id ?? "").trim(),
      name: String(x.name ?? x.id ?? "Agenda").trim(),
      memberId: typeof x.memberId === "string" ? x.memberId : undefined,
      email: typeof x.email === "string" ? x.email : undefined,
    }))
    .filter((x) => x.id);
  const teamMembers = readTeamMembers(cfg);
  return {
    clientId: String(c.client_id ?? "").trim(),
    clientSecret: String(c.client_secret ?? "").trim(),
    refreshToken: String(c.refresh_token ?? "").trim(),
    calendarId: String(c.calendar_id ?? "primary").trim() || "primary",
    availability: {
      days: days.length > 0 ? days : [1, 2, 3, 4, 5],
      start: String(avRaw.start ?? "09:00").trim() || "09:00",
      end: String(avRaw.end ?? "18:00").trim() || "18:00",
    },
    connectedCalendars:
      connectedCalendars.length > 0 ? connectedCalendars : [{ id: "primary", name: "Principal", memberId: "admin" }],
    teamMembers,
  };
}

export function resolveGoogleCalendarId(
  calendarName: string | undefined,
  connectedCalendars: ConnectedCalendar[],
  defaultCalendarId: string,
): string {
  const name = (calendarName ?? "").trim().toLowerCase();
  if (name) {
    const match = connectedCalendars.find(
      (c) => c.name.trim().toLowerCase() === name || c.id.trim().toLowerCase() === name,
    );
    if (match) return match.id;
  }
  return defaultCalendarId || "primary";
}

function parseTimeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

export function isWithinGoogleCalendarAvailability(
  startIso: string,
  endIso: string,
  availability: GoogleCalendarAvailability,
): { ok: true } | { ok: false; reason: string } {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, reason: "invalid_datetime" };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, reason: "end_before_start" };
  }
  const day = start.getDay();
  if (!availability.days.includes(day)) {
    return { ok: false, reason: "day_not_available" };
  }
  const startMin = parseTimeToMinutes(availability.start);
  const endMin = parseTimeToMinutes(availability.end);
  if (startMin == null || endMin == null || endMin <= startMin) {
    return { ok: true };
  }
  const eventStartMin = start.getHours() * 60 + start.getMinutes();
  const eventEndMin = end.getHours() * 60 + end.getMinutes();
  if (eventStartMin < startMin || eventEndMin > endMin) {
    return { ok: false, reason: "outside_availability_window" };
  }
  return { ok: true };
}

async function createGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  description?: string;
}): Promise<{ eventId: string; htmlLink?: string }> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`;
  const body = {
    summary: input.title,
    description: input.description?.trim() || undefined,
    start: { dateTime: input.start },
    end: { dateTime: input.end },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { id?: string; htmlLink?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? "event_create_failed");
  }
  if (!json.id) throw new Error("missing_event_id");
  return { eventId: json.id, htmlLink: json.htmlLink };
}

/**
 * Executa ferramenta GOOGLE_CALENDAR (agendar_google) com OAuth refresh_token guardado na config.
 */
export async function runGoogleCalendarTool(input: {
  tool: AutomationHttpToolRow;
  llmArgs: Record<string, unknown>;
  organizationId: string;
  botId: string;
  conversationId: string;
  executionSource: string;
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

  if (tool.toolType !== "GOOGLE_CALENDAR") {
    return {
      ok: false,
      statusCode: null,
      responseText: "",
      error: "unsupported_tool_type",
      durationMs: 0,
    };
  }
  if (tool.organizationId !== organizationId) {
    return {
      ok: false,
      statusCode: null,
      responseText: "",
      error: "organization_mismatch",
      durationMs: 0,
    };
  }

  const cfg = readGoogleCalendarConfig(tool.config);
  const title = String(input.llmArgs.title ?? "").trim();
  const start = String(input.llmArgs.start ?? "").trim();
  const end = String(input.llmArgs.end ?? "").trim();
  const calendarName =
    typeof input.llmArgs.calendar_name === "string" ? input.llmArgs.calendar_name : undefined;
  const description =
    typeof input.llmArgs.description === "string" ? input.llmArgs.description : undefined;

  const missing: string[] = [];
  if (!title) missing.push("title");
  if (!start) missing.push("start");
  if (!end) missing.push("end");
  if (missing.length > 0) {
    const responseText = JSON.stringify({ ok: false, error: "missing_fields", missingFields: missing });
    await logGoogleCalendarExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: false,
      durationMs: Date.now() - started,
      requestSummary: { llmArgs: input.llmArgs },
      responseSummary: { preview: responseText },
      errorMessage: "missing_fields",
    });
    return {
      ok: false,
      statusCode: null,
      responseText,
      error: "missing_fields",
      durationMs: Date.now() - started,
    };
  }

  if (!cfg.clientId || !cfg.clientSecret) {
    const responseText = JSON.stringify({
      ok: false,
      error: "google_calendar_not_connected",
      message:
        "Google Calendar não está ligado. Configure client_id/client_secret e conclua o OAuth no painel de automação.",
    });
    await logGoogleCalendarExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: false,
      durationMs: Date.now() - started,
      requestSummary: { llmArgs: input.llmArgs },
      responseSummary: { preview: responseText },
      errorMessage: "google_calendar_not_connected",
    });
    return {
      ok: false,
      statusCode: null,
      responseText,
      error: "google_calendar_not_connected",
      durationMs: Date.now() - started,
    };
  }

  const availabilityCheck = isWithinGoogleCalendarAvailability(start, end, cfg.availability);
  if (!availabilityCheck.ok) {
    const responseText = JSON.stringify({
      ok: false,
      error: availabilityCheck.reason,
      message: "Horário fora da disponibilidade configurada para agendamento.",
    });
    await logGoogleCalendarExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: false,
      durationMs: Date.now() - started,
      requestSummary: { llmArgs: input.llmArgs },
      responseSummary: { preview: responseText },
      errorMessage: availabilityCheck.reason,
    });
    return {
      ok: false,
      statusCode: null,
      responseText,
      error: availabilityCheck.reason,
      durationMs: Date.now() - started,
    };
  }

  const bookingTarget = resolveCalendarBookingTarget({
    calendarName,
    defaultCalendarId: cfg.calendarId,
    connectedCalendars: cfg.connectedCalendars,
    adminRefreshToken: cfg.refreshToken,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    teamMembers: cfg.teamMembers,
  });

  if (!bookingTarget) {
    const responseText = JSON.stringify({
      ok: false,
      error: "google_calendar_not_connected",
      message:
        "Nenhuma conta Google disponível para esta agenda. Ligue a conta principal ou convide um membro da equipa.",
    });
    await logGoogleCalendarExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: false,
      durationMs: Date.now() - started,
      requestSummary: { llmArgs: input.llmArgs },
      responseSummary: { preview: responseText },
      errorMessage: "google_calendar_not_connected",
    });
    return {
      ok: false,
      statusCode: null,
      responseText,
      error: "google_calendar_not_connected",
      durationMs: Date.now() - started,
    };
  }

  const calendarId = bookingTarget.calendarId;

  try {
    const accessToken = await refreshGoogleAccessToken({
      clientId: bookingTarget.clientId,
      clientSecret: bookingTarget.clientSecret,
      refreshToken: bookingTarget.refreshToken,
    });
    const created = await createGoogleCalendarEvent({
      accessToken,
      calendarId,
      title,
      start,
      end,
      description,
    });
    const responseText = JSON.stringify({
      ok: true,
      eventId: created.eventId,
      calendarId,
      memberEmail: bookingTarget.memberEmail ?? null,
      htmlLink: created.htmlLink ?? null,
      title,
      start,
      end,
    });
    const durationMs = Date.now() - started;
    await logGoogleCalendarExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: true,
      durationMs,
      requestSummary: { llmArgs: input.llmArgs, calendarId },
      responseSummary: { preview: responseText.slice(0, 8000) },
      errorMessage: null,
    });
    return { ok: true, statusCode: 200, responseText, error: null, durationMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const responseText = JSON.stringify({ ok: false, error: "google_calendar_api_error", message: msg });
    const durationMs = Date.now() - started;
    await logGoogleCalendarExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: false,
      durationMs,
      requestSummary: { llmArgs: input.llmArgs, calendarId },
      responseSummary: { preview: responseText },
      errorMessage: msg.slice(0, 500),
    });
    return { ok: false, statusCode: null, responseText, error: "google_calendar_api_error", durationMs };
  }
}

async function logGoogleCalendarExecution(input: {
  organizationId: string;
  toolId: string;
  botId: string;
  source: string;
  ok: boolean;
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
      statusCode: input.ok ? 200 : null,
      durationMs: input.durationMs,
      requestSummary: asJson(input.requestSummary),
      responseSummary: asJson(input.responseSummary),
      errorMessage: input.errorMessage,
      tokensUsed: null,
      botId: input.botId,
    },
  });
}

export function isAgentExecutableAutomationToolType(toolType: string): boolean {
  const t = toolType.toUpperCase().replace(/-/g, "_");
  return t === "HTTP_API" || t === "WEBHOOK" || t === "GOOGLE_CALENDAR";
}
