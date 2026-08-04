import crypto from "node:crypto";
import { config, getPublicOrigin } from "../config.js";

export type GoogleCalendarTeamMember = {
  memberId: string;
  email: string;
  displayName?: string;
  refresh_token: string;
  calendar_id: string;
  calendars: Array<{ id: string; name: string }>;
  connectedAt: string;
};

export type GoogleCalendarConnectedEntry = {
  id: string;
  name: string;
  memberId?: string;
  email?: string;
};

export type GoogleCalendarInviteRecord = {
  inviteId: string;
  label?: string;
  createdAt: string;
  expiresAt?: string;
  revoked?: boolean;
};

export type GoogleCalendarInviteToken = {
  organizationId: string;
  toolId: string;
  inviteId: string;
  label?: string;
  exp: number;
};

const DEFAULT_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function signPayload(payload: unknown): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyPayload<T>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function createTeamInviteToken(input: {
  organizationId: string;
  toolId: string;
  inviteId: string;
  label?: string;
  expiresInMs?: number;
}): string {
  const payload: GoogleCalendarInviteToken = {
    organizationId: input.organizationId,
    toolId: input.toolId,
    inviteId: input.inviteId,
    label: input.label?.trim() || undefined,
    exp: Date.now() + (input.expiresInMs ?? DEFAULT_INVITE_TTL_MS),
  };
  return signPayload(payload);
}

export function verifyTeamInviteToken(token: string): GoogleCalendarInviteToken | null {
  const payload = verifyPayload<GoogleCalendarInviteToken>(token);
  if (!payload?.organizationId || !payload.toolId || !payload.inviteId || !payload.exp) return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}

export function googleCalendarTeamInvitePublicUrl(signedToken: string): string {
  return `${getPublicOrigin()}/api/v1/integrations/google-calendar/invite/${encodeURIComponent(signedToken)}`;
}

export function googleCalendarTeamInviteStartUrl(signedToken: string): string {
  return `${googleCalendarTeamInvitePublicUrl(signedToken)}/start`;
}

export function readTeamMembers(cfg: unknown): GoogleCalendarTeamMember[] {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const raw = Array.isArray(c.teamMembers) ? c.teamMembers : [];
  return raw
    .filter((x): x is Record<string, unknown> => x && typeof x === "object")
    .map((x) => ({
      memberId: String(x.memberId ?? "").trim(),
      email: String(x.email ?? "").trim(),
      displayName: typeof x.displayName === "string" ? x.displayName.trim() : undefined,
      refresh_token: String(x.refresh_token ?? "").trim(),
      calendar_id: String(x.calendar_id ?? "primary").trim() || "primary",
      calendars: Array.isArray(x.calendars)
        ? x.calendars
            .filter((cal): cal is Record<string, unknown> => cal && typeof cal === "object")
            .map((cal) => ({
              id: String(cal.id ?? "").trim(),
              name: String(cal.name ?? cal.id ?? "Agenda").trim(),
            }))
            .filter((cal) => cal.id)
        : [],
      connectedAt: String(x.connectedAt ?? "").trim(),
    }))
    .filter((m) => m.memberId && m.email && m.refresh_token);
}

export function readTeamInvites(cfg: unknown): GoogleCalendarInviteRecord[] {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const raw = Array.isArray(c.teamInvites) ? c.teamInvites : [];
  return raw
    .filter((x): x is Record<string, unknown> => x && typeof x === "object")
    .map((x) => ({
      inviteId: String(x.inviteId ?? "").trim(),
      label: typeof x.label === "string" ? x.label.trim() : undefined,
      createdAt: String(x.createdAt ?? "").trim(),
      expiresAt: typeof x.expiresAt === "string" ? x.expiresAt.trim() : undefined,
      revoked: x.revoked === true,
    }))
    .filter((x) => x.inviteId);
}

export function rebuildConnectedCalendars(input: {
  adminEmail?: string;
  adminCalendars: Array<{ id: string; name: string }>;
  teamMembers: GoogleCalendarTeamMember[];
}): GoogleCalendarConnectedEntry[] {
  const out: GoogleCalendarConnectedEntry[] = [];
  const adminEmail = input.adminEmail?.trim();
  for (const cal of input.adminCalendars) {
    out.push({
      id: cal.id,
      name: adminEmail ? `${cal.name} (${adminEmail})` : cal.name,
      memberId: "admin",
      email: adminEmail,
    });
  }
  for (const member of input.teamMembers) {
    const label = member.displayName?.trim() || member.email;
    for (const cal of member.calendars) {
      out.push({
        id: cal.id,
        name: `${cal.name} (${label})`,
        memberId: member.memberId,
        email: member.email,
      });
    }
  }
  return out;
}

export function redactTeamMembersForClient(members: GoogleCalendarTeamMember[]): Array<Omit<GoogleCalendarTeamMember, "refresh_token"> & { hasRefreshToken: boolean }> {
  return members.map(({ refresh_token, ...rest }) => ({
    ...rest,
    hasRefreshToken: Boolean(refresh_token),
  }));
}

export function resolveCalendarBookingTarget(input: {
  calendarName: string | undefined;
  defaultCalendarId: string;
  connectedCalendars: GoogleCalendarConnectedEntry[];
  adminRefreshToken: string;
  clientId: string;
  clientSecret: string;
  teamMembers: GoogleCalendarTeamMember[];
}): {
  calendarId: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  memberEmail?: string;
} | null {
  const name = (input.calendarName ?? "").trim().toLowerCase();
  let entry: GoogleCalendarConnectedEntry | undefined;
  if (name) {
    entry = input.connectedCalendars.find(
      (c) =>
        c.name.trim().toLowerCase() === name ||
        c.id.trim().toLowerCase() === name ||
        (c.email && c.email.toLowerCase() === name),
    );
  }
  if (!entry && input.defaultCalendarId) {
    entry = input.connectedCalendars.find((c) => c.id === input.defaultCalendarId);
  }
  const calendarId = entry?.id ?? input.defaultCalendarId ?? "primary";
  const memberId = entry?.memberId ?? "admin";

  if (memberId === "admin") {
    if (!input.adminRefreshToken) return null;
    return {
      calendarId,
      refreshToken: input.adminRefreshToken,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      memberEmail: entry?.email,
    };
  }

  const member = input.teamMembers.find((m) => m.memberId === memberId);
  if (!member?.refresh_token) return null;
  return {
    calendarId,
    refreshToken: member.refresh_token,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    memberEmail: member.email,
  };
}
