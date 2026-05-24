function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

const EVOLUTION_GO_FETCH_TIMEOUT_MS = 12_000;

async function evolutionGoFetchJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVOLUTION_GO_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

function parseStatusPayload(json: unknown): { connected: boolean; loggedIn: boolean; name: string } | null {
  const root = asRecord(json);
  const data = asRecord(root?.data) ?? root;
  if (!data) return null;
  const connected = data.Connected === true || data.connected === true;
  const loggedIn = data.LoggedIn === true || data.loggedIn === true;
  const name =
    typeof data.Name === "string"
      ? data.Name.trim()
      : typeof data.name === "string"
        ? data.name.trim()
        : "";
  return { connected, loggedIn, name };
}

export type EvolutionGoInstanceInfo = {
  id: string;
  name: string;
  connected: boolean;
  token?: string;
};

export type EvolutionGoCreatedInstance = {
  id: string;
  name: string;
  token: string;
};

export async function evolutionGoFetchAllInstances(options: {
  baseUrl: string;
  apiKey: string;
}): Promise<EvolutionGoInstanceInfo[] | null> {
  const base = normalizeBaseUrl(options.baseUrl);
  const { ok, json } = await evolutionGoFetchJson(`${base}/instance/all`, {
    headers: {
      apikey: options.apiKey,
    },
  });
  if (!ok) return null;
  const root = asRecord(json);
  const data = root?.data ?? root?.instances;
  if (!Array.isArray(data)) return null;
  const out: EvolutionGoInstanceInfo[] = [];
  for (const row of data) {
    const r = asRecord(row);
    if (!r) continue;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const connected = r.connected === true;
    const token = typeof r.token === "string" ? r.token.trim() : undefined;
    if (!id || !name) continue;
    out.push({ id, name, connected, ...(token ? { token } : {}) });
  }
  return out;
}

export async function evolutionGoLookupInstanceByRef(options: {
  baseUrl: string;
  apiKey: string;
  instanceRef: string;
}): Promise<EvolutionGoInstanceInfo | null> {
  const ref = options.instanceRef.trim();
  if (!ref) return null;
  const list = await evolutionGoFetchAllInstances({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });
  if (!list) return null;
  return list.find((x) => x.id === ref || x.name === ref) ?? null;
}

export async function evolutionGoCreateInstance(options: {
  baseUrl: string;
  apiKey: string;
  name: string;
  token: string;
}): Promise<EvolutionGoCreatedInstance | null> {
  const base = normalizeBaseUrl(options.baseUrl);
  const { ok, json } = await evolutionGoFetchJson(`${base}/instance/create`, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      token: options.token,
    }),
  });
  if (!ok) return null;
  const root = asRecord(json);
  const data = asRecord(root?.data);
  const id = typeof data?.id === "string" ? data.id.trim() : "";
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  const token = typeof data?.token === "string" ? data.token.trim() : "";
  if (!id || !name || !token) return null;
  return { id, name, token };
}

export type EvolutionGoOpResult = {
  ok: boolean;
  status: number;
  hint?: string;
};

export const EVOLUTION_GO_WEBHOOK_SUBSCRIBE = [
  "ALL",
  "MESSAGE",
  "READ_RECEIPT",
  "CONNECTION",
  "QRCODE",
  "GROUP",
  "CALL",
] as const;

function evolutionGoUpstreamHint(status: number, json: unknown): string | undefined {
  const root = asRecord(json);
  const err = asRecord(root?.error);
  const msg =
    (typeof err?.message === "string" ? err.message : null) ??
    (typeof root?.message === "string" ? root.message : null);
  if (msg) return msg;
  if (status === 401) return "Invalid API key or instance token";
  if (status === 404) return "Instance not found on Evolution Go server";
  if (status === 0) return "Evolution Go server unreachable";
  return undefined;
}

