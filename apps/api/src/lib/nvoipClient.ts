import type { NvoipAccount } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { decryptNvoipSecret, encryptNvoipSecret } from "./nvoipConfig.js";

export type NvoipTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
};

export type NvoipCallState =
  | "calling_origin"
  | "calling_destination"
  | "established"
  | "noanswer"
  | "busy"
  | "finished"
  | "failed"
  | string;

export type NvoipCallStatusPayload = {
  state: NvoipCallState;
  linkAudio?: string | null;
  talkingDurationSeconds?: number | null;
  totalDurationSeconds?: string | number | null;
  caller?: string | null;
};

function apiUrl(path: string): string {
  const base = config.nvoipApiBaseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`nvoip_invalid_json: ${text.slice(0, 200)}`);
  }
}

export async function nvoipPasswordGrant(
  numbersip: string,
  userToken: string,
): Promise<NvoipTokenResponse> {
  const body = new URLSearchParams({
    username: numbersip.trim(),
    password: userToken.trim(),
    grant_type: "password",
  });
  const res = await fetch(apiUrl("/oauth/token"), {
    method: "POST",
    headers: {
      Authorization: `Basic ${config.nvoipOAuthBasic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await parseJson<NvoipTokenResponse & { error?: string; error_description?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error_description ?? data.error ?? `oauth_failed_${res.status}`);
  }
  if (!data.access_token) throw new Error("nvoip_missing_access_token");
  return data;
}

export async function nvoipRefreshGrant(refreshToken: string): Promise<NvoipTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken.trim(),
  });
  const res = await fetch(apiUrl("/oauth/token"), {
    method: "POST",
    headers: {
      Authorization: `Basic ${config.nvoipOAuthBasic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await parseJson<NvoipTokenResponse & { error?: string; error_description?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error_description ?? data.error ?? `refresh_failed_${res.status}`);
  }
  if (!data.access_token) throw new Error("nvoip_missing_access_token");
  return data;
}

async function persistTokens(accountId: string, tokens: NvoipTokenResponse) {
  const expiresIn = Number(tokens.expires_in) || 86_400;
  const tokenExpiresAt = new Date(Date.now() + Math.max(60, expiresIn - 120) * 1000);
  await prisma.nvoipAccount.update({
    where: { id: accountId },
    data: {
      accessTokenEnc: encryptNvoipSecret(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encryptNvoipSecret(tokens.refresh_token)
        : undefined,
      tokenExpiresAt,
    },
  });
}

export async function getNvoipAccessToken(account: NvoipAccount): Promise<string> {
  const now = Date.now();
  if (
    account.accessTokenEnc &&
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() > now + 30_000
  ) {
    const existing = decryptNvoipSecret(account.accessTokenEnc);
    if (existing) return existing;
  }

  const refresh = decryptNvoipSecret(account.refreshTokenEnc);
  let tokens: NvoipTokenResponse;
  if (refresh) {
    try {
      tokens = await nvoipRefreshGrant(refresh);
    } catch {
      const userToken = decryptNvoipSecret(account.userTokenEnc);
      if (!userToken) throw new Error("nvoip_credentials_missing");
      tokens = await nvoipPasswordGrant(account.numbersip, userToken);
    }
  } else {
    const userToken = decryptNvoipSecret(account.userTokenEnc);
    if (!userToken) throw new Error("nvoip_credentials_missing");
    tokens = await nvoipPasswordGrant(account.numbersip, userToken);
  }

  await persistTokens(account.id, tokens);
  return tokens.access_token;
}

async function fetchWithRateLimitBackoff(url: string, init: RequestInit, maxAttempts = 4): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    last = res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(1500 * 2 ** attempt, 12_000);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last!;
}

export async function nvoipAuthorizedFetch(
  account: NvoipAccount,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await getNvoipAccessToken(account);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetchWithRateLimitBackoff(apiUrl(path), { ...init, headers });
}

export async function nvoipGetBalance(account: NvoipAccount): Promise<{ balance: string }> {
  const res = await nvoipAuthorizedFetch(account, "/balance", { method: "GET" });
  const data = await parseJson<{ balance?: string; error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? `balance_failed_${res.status}`);
  return { balance: String(data.balance ?? "0") };
}

export async function nvoipCreateCall(
  account: NvoipAccount,
  caller: string,
  called: string,
): Promise<{ callId: string; state: string }> {
  const res = await nvoipAuthorizedFetch(account, "/calls/", {
    method: "POST",
    body: JSON.stringify({ caller: caller.trim(), called: called.trim() }),
  });
  const data = await parseJson<{ state?: string; callId?: string; error?: string }>(res);
  if (!res.ok || !data.callId) {
    throw new Error(data.error ?? `create_call_failed_${res.status}`);
  }
  return { callId: data.callId, state: data.state ?? "success" };
}

export async function nvoipGetCallStatus(
  account: NvoipAccount,
  callId: string,
): Promise<NvoipCallStatusPayload> {
  const res = await nvoipAuthorizedFetch(
    account,
    `/calls?callId=${encodeURIComponent(callId)}`,
    { method: "GET" },
  );
  const data = await parseJson<NvoipCallStatusPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? `call_status_failed_${res.status}`);
  return data;
}

export type NvoipHistoryDate = "today" | "yesterday";
export type NvoipHistoryType = "inbound" | "outbound";

export type NvoipHistoryCallItem = {
  callId: string;
  caller: string;
  called: string;
  state: string;
  linkAudio: string | null;
  talkingDurationSeconds: number | null;
  totalDurationSeconds: number | null;
  raw: Record<string, unknown>;
};

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = obj[key];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseHistoryCallItem(raw: unknown): NvoipHistoryCallItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const callId = pickString(obj, ["callId", "call_id", "id"]);
  if (!callId) return null;
  const caller = pickString(obj, ["caller", "origin", "from"]);
  const called = pickString(obj, ["called", "destination", "to"]);
  const state = pickString(obj, ["state", "status"]) || "finished";
  const linkAudio = pickString(obj, ["linkAudio", "link_audio", "audio", "recordUrl"]) || null;
  return {
    callId,
    caller,
    called,
    state,
    linkAudio,
    talkingDurationSeconds: pickNumber(obj, [
      "talkingDurationSeconds",
      "talking_duration_seconds",
      "duration",
    ]),
    totalDurationSeconds: pickNumber(obj, ["totalDurationSeconds", "total_duration_seconds"]),
    raw: obj,
  };
}

function normalizeHistoryList(data: unknown): NvoipHistoryCallItem[] {
  if (Array.isArray(data)) {
    return data.map(parseHistoryCallItem).filter((x): x is NvoipHistoryCallItem => x != null);
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["calls", "data", "history", "items", "result", "records"]) {
      const nested = obj[key];
      if (Array.isArray(nested)) {
        return nested.map(parseHistoryCallItem).filter((x): x is NvoipHistoryCallItem => x != null);
      }
    }
  }
  return [];
}

