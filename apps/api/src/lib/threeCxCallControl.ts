import { decryptThreeCxSecret, normalizePbxBaseUrl } from "./threeCxConfig.js";

type TokenCacheEntry = { token: string; expiresAt: number };

const tokenCache = new Map<string, TokenCacheEntry>();

function cacheKey(pbxBaseUrl: string, clientId: string): string {
  return `${pbxBaseUrl}::${clientId}`;
}

function callControlApiBase(pbxBaseUrl: string): string {
  const base = normalizePbxBaseUrl(pbxBaseUrl);
  return `${base}/callcontrol/api/v1`;
}

/** OAuth2 client credentials — ver documentação XAPI / Call Control 3CX. */
export async function getThreeCxAccessToken(input: {
  pbxBaseUrl: string;
  clientId: string;
  apiKeyEnc: string;
}): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const apiKey = decryptThreeCxSecret(input.apiKeyEnc);
  if (!apiKey) return { ok: false, message: "invalid_api_key" };

  const pbxBaseUrl = normalizePbxBaseUrl(input.pbxBaseUrl);
  const key = cacheKey(pbxBaseUrl, input.clientId);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cached.token };
  }

  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: apiKey,
    grant_type: "client_credentials",
  });

  const tokenUrl = `${pbxBaseUrl}/connect/token`;
  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false, message: "pbx_unreachable" };
  }

  if (!res.ok) {
    return { ok: false, message: `token_http_${res.status}` };
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  const token = json.access_token?.trim();
  if (!token) return { ok: false, message: "token_missing" };

  const expiresInSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
  tokenCache.set(key, {
    token,
    expiresAt: Date.now() + expiresInSec * 1000,
  });
  return { ok: true, token };
}

export async function threeCxCallControlFetch(input: {
  pbxBaseUrl: string;
  clientId: string;
  apiKeyEnc: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}): Promise<{ ok: true; status: number; data: unknown } | { ok: false; message: string; status?: number }> {
  const auth = await getThreeCxAccessToken({
    pbxBaseUrl: input.pbxBaseUrl,
    clientId: input.clientId,
    apiKeyEnc: input.apiKeyEnc,
  });
  if (!auth.ok) return auth;

  const url = `${callControlApiBase(input.pbxBaseUrl)}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;
  const init: RequestInit = {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
    },
  };
  if (input.body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(input.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, message: "callcontrol_unreachable" };
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    return { ok: false, message: `callcontrol_http_${res.status}`, status: res.status };
  }
  return { ok: true, status: res.status, data };
}

export async function testThreeCxConnection(input: {
  pbxBaseUrl: string;
  clientId: string;
  apiKeyEnc: string;
  routePointDn: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const auth = await getThreeCxAccessToken(input);
  if (!auth.ok) return auth;

  const dn = encodeURIComponent(input.routePointDn);
  const res = await threeCxCallControlFetch({
    ...input,
    path: `/callcontrol/${dn}`,
  });
  if (!res.ok) return res;
  return { ok: true };
}

export async function makeThreeCxOutboundCall(input: {
  pbxBaseUrl: string;
  clientId: string;
  apiKeyEnc: string;
  routePointDn: string;
  sourceExtensionDn?: string | null;
  destination: string;
  timeoutSec?: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const destination = input.destination.trim();
  if (!destination) return { ok: false, message: "invalid_destination" };

  const dn = encodeURIComponent(input.routePointDn);
  const timeout = input.timeoutSec ?? 45;
  const body = { destination, timeout, attachedData1: "openconduit" };

  const ext = input.sourceExtensionDn?.trim();
  let path = `/callcontrol/${dn}/makecall`;
  if (ext) {
    const devices = await threeCxCallControlFetch({
      pbxBaseUrl: input.pbxBaseUrl,
      clientId: input.clientId,
      apiKeyEnc: input.apiKeyEnc,
      path: `/callcontrol/${dn}/devices`,
    });
    if (devices.ok && Array.isArray(devices.data)) {
      const match = (devices.data as { dn?: string; device_id?: string }[]).find(
        (d) => d.dn?.trim() === ext,
      );
      if (match?.device_id) {
        path = `/callcontrol/${dn}/devices/${encodeURIComponent(match.device_id)}/makecall`;
      }
    }
  }

  const res = await threeCxCallControlFetch({
    pbxBaseUrl: input.pbxBaseUrl,
    clientId: input.clientId,
    apiKeyEnc: input.apiKeyEnc,
    path,
    method: "POST",
    body,
  });
  if (!res.ok) return res;
  return { ok: true };
}

export type ThreeCxParticipant = {
  id: number;
  status?: string;
  party_caller_id?: string;
  party_caller_name?: string;
  party_dn?: string;
  callid?: number;
};

export async function listThreeCxParticipants(input: {
  pbxBaseUrl: string;
  clientId: string;
  apiKeyEnc: string;
  routePointDn: string;
}): Promise<ThreeCxParticipant[]> {
  const dn = encodeURIComponent(input.routePointDn);
  const res = await threeCxCallControlFetch({
    ...input,
    path: `/callcontrol/${dn}/participants`,
  });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data as ThreeCxParticipant[];
}
