import type { Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { decrypt, encrypt } from "./encryption.js";
import { MASKED_WAVOIP_SECRET } from "./wavoipDeviceConfig.js";
import { logWavoipIntegration } from "./wavoipIntegrationLog.js";

export type WavoipIntegrationTarget = {
  url: string;
  secret?: string | null;
  events: string[];
};

export type WavoipOutboundIntegrationsFields = {
  n8n?: WavoipIntegrationTarget | null;
  chatwoot?: WavoipIntegrationTarget | null;
};

export type WavoipOutboundIntegrationsClient = {
  n8n?: { url: string | null; secret?: string | null; events: string[] } | null;
  chatwoot?: { url: string | null; secret?: string | null; events: string[] } | null;
};

const DEFAULT_EVENTS = ["CALL", "RECORD", "DEVICE"] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseTarget(raw: unknown): WavoipIntegrationTarget | null {
  const o = asRecord(raw);
  if (!o) return null;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!url) return null;
  const eventsRaw = Array.isArray(o.events) ? o.events : DEFAULT_EVENTS;
  const events = eventsRaw.filter((e): e is string => typeof e === "string" && e.trim().length > 0);
  return {
    url: url.slice(0, 2048),
    secret: typeof o.secret === "string" ? o.secret : null,
    events: events.length > 0 ? events : [...DEFAULT_EVENTS],
  };
}

export function parseOutboundIntegrations(raw: unknown): WavoipOutboundIntegrationsFields {
  const root = asRecord(raw);
  if (!root) return {};
  return {
    n8n: parseTarget(root.n8n),
    chatwoot: parseTarget(root.chatwoot),
  };
}

export function maskOutboundIntegrationsForClient(raw: unknown): WavoipOutboundIntegrationsClient {
  const parsed = parseOutboundIntegrations(raw);
  const maskTarget = (t: WavoipIntegrationTarget | null | undefined) => {
    if (!t) return null;
    return {
      url: t.url,
      secret: t.secret ? MASKED_WAVOIP_SECRET : null,
      events: t.events,
    };
  };
  return {
    n8n: maskTarget(parsed.n8n),
    chatwoot: maskTarget(parsed.chatwoot),
  };
}

function encryptSecret(value: string | null | undefined, current?: string | null): string | undefined {
  const v = value?.trim() ?? "";
  if (!v || v === MASKED_WAVOIP_SECRET) {
    if (!current) return undefined;
    const stored = decrypt(current) ?? current;
    return stored.includes(":") ? stored : encrypt(stored);
  }
  return encrypt(v);
}

function serializeTarget(
  incoming: WavoipIntegrationTarget | null | undefined,
  current: WavoipIntegrationTarget | null | undefined,
): Record<string, unknown> | undefined {
  if (incoming === undefined) return current ? { url: current.url, secret: current.secret ?? undefined, events: current.events } : undefined;
  if (incoming === null || !incoming.url.trim()) return undefined;

  const next: Record<string, unknown> = {
    url: incoming.url.trim().slice(0, 2048),
    events: incoming.events?.length ? incoming.events : [...DEFAULT_EVENTS],
  };
  const secretEnc = encryptSecret(incoming.secret, current?.secret ?? null);
  if (secretEnc) next.secret = secretEnc;
  return next;
}

export function prepareOutboundIntegrationsForSave(
  incoming: WavoipOutboundIntegrationsFields | undefined,
  currentRaw: unknown,
): Prisma.InputJsonValue | undefined {
  if (incoming === undefined) return undefined;
  const current = parseOutboundIntegrations(currentRaw);
  const next: Record<string, unknown> = {};

  const n8n = serializeTarget(incoming.n8n ?? undefined, current.n8n ?? null);
  if (n8n) next.n8n = n8n;

  const chatwoot = serializeTarget(incoming.chatwoot ?? undefined, current.chatwoot ?? null);
  if (chatwoot) next.chatwoot = chatwoot;

  if (incoming.n8n === null) delete next.n8n;
  if (incoming.chatwoot === null) delete next.chatwoot;

  return next as Prisma.InputJsonValue;
}

function targetEnabled(target: WavoipIntegrationTarget | null | undefined, eventType: string): boolean {
  if (!target?.url) return false;
  if (target.events.length === 0) return true;
  return target.events.map((e) => e.toUpperCase()).includes(eventType.toUpperCase());
}

function signBody(secret: string, body: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenConduit-Wavoip/1.0",
  };
  const trimmed = secret.trim();
  if (!trimmed) return headers;
  const sig = createHmac("sha256", trimmed).update(body).digest("hex");
  headers["X-OpenConduit-Signature"] = `sha256=${sig}`;
  headers["X-OpenConduit-Webhook-Secret"] = trimmed;
  headers.Authorization = `Bearer ${trimmed}`;
  return headers;
}

