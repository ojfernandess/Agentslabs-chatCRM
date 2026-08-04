import crypto from "node:crypto";
import { config, googleCalendarOAuthCallbackUrl } from "../config.js";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
/** Necessário para obter e-mail/nome no callback (userinfo). */
export const GOOGLE_OAUTH_USER_SCOPES = "openid email profile";
export const GOOGLE_OAUTH_SCOPES = `${GOOGLE_OAUTH_USER_SCOPES} ${GOOGLE_CALENDAR_SCOPE}`;

export type GoogleOAuthState = {
  organizationId: string;
  toolId: string;
  exp: number;
  mode?: "admin" | "team_invite";
  inviteId?: string;
};

const STATE_TTL_MS = 15 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function createGoogleOAuthState(input: {
  organizationId: string;
  toolId: string;
  mode?: "admin" | "team_invite";
  inviteId?: string;
}): string {
  const payload: GoogleOAuthState = {
    organizationId: input.organizationId,
    toolId: input.toolId,
    exp: Date.now() + STATE_TTL_MS,
    mode: input.mode,
    inviteId: input.inviteId,
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

export function buildGoogleOAuthAuthorizeUrl(input: {
  clientId: string;
  state: string;
  /** Força o seletor de contas Google (útil quando já há sessão activa no browser). */
  selectAccount?: boolean;
  loginHint?: string;
  /** Primeira ligação — garante refresh_token (consent). */
  forceConsent?: boolean;
}): string {
  const clientId = input.clientId.trim();
  if (!clientId) {
    throw new Error("missing_client_id");
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleCalendarOAuthCallbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
  url.searchParams.set("access_type", "offline");
  const prompt =
    input.forceConsent === true
      ? "consent"
      : input.selectAccount === false
        ? "consent"
        : "select_account consent";
  url.searchParams.set("prompt", prompt);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  if (input.loginHint?.trim()) url.searchParams.set("login_hint", input.loginHint.trim());
  return url.toString();
}

/** Mensagens legíveis para erros comuns do Google OAuth. */
export function humanizeGoogleOAuthError(raw: string): string {
  const msg = raw.trim();
  const lower = msg.toLowerCase();
  if (lower.includes("client_secret") || lower.includes("invalid_client")) {
    return "OAuth client inválido: verifique client_id e client_secret no Google Cloud Console e guarde-os na ferramenta antes de ligar.";
  }
  if (lower.includes("redirect_uri") || lower.includes("redirect uri")) {
    return `redirect_uri não autorizado. Registe exactamente esta URL no Google Console: ${googleCalendarOAuthCallbackUrl()}`;
  }
  if (lower.includes("missing_refresh_token") || lower.includes("refresh_token")) {
    return "Google não devolveu refresh_token. Revogue o acesso em https://myaccount.google.com/permissions e ligue novamente escolhendo a conta.";
  }
  if (lower.includes("access_denied")) {
    return "Acesso negado. Confirme que a app OAuth está em modo Testing com o seu e-mail como test user, ou publique a app.";
  }
  if (lower.includes("required") && lower.includes("oauth")) {
    return "Configuração OAuth 2.0 incompleta no Google Cloud Console (client Web, redirect URI e Calendar API activa).";
  }
  return msg;
}

export type GoogleUserInfo = { email: string; name?: string; picture?: string };

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as { email?: string; name?: string; picture?: string; error?: { message?: string } };
  if (!res.ok || !json.email?.trim()) {
    throw new Error(json.error?.message ?? "userinfo_failed");
  }
  return { email: json.email.trim(), name: json.name?.trim(), picture: json.picture?.trim() };
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
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!clientId) throw new Error("missing_client_id");
  if (!clientSecret) throw new Error("missing_client_secret");
  const body = new URLSearchParams({
    code: input.code.trim(),
    client_id: clientId,
    client_secret: clientSecret,
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
