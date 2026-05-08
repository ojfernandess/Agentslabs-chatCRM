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

export async function evolutionApiCreateInstance(options: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
  webhookHeaders?: Record<string, string>;
}): Promise<{ ok: true; raw: unknown } | { ok: false; status: number; body: string }> {
  const base = normalizeEvolutionBaseUrl(options.baseUrl);
  const webhook: Record<string, unknown> = {
    url: options.webhookUrl,
    base64: true,
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
}): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const base = normalizeEvolutionBaseUrl(options.baseUrl);
  const enc = encodeURIComponent(options.instanceName);
  const payload: Record<string, unknown> = {
    enabled: true,
    url: options.webhookUrl,
    webhookByEvents: false,
    webhookBase64: true,
    events: [...DEFAULT_WEBHOOK_EVENTS],
  };
  if (options.webhookHeaders && Object.keys(options.webhookHeaders).length > 0) {
    payload.headers = options.webhookHeaders;
  }
  const res = await fetch(`${base}/webhook/set/${enc}`, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  return { ok: true };
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