export function buildChatwootAdapterPayload(input: {
  organizationId: string;
  eventType: "CALL" | "RECORD" | "DEVICE";
  device: { id: string; name: string; linkedPhone: string | null; inboxId: string | null };
  payload: Record<string, unknown>;
  contact?: { id: string; name: string; phone: string | null } | null;
  conversationId?: string | null;
}): Record<string, unknown> {
  const eventName =
    input.eventType === "CALL"
      ? "wavoip.call.updated"
      : input.eventType === "RECORD"
        ? "wavoip.record.ready"
        : "wavoip.device.updated";

  return {
    event: eventName,
    version: "openconduit-v1",
    adapter: "chatwoot",
    account: { id: input.organizationId },
    inbox_id: input.device.inboxId,
    conversation: input.conversationId ? { id: input.conversationId } : null,
    contact: input.contact
      ? {
          id: input.contact.id,
          name: input.contact.name,
          phone_number: input.contact.phone,
        }
      : null,
    wavoip: {
      device_id: input.device.id,
      device_name: input.device.name,
      linked_phone: input.device.linkedPhone,
      event_type: input.eventType,
      ...input.payload,
    },
  };
}

export function buildN8nPayload(input: {
  organizationId: string;
  eventType: "CALL" | "RECORD" | "DEVICE";
  device: { id: string; name: string; linkedPhone: string | null; inboxId: string | null };
  payload: Record<string, unknown>;
  contactId?: string | null;
  conversationId?: string | null;
}): Record<string, unknown> {
  return {
    source: "openconduit",
    module: "wavoip",
    eventType: input.eventType,
    organizationId: input.organizationId,
    device: input.device,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId ?? null,
    payload: input.payload,
    emittedAt: new Date().toISOString(),
  };
}

async function postIntegrationWebhook(
  target: WavoipIntegrationTarget,
  body: Record<string, unknown>,
  adapter: "n8n" | "chatwoot",
): Promise<{ ok: boolean; status?: number; message: string }> {
  const rawBody = JSON.stringify(body);
  const secret = target.secret ? decrypt(target.secret) ?? target.secret : "";
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: signBody(secret, rawBody),
      body: rawBody,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: text.slice(0, 200) || `${adapter}_http_${res.status}` };
    }
    return { ok: true, message: `${adapter}_delivered` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${adapter}_request_failed` };
  }
}

export async function dispatchWavoipOutboundIntegrations(input: {
  organizationId: string;
  device: {
    id: string;
    name: string;
    linkedPhone: string | null;
    inboxId: string | null;
    outboundIntegrations: unknown;
  };
  eventType: "CALL" | "RECORD" | "DEVICE";
  payload: Record<string, unknown>;
  contact?: { id: string; name: string; phone: string | null } | null;
  conversationId?: string | null;
  contactId?: string | null;
}): Promise<void> {
  const integrations = parseOutboundIntegrations(input.device.outboundIntegrations);
  const tasks: Promise<void>[] = [];

  if (targetEnabled(integrations.n8n, input.eventType) && integrations.n8n) {
    tasks.push(
      (async () => {
        const body = buildN8nPayload({
          organizationId: input.organizationId,
          eventType: input.eventType,
          device: input.device,
          payload: input.payload,
          contactId: input.contactId ?? input.contact?.id ?? null,
          conversationId: input.conversationId ?? null,
        });
        const result = await postIntegrationWebhook(integrations.n8n!, body, "n8n");
        await logWavoipIntegration({
          organizationId: input.organizationId,
          wavoipDeviceId: input.device.id,
          level: result.ok ? "info" : "warn",
          eventType: "outbound_n8n",
          message: result.message,
          payload: { eventType: input.eventType, status: result.status },
        });
      })(),
    );
  }

  if (targetEnabled(integrations.chatwoot, input.eventType) && integrations.chatwoot) {
    tasks.push(
      (async () => {
        const body = buildChatwootAdapterPayload({
          organizationId: input.organizationId,
          eventType: input.eventType,
          device: input.device,
          payload: input.payload,
          contact: input.contact ?? null,
          conversationId: input.conversationId ?? null,
        });
        const result = await postIntegrationWebhook(integrations.chatwoot!, body, "chatwoot");
        await logWavoipIntegration({
          organizationId: input.organizationId,
          wavoipDeviceId: input.device.id,
          level: result.ok ? "info" : "warn",
          eventType: "outbound_chatwoot",
          message: result.message,
          payload: { eventType: input.eventType, status: result.status },
        });
      })(),
    );
  }

  await Promise.all(tasks);
}