export async function nvoipGetCallHistory(
  account: NvoipAccount,
  type: NvoipHistoryType,
  date: NvoipHistoryDate,
): Promise<NvoipHistoryCallItem[]> {
  const qs = new URLSearchParams({ type, date });
  const res = await nvoipAuthorizedFetch(account, `/calls/history?${qs.toString()}`, {
    method: "GET",
  });
  const data = await parseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `call_history_failed_${res.status}`);
  }
  return normalizeHistoryList(data);
}

export async function nvoipEndCall(account: NvoipAccount, callId: string): Promise<void> {
  const res = await nvoipAuthorizedFetch(
    account,
    `/endcall?callId=${encodeURIComponent(callId)}`,
    { method: "GET" },
  );
  if (!res.ok) {
    const data = await parseJson<{ error?: string }>(res);
    throw new Error(data.error ?? `end_call_failed_${res.status}`);
  }
}

export function mapNvoipStateToCrmStatus(state: string): string {
  const s = state.toLowerCase();
  if (s === "established") return "ACTIVE";
  if (s === "calling_origin") return "CALLING_ORIGIN";
  if (s === "calling_destination") return "CALLING_DESTINATION";
  if (s === "finished") return "ENDED";
  if (s === "noanswer") return "NOT_ANSWERED";
  if (s === "busy") return "BUSY";
  if (s === "failed") return "FAILED";
  return state.toUpperCase();
}

export function isNvoipTerminalState(state: string): boolean {
  const s = state.toLowerCase();
  return ["finished", "noanswer", "busy", "failed"].includes(s);
}

export type NvoipTorpedoAudio = { text?: string; audio?: string; type?: string };
export type NvoipTorpedoDtmf = { digit: string; url?: string; text?: string; audio?: string; label?: string };

