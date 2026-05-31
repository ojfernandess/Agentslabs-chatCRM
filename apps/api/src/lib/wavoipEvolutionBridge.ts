import type { Prisma, WavoipDevice } from "@prisma/client";
import { prisma } from "../db.js";
import { decrypt, encrypt } from "./encryption.js";
import { resolveInboxWhatsappCredentials } from "./inboxWhatsappConfig.js";
import { decryptWavoipSecret } from "./wavoipDeviceConfig.js";
import {
  parseExternalConfig,
  type WavoipBridgeStatusClient,
  bridgeStatusFromExternalConfig,
} from "./wavoipExternalConfig.js";
import { logWavoipIntegration } from "./wavoipIntegrationLog.js";

export type EvolutionBridgeCredentials = {
  evolutionUrl: string;
  evolutionApiKey: string;
  evolutionInstance: string;
  provider: string;
  inboxId: string;
  inboxName: string;
};

export type EvolutionValidationResult = {
  ok: boolean;
  connectionState: string | null;
  message: string;
  instanceReachable: boolean;
};

export type BridgeProvisionStep = {
  id: "sync" | "validate" | "evolution_token" | "wavoip_panel";
  ok: boolean;
  message: string;
};

export type BridgeProvisionResult = {
  ok: boolean;
  steps: BridgeProvisionStep[];
  bridgeStatus: WavoipBridgeStatusClient;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function decryptApiKey(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  return decrypt(stored)?.trim() ?? null;
}

export async function resolveEvolutionBridgeFromInbox(
  organizationId: string,
  inboxId: string,
): Promise<EvolutionBridgeCredentials | { error: string }> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId, channelType: "WHATSAPP" },
    select: { id: true, name: true, channelConfig: true },
  });
  if (!inbox) return { error: "inbox_not_found" };

  const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
  if (!creds) return { error: "inbox_not_configured" };

  if (creds.whatsappProvider !== "evolution" && creds.whatsappProvider !== "evolution_go") {
    return { error: "inbox_not_evolution" };
  }

  const baseUrl = creds.evolutionApiBaseUrl?.trim() ?? "";
  const instance = creds.whatsappPhoneNumberId?.trim() ?? "";
  const apiKey = decryptApiKey(creds.whatsappApiKey);

  if (!baseUrl) return { error: "evolution_url_missing" };
  if (!instance) return { error: "evolution_instance_missing" };
  if (!apiKey) return { error: "evolution_api_key_missing" };

  return {
    evolutionUrl: normalizeBaseUrl(baseUrl),
    evolutionApiKey: apiKey,
    evolutionInstance: instance,
    provider: creds.whatsappProvider,
    inboxId: inbox.id,
    inboxName: inbox.name,
  };
}

export function resolveEvolutionBridgeFromDevice(
  device: Pick<WavoipDevice, "externalConfig">,
): { evolutionUrl: string; evolutionApiKey: string; evolutionInstance: string } | null {
  const cfg = parseExternalConfig(device.externalConfig);
  const url = cfg.evolutionUrl?.trim() ?? "";
  const instance = cfg.evolutionInstance?.trim() ?? "";
  const apiKey = decryptApiKey(cfg.evolutionApiKey);
  if (!url || !instance || !apiKey) return null;
  return {
    evolutionUrl: normalizeBaseUrl(url),
    evolutionApiKey: apiKey,
    evolutionInstance: instance,
  };
}

