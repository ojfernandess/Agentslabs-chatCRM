import crypto from "node:crypto";
import { config, googleCalendarOAuthCallbackUrl } from "../config.js";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export type GoogleOAuthState = {
  organizationId: string;
  toolId: string;
  exp: number;
};

const STATE_TTL_MS = 15 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function createGoogleOAuthState(input: { organizationId: string; toolId: string }): string {
  const payload: GoogleOAuthState = {
    organizationId: input.organizationId,
    toolId: input.toolId,
    exp: Date.now() + STATE_TTL_MS,
  };
  return signGoogleOAuthState(payload);
}

export function signGoogleOAuthState(payload: GoogleOAuthState): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyGoogleOAuthState(state: string): GoogleOAuthState | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as GoogleOAuthState;
    if (!payload.organizationId || !payload.toolId || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildGoogleOAuthAuthorizeUrl(input: { clientId: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId.trim());
  url.searchParams.set("redirect_uri", googleCalendarOAuthCallbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function postGoogleToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as GoogleTokenResponse;
  if (!res.ok) {
    const msg = json.error_description ?? json.error ?? "token_request_failed";
    throw new Error(msg);
  }
  if (!json.access_token) throw new Error("missing_access_token");
  return json;
}

export async function exchangeGoogleOAuthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    code: input.code.trim(),
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
    redirect_uri: googleCalendarOAuthCallbackUrl(),
    grant_type: "authorization_code",
  });
  const json = await postGoogleToken(body);
  return { accessToken: json.access_token!, refreshToken: json.refresh_token };
}

export async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
    refresh_token: input.refreshToken.trim(),
    grant_type: "refresh_token",
  });
  const json = await postGoogleToken(body);
  return json.access_token!;
}

export type GoogleCalendarListItem = { id: string; name: string; primary?: boolean };

export async function fetchGoogleCalendarList(accessToken: string): Promise<GoogleCalendarListItem[]> {
  const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  url.searchParams.set("minAccessRole", "writer");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as { items?: Array<{ id?: string; summary?: string; primary?: boolean }>; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? "calendar_list_failed");
  }
  return (json.items ?? [])
    .filter((item) => typeof item.id === "string" && item.id.trim())
    .map((item) => ({
      id: item.id!.trim(),
      name: (item.summary ?? item.id ?? "Agenda").trim(),
      primary: item.primary === true,
    }));
}