function buildTorpedoBody(input: {
  caller: string;
  called: string | string[];
  audios: NvoipTorpedoAudio[];
  dtmfs?: NvoipTorpedoDtmf[];
  sched?: string;
}): Record<string, unknown> {
  const called = Array.isArray(input.called) ? input.called : [input.called];
  const body: Record<string, unknown> = {
    caller: input.caller.trim(),
    called,
    audios: input.audios,
  };
  if (input.dtmfs?.length) body.dtmfs = input.dtmfs;
  if (input.sched) body.sched = input.sched;
  return body;
}

function extractSchedkey(data: Record<string, unknown>): string | undefined {
  const key = data.schedkey ?? data.schedKey ?? data.key;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

export async function nvoipSendVoiceTorpedo(
  account: NvoipAccount,
  input: {
    caller: string;
    called: string | string[];
    audios: NvoipTorpedoAudio[];
    dtmfs?: NvoipTorpedoDtmf[];
  },
): Promise<{ schedkey?: string; raw: Record<string, unknown> }> {
  const body = buildTorpedoBody(input);
  const res = await nvoipAuthorizedFetch(account, "/torpedo/voice", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : `torpedo_failed_${res.status}`,
    );
  }
  return { schedkey: extractSchedkey(data), raw: data };
}

export async function nvoipScheduleVoiceTorpedo(
  account: NvoipAccount,
  input: {
    caller: string;
    called: string | string[];
    audios: NvoipTorpedoAudio[];
    dtmfs?: NvoipTorpedoDtmf[];
    scheduledAt: Date;
  },
): Promise<{ schedkey: string; raw: Record<string, unknown> }> {
  const sched = input.scheduledAt.toISOString().replace("T", " ").slice(0, 19);
  const body = buildTorpedoBody({ ...input, sched });
  const res = await nvoipAuthorizedFetch(account, "/sched/torpedo", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : `sched_torpedo_failed_${res.status}`,
    );
  }
  const schedkey = extractSchedkey(data);
  if (!schedkey) throw new Error("nvoip_missing_schedkey");
  return { schedkey, raw: data };
}