export async function evolutionGoGetQr(options: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ qrDataUrl: string; code: string } | null> {
  const base = normalizeBaseUrl(options.baseUrl);
  const attempts = [`${base}/instance/qr`, `${base}/instance/qrcode`];
  for (const url of attempts) {
    const { ok, json } = await evolutionGoFetchJson(url, {
      headers: { apikey: options.apiKey },
    });
    if (!ok) continue;
    const root = asRecord(json);
    const data = asRecord(root?.data);
    const qrDataUrl =
      typeof data?.Qrcode === "string"
        ? data.Qrcode.trim()
        : typeof data?.qrcode === "string"
          ? data.qrcode.trim()
          : "";
    const code =
      typeof data?.Code === "string" ? data.Code.trim() : typeof data?.code === "string" ? data.code.trim() : "";
    if (qrDataUrl || code) return { qrDataUrl, code };
  }
  return null;
}

export async function evolutionGoGetStatus(options: {
  baseUrl: string;
  apiKey: string;
  instanceId?: string;
  instanceRef?: string;
}): Promise<{ connected: boolean; loggedIn: boolean; name: string } | null> {
  const base = normalizeBaseUrl(options.baseUrl);
  const ref = (options.instanceRef ?? options.instanceId)?.trim();

  type Attempt = { url: string; headers: Record<string, string> };
  const attempts: Attempt[] = [];

  const push = (url: string, headers: Record<string, string>) => {
    if (!attempts.some((a) => a.url === url && JSON.stringify(a.headers) === JSON.stringify(headers))) {
      attempts.push({ url, headers });
    }
  };

  // Instance token: Evolution Go identifies the instance via apikey header only.
  push(`${base}/instance/status`, { apikey: options.apiKey });

  if (ref) {
    push(`${base}/instance/status`, { apikey: options.apiKey, instanceId: ref });
    push(`${base}/instance/${encodeURIComponent(ref)}/status`, { apikey: options.apiKey });
  }

  for (const attempt of attempts) {
    const { ok, json } = await evolutionGoFetchJson(attempt.url, { headers: attempt.headers });
    if (!ok) continue;
    const parsed = parseStatusPayload(json);
    if (parsed) return parsed;
  }

  return null;
}

export async function evolutionGoRequestPairingCode(options: {
  baseUrl: string;
  apiKey: string;
  phone: string;
  subscribe?: string[];
}): Promise<string | null> {
  const base = normalizeBaseUrl(options.baseUrl);
  const { ok, json } = await evolutionGoFetchJson(`${base}/instance/pair`, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone: options.phone,
      subscribe: options.subscribe ?? [...EVOLUTION_GO_WEBHOOK_SUBSCRIBE],
    }),
  });
  if (!ok) return null;
  const root = asRecord(json);
  const data = asRecord(root?.data);
  const code =
    typeof data?.PairingCode === "string"
      ? data.PairingCode.trim()
      : typeof data?.pairingCode === "string"
        ? data.pairingCode.trim()
        : "";
  return code || null;
}

export async function evolutionGoConnectInstance(options: {
  baseUrl: string;
  apiKey: string;
  webhookUrl: string;
  subscribe?: string[];
  immediate?: boolean;
  phone?: string;
}): Promise<EvolutionGoOpResult> {
  const base = normalizeBaseUrl(options.baseUrl);
  const body = {
    webhookUrl: options.webhookUrl,
    subscribe: options.subscribe ?? [...EVOLUTION_GO_WEBHOOK_SUBSCRIBE],
    immediate: options.immediate ?? true,
    rabbitmqEnabled: "disabled",
    websocketEnable: "disabled",
    natsEnabled: "disabled",
    ...(options.phone ? { phone: options.phone } : {}),
  };
  const { ok, status, json } = await evolutionGoFetchJson(`${base}/instance/connect`, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    ok,
    status,
    hint: ok ? undefined : evolutionGoUpstreamHint(status, json),
  };
}