export async function checkEvolutionInstanceConnection(creds: {
  evolutionUrl: string;
  evolutionApiKey: string;
  evolutionInstance: string;
}): Promise<EvolutionValidationResult> {
  const url = `${creds.evolutionUrl}/instance/connectionState/${encodeURIComponent(creds.evolutionInstance)}`;
  try {
    const res = await fetch(url, {
      headers: { apikey: creds.evolutionApiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        connectionState: null,
        message: `evolution_http_${res.status}`,
        instanceReachable: false,
      };
    }
    const data = (await res.json()) as { instance?: { state?: string }; state?: string };
    const state = (data.instance?.state ?? data.state ?? "").toLowerCase() || null;
    const open = state === "open";
    return {
      ok: open,
      connectionState: state,
      message: open ? "instance_open" : `instance_${state ?? "unknown"}`,
      instanceReachable: true,
    };
  } catch (err) {
    return {
      ok: false,
      connectionState: null,
      message: err instanceof Error ? err.message : "evolution_unreachable",
      instanceReachable: false,
    };
  }
}

/** POST /settings/set/{instance} — Evolution API wavoipToken ([docs](https://docs.evolutionfoundation.com.br/evolution-api/set-settings)). */
export async function setEvolutionWavoipToken(
  creds: { evolutionUrl: string; evolutionApiKey: string; evolutionInstance: string },
  wavoipToken: string,
): Promise<{ ok: boolean; message: string; status?: number }> {
  const url = `${creds.evolutionUrl}/settings/set/${encodeURIComponent(creds.evolutionInstance)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: creds.evolutionApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wavoipToken: wavoipToken.trim() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const lower = text.toLowerCase();
      if (lower.includes("wavoiptoken") && lower.includes("does not exist")) {
        return { ok: false, message: "evolution_wavoip_token_column_missing", status: res.status };
      }
      return { ok: false, message: text.slice(0, 240) || `evolution_http_${res.status}`, status: res.status };
    }
    return { ok: true, message: "wavoip_token_set" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "request_failed" };
  }
}

async function findEvolutionInstanceConflict(
  organizationId: string,
  instance: string,
  excludeDeviceId: string,
): Promise<{ deviceId: string; deviceName: string } | null> {
  const devices = await prisma.wavoipDevice.findMany({
    where: {
      organizationId,
      id: { not: excludeDeviceId },
      connectionMode: "EXTERNAL_EVOLUTION",
    },
    select: { id: true, name: true, externalConfig: true },
  });
  for (const d of devices) {
    const cfg = parseExternalConfig(d.externalConfig);
    if (cfg.evolutionInstance?.trim() === instance.trim()) {
      return { deviceId: d.id, deviceName: d.name };
    }
  }
  return null;
}

function mergeExternalConfigMeta(
  current: unknown,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base = asRecord(current) ?? {};
  return { ...base, ...patch } as Prisma.InputJsonValue;
}

async function persistBridgeCredentials(
  deviceId: string,
  resolved: EvolutionBridgeCredentials,
  currentExternalConfig: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  await prisma.wavoipDevice.update({
    where: { id: deviceId },
    data: {
      externalConfig: mergeExternalConfigMeta(currentExternalConfig, {
        evolutionUrl: resolved.evolutionUrl,
        evolutionApiKey: encrypt(resolved.evolutionApiKey),
        evolutionInstance: resolved.evolutionInstance,
        bridgeSyncedAt: now,
        bridgeSourceInboxId: resolved.inboxId,
      }),
    },
  });
}

export async function syncDeviceBridgeFromInbox(
  deviceId: string,
  organizationId: string,
): Promise<
  | { ok: true; credentials: Omit<EvolutionBridgeCredentials, "evolutionApiKey"> & { hasApiKey: true } }
  | { ok: false; error: string; conflictDeviceName?: string }
> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: deviceId, organizationId },
  });
  if (!device) return { ok: false, error: "device_not_found" };
  if (!device.inboxId) return { ok: false, error: "inbox_not_linked" };

  const resolved = await resolveEvolutionBridgeFromInbox(organizationId, device.inboxId);
  if ("error" in resolved) return { ok: false, error: resolved.error };

  const conflict = await findEvolutionInstanceConflict(
    organizationId,
    resolved.evolutionInstance,
    deviceId,
  );
  if (conflict) {
    return { ok: false, error: "evolution_instance_in_use", conflictDeviceName: conflict.deviceName };
  }

  await persistBridgeCredentials(deviceId, resolved, device.externalConfig);

  await logWavoipIntegration({
    organizationId,
    wavoipDeviceId: deviceId,
    level: "info",
    eventType: "bridge_sync",
    message: `Bridge synced from inbox ${resolved.inboxName}`,
    payload: {
      inboxId: resolved.inboxId,
      evolutionInstance: resolved.evolutionInstance,
      provider: resolved.provider,
    },
  });

  return {
    ok: true,
    credentials: {
      evolutionUrl: resolved.evolutionUrl,
      evolutionInstance: resolved.evolutionInstance,
      provider: resolved.provider,
      inboxId: resolved.inboxId,
      inboxName: resolved.inboxName,
      hasApiKey: true,
    },
  };
}

export async function validateDeviceEvolutionBridge(
  deviceId: string,
  organizationId: string,
): Promise<
  | { ok: false; error: string; validation?: EvolutionValidationResult }
  | { ok: boolean; validation: EvolutionValidationResult; bridgeStatus: WavoipBridgeStatusClient }
> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: deviceId, organizationId },
  });
  if (!device) return { ok: false, error: "device_not_found" };

  const creds = resolveEvolutionBridgeFromDevice(device);
  if (!creds) return { ok: false, error: "bridge_not_configured" };

  const validation = await checkEvolutionInstanceConnection(creds);
  const now = new Date().toISOString();

  await prisma.wavoipDevice.update({
    where: { id: deviceId },
    data: {
      externalConfig: mergeExternalConfigMeta(device.externalConfig, {
        lastValidation: {
          ok: validation.ok,
          connectionState: validation.connectionState,
          message: validation.message,
          at: now,
        },
      }),
    },
  });

  await logWavoipIntegration({
    organizationId,
    wavoipDeviceId: deviceId,
    level: validation.ok ? "info" : "warn",
    eventType: "bridge_validate",
    message: `Evolution validation → ${validation.message}`,
    payload: validation as unknown as Record<string, unknown>,
  });

  const updated = await prisma.wavoipDevice.findUnique({ where: { id: deviceId } });
  return {
    ok: validation.ok,
    validation,
    bridgeStatus: bridgeStatusFromExternalConfig(updated?.externalConfig),
  };
}

export async function provisionDeviceEvolutionBridge(
  deviceId: string,
  organizationId: string,
  options?: { syncFromInbox?: boolean; skipEvolutionToken?: boolean },
): Promise<BridgeProvisionResult | { ok: false; error: string; conflictDeviceName?: string }> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: deviceId, organizationId },
  });
  if (!device) return { ok: false, error: "device_not_found" };

  const wavoipToken = decryptWavoipSecret(device.deviceTokenEnc);
  if (!wavoipToken) return { ok: false, error: "device_token_missing" };

  const steps: BridgeProvisionStep[] = [];

  if (options?.syncFromInbox !== false && device.inboxId) {
    const sync = await syncDeviceBridgeFromInbox(deviceId, organizationId);
    if (!sync.ok) {
      return sync;
    }
    steps.push({ id: "sync", ok: true, message: "synced_from_inbox" });
  } else if (options?.syncFromInbox !== false && !device.inboxId) {
    steps.push({ id: "sync", ok: false, message: "inbox_not_linked" });
  }

  let current = await prisma.wavoipDevice.findUnique({ where: { id: deviceId } });
  if (!current) return { ok: false, error: "device_not_found" };

  let creds = resolveEvolutionBridgeFromDevice(current);
  if (!creds) {
    steps.push({ id: "validate", ok: false, message: "bridge_not_configured" });
    return {
      ok: false,
      steps,
      bridgeStatus: bridgeStatusFromExternalConfig(current.externalConfig),
    };
  }

  const validation = await checkEvolutionInstanceConnection(creds);
  steps.push({
    id: "validate",
    ok: validation.ok,
    message: validation.message,
  });

  const now = new Date().toISOString();
  let externalPatch: Record<string, unknown> = {
    lastValidation: {
      ok: validation.ok,
      connectionState: validation.connectionState,
      message: validation.message,
      at: now,
    },
  };

  if (!options?.skipEvolutionToken) {
    const tokenResult = await setEvolutionWavoipToken(creds, wavoipToken);
    steps.push({
      id: "evolution_token",
      ok: tokenResult.ok,
      message: tokenResult.message,
    });
    if (tokenResult.ok) {
      externalPatch = {
        ...externalPatch,
        evolutionWavoipTokenSetAt: now,
        bridgeProvisionedAt: now,
      };
    }
  }

  steps.push({
    id: "wavoip_panel",
    ok: false,
    message: "wavoip_panel_manual",
  });

  await prisma.wavoipDevice.update({
    where: { id: deviceId },
    data: { externalConfig: mergeExternalConfigMeta(current.externalConfig, externalPatch) },
  });

  current = await prisma.wavoipDevice.findUnique({ where: { id: deviceId } });
  const bridgeStatus = bridgeStatusFromExternalConfig(current?.externalConfig);

  const evolutionTokenStep = steps.find((s) => s.id === "evolution_token");
  const overallOk =
    validation.ok && (options?.skipEvolutionToken || evolutionTokenStep?.ok === true);

  await logWavoipIntegration({
    organizationId,
    wavoipDeviceId: deviceId,
    level: overallOk ? "info" : "warn",
    eventType: "bridge_provision",
    message: overallOk ? "Evolution bridge provisioned" : "Evolution bridge provision incomplete",
    payload: { steps },
  });

  return { ok: overallOk, steps, bridgeStatus };
}

export async function previewDeviceBridgeFromInbox(
  deviceId: string,
  organizationId: string,
): Promise<
  | {
      ok: true;
      preview: Omit<EvolutionBridgeCredentials, "evolutionApiKey"> & { hasApiKey: boolean };
      conflictDeviceName: string | null;
    }
  | { ok: false; error: string }
> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: deviceId, organizationId },
    select: { id: true, inboxId: true },
  });
  if (!device) return { ok: false, error: "device_not_found" };
  if (!device.inboxId) return { ok: false, error: "inbox_not_linked" };

  const resolved = await resolveEvolutionBridgeFromInbox(organizationId, device.inboxId);
  if ("error" in resolved) return { ok: false, error: resolved.error };

  const conflict = await findEvolutionInstanceConflict(
    organizationId,
    resolved.evolutionInstance,
    deviceId,
  );

  return {
    ok: true,
    preview: {
      evolutionUrl: resolved.evolutionUrl,
      evolutionInstance: resolved.evolutionInstance,
      provider: resolved.provider,
      inboxId: resolved.inboxId,
      inboxName: resolved.inboxName,
      hasApiKey: Boolean(resolved.evolutionApiKey),
    },
    conflictDeviceName: conflict?.deviceName ?? null,
  };
}
