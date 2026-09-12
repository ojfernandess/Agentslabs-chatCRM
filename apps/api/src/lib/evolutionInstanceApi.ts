import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

export function normalizeEvolutionBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Stable readable instance name per organization (Evolution instance name). */
export function evolutionInstanceNameForOrg(organizationId: string): string {
  const hex = organizationId.replace(/-/g, "").slice(0, 28);
  return `oc-${hex}`;
}

export function evolutionInstanceNameWithSuffix(base: string): string {
  return `${base}-${randomBytes(2).toString("hex")}`;
}

const DEFAULT_WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONTACTS_UPDATE",
  "CONNECTION_UPDATE",
] as const;

export type EvolutionRemoteInstance = {
  name: string;
  state?: string;
};

async function evolutionApiPostJson(
  url: string,
  apiKey: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

function parseEvolutionRemoteInstances(json: unknown): EvolutionRemoteInstance[] {
  const out: EvolutionRemoteInstance[] = [];
  const seen = new Set<string>();

  const push = (name: unknown, state?: unknown) => {
    if (typeof name !== "string" || !name.trim()) return;
    const n = name.trim();
    if (seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    out.push({
      name: n,
      state: typeof state === "string" ? state : undefined,
    });
  };

  const parseItem = (item: unknown) => {
    const r = asRecord(item);
    if (!r) return;
    const inst = asRecord(r.instance) ?? r;
    push(
      inst.instanceName ?? inst.name ?? r.instanceName ?? r.name,
      inst.status ?? inst.state ?? r.status ?? r.state,
    );
  };

  if (Array.isArray(json)) {
    for (const item of json) parseItem(item);
    return out;
  }

  const root = asRecord(json);
  if (!root) return out;
  const arr = root.instance ?? root.instances ?? root.data;
  if (Array.isArray(arr)) {
    for (const item of arr) parseItem(item);
  } else {
    parseItem(root);
  }
  return out;
}

/** GET /instance/fetchInstances — lista instâncias remotas (Evolution API v2). */
export async function evolutionApiFetchInstances(
  baseUrl: string,
  apiKey: string,
): Promise<EvolutionRemoteInstance[]> {
  const base = normalizeEvolutionBaseUrl(baseUrl);
  for (const path of ["/instance/fetchInstances", "/instance/fetch"]) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { apikey: apiKey },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const parsed = parseEvolutionRemoteInstances(json);
      if (parsed.length > 0) return parsed;
    } catch {
      /* try next path */
    }
  }
  return [];
}

/** Resolve o nome real da instância no servidor Evolution (pode diferir do Settings). */
export async function evolutionApiResolveInstanceName(
  baseUrl: string,
  apiKey: string,
  preferredName: string,
  organizationId?: string,
): Promise<{ name: string; corrected: boolean }> {
  const preferred = preferredName.trim();
  if (preferred) {
    const st = await evolutionApiFetchConnectionState(baseUrl, apiKey, preferred);
    if (st !== null) return { name: preferred, corrected: false };
  }

  const instances = await evolutionApiFetchInstances(baseUrl, apiKey);
  if (instances.length === 0) {
    return { name: preferred, corrected: false };
  }

  const exact = instances.find((i) => i.name.toLowerCase() === preferred.toLowerCase());
  if (exact) return { name: exact.name, corrected: exact.name !== preferred };

  if (organizationId) {
    const prefix = evolutionInstanceNameForOrg(organizationId);
    const scoped = instances.filter((i) => i.name.startsWith(prefix));
    if (scoped.length === 1) {
      return { name: scoped[0].name, corrected: scoped[0].name !== preferred };
    }
    const openScoped = scoped.find((i) => i.state?.toLowerCase() === "open");
    if (openScoped) {
      return { name: openScoped.name, corrected: openScoped.name !== preferred };
    }
  }

  const openAny = instances.find((i) => i.state?.toLowerCase() === "open");
  if (openAny) {
    return { name: openAny.name, corrected: openAny.name !== preferred };
  }

  if (instances.length === 1) {
    return { name: instances[0].name, corrected: instances[0].name !== preferred };
  }

  return { name: preferred, corrected: false };
}

export async function evolutionApiCreateInstance(options: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
  webhookHeaders?: Record<string, string>;
}): Promise<{ ok: true; raw: unknown } | { ok: false; status: number; body: string }> {
  const base = normalizeEvolutionBaseUrl(options.baseUrl);
  const webhook: Record<string, unknown> = {
    enabled: true,
    url: options.webhookUrl,
    base64: true,
    byEvents: false,
    events: [...DEFAULT_WEBHOOK_EVENTS],
  };
  if (options.webhookHeaders && Object.keys(options.webhookHeaders).length > 0) {
    webhook.headers = options.webhookHeaders;
  }
  const res = await fetch(`${base}/instance/create`, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instanceName: options.instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  let raw: unknown = body;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    raw = { raw: body };
  }
  return { ok: true, raw };
}

/**
 * Garante webhook na instância (algumas versões da Evolution ignoram o objeto `webhook` em `/instance/create`).
 * POST /webhook/set/{instance} — Evolution API v2.
 */
export async function evolutionApiSetWebhook(options: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
  webhookHeaders?: Record<string, string>;
}): Promise<
  | { ok: true; attempt: string }
  | { ok: false; status: number; body: string; attempts: string[] }