export async function nvoipListScheduledTorpedos(
  account: NvoipAccount,
): Promise<Record<string, unknown>[]> {
  const res = await nvoipAuthorizedFetch(account, "/list/sched/torpedo", { method: "GET" });
  const data = await parseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `list_sched_torpedo_${res.status}`);
  }
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["data", "items", "result", "torpedos"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

export async function nvoipDeleteScheduledTorpedo(
  account: NvoipAccount,
  schedkey: string,
): Promise<void> {
  const res = await nvoipAuthorizedFetch(
    account,
    `/delete/sched/torpedo?schedkey=${encodeURIComponent(schedkey)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const data = await parseJson<{ error?: string }>(res);
    throw new Error(data.error ?? `delete_sched_torpedo_${res.status}`);
  }
}

export type NvoipSipUserItem = {
  numbersip: string;
  name: string;
  caller: string;
  blocked: boolean;
  webphone: boolean | null;
  raw: Record<string, unknown>;
};

export type NvoipDidItem = {
  number: string;
  destination: string | null;
  label: string | null;
  raw: Record<string, unknown>;
};

function pickBool(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1 || v === "1") return true;
    if (v === "false" || v === 0 || v === "0") return false;
  }
  return false;
}

function parseSipUser(raw: unknown): NvoipSipUserItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const numbersip = pickString(obj, ["numbersip", "numberSip", "number_sip", "username", "user"]);
  if (!numbersip) return null;
  const caller = pickString(obj, ["caller", "ramal", "extension", "sip", "dn", "callerid"]);
  const name = pickString(obj, ["name", "nome", "displayName", "display_name"]);
  return {
    numbersip,
    name,
    caller,
    blocked: pickBool(obj, ["blocked", "block", "isBlocked"]),
    webphone: (() => {
      for (const key of ["webphone", "webPhone", "web_phone"]) {
        const v = obj[key];
        if (typeof v === "boolean") return v;
        if (v === "true" || v === 1 || v === "1") return true;
        if (v === "false" || v === 0 || v === "0") return false;
      }
      return null;
    })(),
    raw: obj,
  };
}

function normalizeSipUserList(data: unknown): NvoipSipUserItem[] {
  if (Array.isArray(data)) {
    return data.map(parseSipUser).filter((x): x is NvoipSipUserItem => x != null);
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["users", "data", "items", "result", "list"]) {
      const nested = obj[key];
      if (Array.isArray(nested)) {
        return nested.map(parseSipUser).filter((x): x is NvoipSipUserItem => x != null);
      }
    }
  }
  return [];
}

function parseDidItem(raw: unknown): NvoipDidItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const number = pickString(obj, ["number", "did", "phone", "numero", "virtualNumber"]);
  if (!number) return null;
  const destination =
    pickString(obj, ["destination", "dest", "destino", "ura", "forward", "target"]) || null;
  const label = pickString(obj, ["label", "name", "nome", "description"]) || null;
  return { number, destination, label, raw: obj };
}

function normalizeDidList(data: unknown): NvoipDidItem[] {
  if (Array.isArray(data)) {
    return data.map(parseDidItem).filter((x): x is NvoipDidItem => x != null);
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["dids", "data", "items", "result", "list", "numbers"]) {
      const nested = obj[key];
      if (Array.isArray(nested)) {
        return nested.map(parseDidItem).filter((x): x is NvoipDidItem => x != null);
      }
    }
  }
  return [];
}

export async function nvoipListUsers(account: NvoipAccount): Promise<NvoipSipUserItem[]> {
  const res = await nvoipAuthorizedFetch(account, "/list/users", { method: "GET" });
  const data = await parseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `list_users_failed_${res.status}`);
  }
  return normalizeSipUserList(data);
}

export async function nvoipCreateSipUser(
  account: NvoipAccount,
  input: { name: string; caller: string; sipPassword?: string; webphone?: boolean },
): Promise<Record<string, unknown>> {
  const res = await nvoipAuthorizedFetch(account, "/users", {
    method: "POST",
    body: JSON.stringify({
      name: input.name.trim(),
      caller: input.caller.trim(),
      ...(input.sipPassword ? { sipPassword: input.sipPassword } : {}),
      ...(input.webphone != null ? { webphone: input.webphone } : {}),
    }),
  });
  const data = await parseJson<Record<string, unknown>>(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `create_user_failed_${res.status}`,
    );
  }
  return data;
}

export async function nvoipUpdateSipUser(
  account: NvoipAccount,
  input: {
    numbersip: string;
    name?: string;
    blocked?: boolean;
    webphone?: boolean;
    sipPassword?: string;
  },
): Promise<Record<string, unknown>> {
  const res = await nvoipAuthorizedFetch(account, "/update/users", {
    method: "PUT",
    body: JSON.stringify({
      numbersip: input.numbersip.trim(),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.blocked !== undefined ? { blocked: input.blocked } : {}),
      ...(input.webphone !== undefined ? { webphone: input.webphone } : {}),
      ...(input.sipPassword ? { sipPassword: input.sipPassword } : {}),
    }),
  });
  const data = await parseJson<Record<string, unknown>>(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `update_user_failed_${res.status}`,
    );
  }
  return data;
}

export async function nvoipUpdateDid(
  account: NvoipAccount,
  input: { number: string; destination: string },
): Promise<Record<string, unknown>> {
  const res = await nvoipAuthorizedFetch(account, "/update/dids", {
    method: "PUT",
    body: JSON.stringify({
      number: input.number.trim(),
      destination: input.destination.trim(),
    }),
  });
  const data = await parseJson<Record<string, unknown>>(res);
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `update_did_failed_${res.status}`,
    );
  }
  return data;
}

export async function nvoipListDids(account: NvoipAccount): Promise<NvoipDidItem[]> {
  const res = await nvoipAuthorizedFetch(account, "/list/dids", { method: "GET" });
  const data = await parseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `list_dids_failed_${res.status}`);
  }
  return normalizeDidList(data);
}

export type NvoipOtpChannel = "sms" | "voice" | "email";

function extractOtpKey(data: Record<string, unknown>): string {
  const key = data.key ?? data.otpKey ?? data.otp_key;
  if (typeof key === "string" && key.trim()) return key.trim();
  throw new Error("nvoip_missing_otp_key");
}

function extract2faToken(data: Record<string, unknown>): string {
  const token = data.token2fa ?? data.token ?? data.token_2fa;
  if (typeof token === "string" && token.trim()) return token.trim();
  throw new Error("nvoip_missing_2fa_token");
}

export async function nvoipSendSms(
  account: NvoipAccount,
  input: { phone: string; message: string; flashSms?: boolean },
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    numberPhone: input.phone,
    phone: input.phone,
    called: input.phone,
    destination: input.phone,
    message: input.message,
    flashSms: input.flashSms ?? false,
  };
  const res = await nvoipAuthorizedFetch(account, "/sms", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : `sms_failed_${res.status}`,
    );
  }
  return data;
}

export async function nvoipSendOtp(
  account: NvoipAccount,
  input: { destination: string; channel: NvoipOtpChannel },
): Promise<{ key: string; raw: Record<string, unknown> }> {
  const body = {
    destination: input.destination,
    type: input.channel,
    channel: input.channel,
  };
  const res = await nvoipAuthorizedFetch(account, "/otp", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : `otp_send_failed_${res.status}`,
    );
  }
  return { key: extractOtpKey(data), raw: data };
}

export async function nvoipCheckOtp(
  account: NvoipAccount,
  input: { code: string; key: string },
): Promise<{ ok: boolean; raw: Record<string, unknown> }> {
  const qs = new URLSearchParams({
    code: input.code.trim(),
    key: input.key.trim(),
  });
  const res = await nvoipAuthorizedFetch(account, `/check/otp?${qs.toString()}`, {
    method: "GET",
  });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    return { ok: false, raw: data };
  }
  const state = String(data.state ?? data.status ?? data.valid ?? data.ok ?? "").toLowerCase();
  const ok =
    state === "true" ||
    state === "ok" ||
    state === "success" ||
    state === "valid" ||
    data.valid === true ||
    data.ok === true;
  return { ok, raw: data };
}

export async function nvoipSend2fa(
  account: NvoipAccount,
): Promise<{ token2fa: string; raw: Record<string, unknown> }> {
  const res = await nvoipAuthorizedFetch(account, "/2fa", { method: "POST", body: "{}" });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : `2fa_send_failed_${res.status}`,
    );
  }
  return { token2fa: extract2faToken(data), raw: data };
}

export async function nvoipCheck2fa(
  account: NvoipAccount,
  input: { token2fa: string; pin: string },
): Promise<{ ok: boolean; raw: Record<string, unknown> }> {
  const qs = new URLSearchParams({
    token2fa: input.token2fa.trim(),
    pin: input.pin.trim(),
  });
  const res = await nvoipAuthorizedFetch(account, `/check/2fa?${qs.toString()}`, {
    method: "GET",
  });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    return { ok: false, raw: data };
  }
  const state = String(data.state ?? data.status ?? data.valid ?? "").toLowerCase();
  const ok =
    state === "true" ||
    state === "ok" ||
    state === "success" ||
    state === "valid" ||
    data.valid === true;
  return { ok, raw: data };
}

export type NvoipWaTemplateItem = {
  id: string;
  name: string;
  language: string | null;
  category: string | null;
  body: string | null;
  variableCount: number;
  raw: Record<string, unknown>;
};

function countTemplateVariables(body: string | null): number {
  if (!body) return 0;
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g);
  return matches?.length ?? 0;
}

function parseWaTemplateItem(raw: unknown): NvoipWaTemplateItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = pickString(obj, [
    "idTemplate",
    "id",
    "templateId",
    "template_id",
    "id_template",
  ]);
  if (!id) return null;
  const name = pickString(obj, ["name", "templateName", "template_name", "title"]) || id;
  const language = pickString(obj, ["language", "lang", "locale"]) || null;
  const category = pickString(obj, ["category", "metaCategory", "type"]) || null;
  const body =
    pickString(obj, ["body", "text", "message", "content", "template"]) || null;
  return {
    id,
    name,
    language,
    category,
    body,
    variableCount: countTemplateVariables(body),
    raw: obj,
  };
}

function normalizeWaTemplateList(data: unknown): NvoipWaTemplateItem[] {
  if (Array.isArray(data)) {
    return data.map(parseWaTemplateItem).filter((x): x is NvoipWaTemplateItem => x != null);
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["templates", "data", "items", "result", "list"]) {
      const nested = obj[key];
      if (Array.isArray(nested)) {
        return nested.map(parseWaTemplateItem).filter((x): x is NvoipWaTemplateItem => x != null);
      }
    }
  }
  return [];
}

export async function nvoipListWaTemplates(account: NvoipAccount): Promise<NvoipWaTemplateItem[]> {
  const res = await nvoipAuthorizedFetch(account, "/wa/listTemplates", { method: "GET" });
  const data = await parseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `wa_list_templates_failed_${res.status}`);
  }
  return normalizeWaTemplateList(data);
}

export async function nvoipSendWaTemplate(
  account: NvoipAccount,
  input: {
    idTemplate: string;
    destination: string;
    instance: string;
    language: string;
    functions?: string[];
  },
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    idTemplate: input.idTemplate,
    destination: input.destination,
    instance: input.instance,
    language: input.language,
    functions: input.functions ?? [],
  };
  const res = await nvoipAuthorizedFetch(account, "/wa/sendTemplates", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await parseJson<Record<string, unknown>>(res)) ?? {};
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : `wa_send_template_failed_${res.status}`,
    );
  }
  return data;
}

export type NvoipRateItem = {
  label: string;
  value: string;
  unit: string | null;
  raw: Record<string, unknown>;
};

export type NvoipUraSummary = {
  audios: number;
  menus: number;
  schedules: number;
  queues: number;
  users: number;
  raw: Record<string, unknown>;
};

function countNestedItems(data: unknown, keys: string[]): number {
  if (!data || typeof data !== "object") return 0;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const nested = obj[key];
    if (Array.isArray(nested)) return nested.length;
  }
  return 0;
}

export function summarizeUraPayload(data: unknown): NvoipUraSummary {
  const raw =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { payload: data };
  return {
    audios: countNestedItems(raw, ["audios", "audio", "sounds", "prompts"]),
    menus: countNestedItems(raw, ["menus", "menu", "ivr"]),
    schedules: countNestedItems(raw, ["horarios", "schedules", "schedule", "hours"]),
    queues: countNestedItems(raw, ["filas", "queues", "queue"]),
    users: countNestedItems(raw, ["usuarios", "users", "user"]),
    raw,
  };
}

function parseRateItem(raw: unknown): NvoipRateItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label =
    pickString(obj, ["label", "name", "description", "tipo", "type", "destino"]) || "rate";
  const value = pickString(obj, ["value", "price", "rate", "valor", "cost", "tarifa"]) || "0";
  const unit = pickString(obj, ["unit", "unidade", "per"]) || null;
  return { label, value, unit, raw: obj };
}

function normalizeRateList(data: unknown): NvoipRateItem[] {
  if (Array.isArray(data)) {
    return data.map(parseRateItem).filter((x): x is NvoipRateItem => x != null);
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["rates", "data", "items", "result", "tarifas", "list"]) {
      const nested = obj[key];
      if (Array.isArray(nested)) {
        return nested.map(parseRateItem).filter((x): x is NvoipRateItem => x != null);
      }
    }
  }
  return [];
}

async function nvoipFetchWithNapikey(
  account: NvoipAccount,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const napikey = decryptNvoipSecret(account.napikeyEnc);
  if (!napikey) throw new Error("napikey_missing");
  const sep = path.includes("?") ? "&" : "?";
  const url = `${path}${sep}numbersip=${encodeURIComponent(account.numbersip)}&napikey=${encodeURIComponent(napikey)}`;
  return fetch(apiUrl(url), { ...init, headers: init.headers ?? {} });
}

async function nvoipFetchPreferOAuth(
  account: NvoipAccount,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    const res = await nvoipAuthorizedFetch(account, path, init);
    if (res.ok) return res;
  } catch {
    /* try napikey */
  }
  return nvoipFetchWithNapikey(account, path, init);
}

export async function nvoipListUra(account: NvoipAccount): Promise<NvoipUraSummary> {
  let res = await nvoipFetchWithNapikey(account, "/ura/list", { method: "GET" }).catch(() => null);
  if (!res?.ok) {
    res = await nvoipAuthorizedFetch(account, "/ura/list", { method: "GET" });
  }
  const data = await parseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `ura_list_failed_${res.status}`);
  }
  return summarizeUraPayload(data);
}

export async function nvoipListRates(account: NvoipAccount): Promise<NvoipRateItem[]> {
  const res = await nvoipFetchPreferOAuth(account, "/list/rates", { method: "GET" });
  const data = await parseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err?.error ?? `list_rates_failed_${res.status}`);
  }
  return normalizeRateList(data);
}

export async function testNvoipConnection(input: {
  numbersip: string;
  userToken: string;
}): Promise<{ ok: true; balance: string } | { ok: false; message: string }> {
  try {
    const tokens = await nvoipPasswordGrant(input.numbersip, input.userToken);
    const res = await fetch(apiUrl("/balance"), {
      method: "GET",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const data = await parseJson<{ balance?: string }>(res);
    if (!res.ok) return { ok: false, message: `balance_${res.status}` };
    return { ok: true, balance: String(data.balance ?? "0") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "connection_failed" };
  }
}