> {
  const base = normalizeEvolutionBaseUrl(options.baseUrl);
  const enc = encodeURIComponent(options.instanceName);
  const events = [...DEFAULT_WEBHOOK_EVENTS];
  const headers = options.webhookHeaders;

  type Attempt = { label: string; url: string; body: unknown };
  const attempts: Attempt[] = [
    {
      label: "v2-flat",
      url: `${base}/webhook/set/${enc}`,
      body: {
        enabled: true,
        url: options.webhookUrl,
        webhookByEvents: false,
        webhookBase64: true,
        events,
        ...(headers ? { headers } : {}),
      },
    },
    {
      label: "v2-wrapped",
      url: `${base}/webhook/set/${enc}`,
      body: {
        webhook: {
          enabled: true,
          url: options.webhookUrl,
          byEvents: false,
          base64: true,
          events,
          ...(headers ? { headers } : {}),
        },
      },
    },
    {
      label: "v2-snake",
      url: `${base}/webhook/set/${enc}`,
      body: {
        enabled: true,
        url: options.webhookUrl,
        webhook_by_events: false,
        webhook_base64: true,
        events,
        ...(headers ? { headers } : {}),
      },
    },
    {
      label: "foundation-webhook-instance",
      url: `${base}/webhook/instance`,
      body: {
        instanceName: options.instanceName,
        instance: options.instanceName,
        enabled: true,
        url: options.webhookUrl,
        webhook_by_events: false,
        webhookByEvents: false,
        events,
        ...(headers ? { headers } : {}),
      },
    },
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    const res = await evolutionApiPostJson(attempt.url, options.apiKey, attempt.body);
    if (res.ok) return { ok: true, attempt: attempt.label };
    errors.push(`${attempt.label} HTTP ${res.status}: ${res.body.slice(0, 160)}`);
    if (res.status === 401 || res.status === 403) break;
  }

  const last = errors[errors.length - 1] ?? "unknown";
  const statusMatch = last.match(/HTTP (\d{3})/);
  return {
    ok: false,
    status: statusMatch ? Number(statusMatch[1]) : 502,
    body: errors.join(" | "),
    attempts: errors,
  };
}

/** GET /webhook/find/{instance} — estado remoto do webhook na Evolution API v2. */
export async function evolutionApiFindWebhook(options: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}): Promise<{ url: string | null; enabled: boolean; events: string[] } | null> {
  const base = normalizeEvolutionBaseUrl(options.baseUrl);
  const enc = encodeURIComponent(options.instanceName);
  try {
    const res = await fetch(`${base}/webhook/find/${enc}`, {
      headers: { apikey: options.apiKey },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const root = asRecord(data) ?? {};
    const nested = asRecord(root.webhook) ?? asRecord(root.data) ?? root;
    const url =
      typeof nested.url === "string" && nested.url.trim()
        ? nested.url.trim()
        : typeof nested.webhook === "string" && nested.webhook.trim()
          ? nested.webhook.trim()
          : null;
    const enabled = nested.enabled === true || nested.webhookEnabled === true;
    const eventsRaw = nested.events;
    const events = Array.isArray(eventsRaw)
      ? eventsRaw.filter((e): e is string => typeof e === "string")
      : [];
    return { url, enabled, events };
  } catch {
    return null;
  }
}

export async function evolutionApiFetchConnect(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
): Promise<{ ok: true; raw: unknown } | { ok: false; status: number; body: string }> {
  const base = normalizeEvolutionBaseUrl(baseUrl);
  const enc = encodeURIComponent(instanceName);
  const res = await fetch(`${base}/instance/connect/${enc}`, {
    headers: { apikey: apiKey },
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  try {
    return { ok: true, raw: JSON.parse(body) as unknown };
  } catch {
    return { ok: true, raw: { raw: body } };
  }
}

export async function evolutionApiFetchConnectionState(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
): Promise<{ state: string } | null> {
  const base = normalizeEvolutionBaseUrl(baseUrl);
  const enc = encodeURIComponent(instanceName);
  const res = await fetch(`${base}/instance/connectionState/${enc}`, {
    headers: { apikey: apiKey },
  });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as {
      instance?: { state?: string };
      state?: string;
    };
    const state = String(data.instance?.state ?? data.state ?? "").trim();
    return { state };
  } catch {
    return null;
  }
}

/**
 * Build a displayable QR image and optional pairing code from Evolution `/instance/connect` JSON.
 */
export async function evolutionConnectJsonToQrPayload(json: unknown): Promise<{
  pairingCode: string | null;
  qrDataUrl: string | null;
}> {
  const rec = asRecord(json);
  const pairingCode =
    rec && typeof rec.pairingCode === "string" && rec.pairingCode.trim()
      ? rec.pairingCode.trim()
      : null;
  const code = rec && typeof rec.code === "string" && rec.code.trim() ? rec.code.trim() : null;
  const qR = asRecord(rec?.qrcode);
  const nestedB64 =
    qR && typeof qR.base64 === "string" && qR.base64.trim() ? qR.base64.trim() : null;
  const topB64 = rec && typeof rec.base64 === "string" && rec.base64.trim() ? rec.base64.trim() : null;
  const base64 = nestedB64 ?? topB64;

  if (base64) {
    const qrDataUrl = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
    return { pairingCode, qrDataUrl };
  }

  if (code) {
    try {
      const qrDataUrl = await QRCode.toDataURL(code, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      return { pairingCode, qrDataUrl };
    } catch {
      return { pairingCode, qrDataUrl: null };
    }
  }

  return { pairingCode, qrDataUrl: null };
}
