import { randomBytes } from "node:crypto";
import type { WavoipConnectionMode, WavoipDevice, WavoipDeviceStatus } from "@prisma/client";
import { encrypt, decrypt } from "./encryption.js";
import { maskExternalConfigForClient, type WavoipBridgeStatusClient, bridgeStatusFromExternalConfig } from "./wavoipExternalConfig.js";
import { maskOutboundIntegrationsForClient } from "./wavoipOutboundIntegrations.js";

export const MASKED_WAVOIP_SECRET = "••••••••";

export const DEFAULT_WAVOIP_WEBHOOK_EVENTS = ["CALL", "RECORD", "DEVICE"] as const;

export type WavoipDeviceClientRow = {
  id: string;
  name: string;
  connectionMode: WavoipConnectionMode;
  status: WavoipDeviceStatus;
  linkedPhone: string | null;
  webhookEnabled: boolean;
  webhookEvents: string[];
  webhookUrl: string;
  sipEnabled: boolean;
  externalConfig: {
    evolutionUrl?: string | null;
    evolutionApiKey?: string | null;
    evolutionInstance?: string | null;
  };
  bridgeStatus: WavoipBridgeStatusClient;
  outboundIntegrations: import("./wavoipOutboundIntegrations.js").WavoipOutboundIntegrationsClient;
  inboxId: string | null;
  inboxName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  lastStatusAt: string | null;
  lastError: string | null;
  hasDeviceToken: boolean;
  qrImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export function generateWavoipWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

export function encryptWavoipSecret(value: string): string {
  return encrypt(value.trim());
}

export function decryptWavoipSecret(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  return decrypt(stored);
}

export function maskDeviceTokenForClient(_hasToken: boolean): string {
  return MASKED_WAVOIP_SECRET;
}

export function wavoipQrImageUrl(deviceToken: string): string {
  const token = deviceToken.trim();
  return `https://devices.wavoip.com/${token}/whatsapp/qr-image`;
}

/** Map Wavoip webhook DEVICE status strings to Prisma enum. */
export function mapWavoipWebhookDeviceStatus(raw: string | undefined | null): WavoipDeviceStatus {
  const s = (raw ?? "").trim().toLowerCase();
  switch (s) {
    case "building":
      return "BUILDING";
    case "connecting":
      return "CONNECTING";
    case "open":
    case "connected":
      return "OPEN";
    case "close":
    case "disconnected":
      return "CLOSE";
    case "restarting":
      return "RESTARTING";
    case "hibernating":
      return "HIBERNATING";
    case "waiting_payment":
      return "WAITING_PAYMENT";
    case "error":
    case "external_integration_error":
      return s.includes("external") ? "EXTERNAL_INTEGRATION_ERROR" : "ERROR";
    case "no_status":
    default:
      return "DISCONNECTED";
  }
}

export function wavoipStatusLabelKey(status: WavoipDeviceStatus): string {
  return `wavoip.status.${status}`;
}

export function parseWebhookEventsJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  return [...DEFAULT_WAVOIP_WEBHOOK_EVENTS];
}

export function deviceToClientRow(
  device: WavoipDevice & {
    inbox?: { name: string } | null;
    assignedUser?: { name: string } | null;
  },
  webhookUrl: string,
  includeQrUrl: boolean,
): WavoipDeviceClientRow {
  const token = decryptWavoipSecret(device.deviceTokenEnc);
  return {
    id: device.id,
    name: device.name,
    connectionMode: device.connectionMode,
    status: device.status,
    linkedPhone: device.linkedPhone,
    webhookEnabled: device.webhookEnabled,
    webhookEvents: parseWebhookEventsJson(device.webhookEvents),
    webhookUrl,
    sipEnabled: device.sipEnabled,
    externalConfig: maskExternalConfigForClient(device.externalConfig),
    bridgeStatus: bridgeStatusFromExternalConfig(device.externalConfig),
    outboundIntegrations: maskOutboundIntegrationsForClient(device.outboundIntegrations),
    inboxId: device.inboxId,
    inboxName: device.inbox?.name ?? null,
    assignedUserId: device.assignedUserId,
    assignedUserName: device.assignedUser?.name ?? null,
    lastStatusAt: device.lastStatusAt?.toISOString() ?? null,
    lastError: device.lastError,
    hasDeviceToken: Boolean(token),
    qrImageUrl:
      includeQrUrl && token && device.connectionMode === "QR_NATIVE"
        ? wavoipQrImageUrl(token)
        : null,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}

export function prepareDeviceTokenForSave(
  incoming: string | undefined,
  currentEncrypted: string | null,
): { tokenEnc: string; changed: boolean } {
  const trimmed = incoming?.trim() ?? "";
  if (!trimmed || trimmed === MASKED_WAVOIP_SECRET) {
    if (!currentEncrypted) throw new Error("device_token_required");
    return { tokenEnc: currentEncrypted, changed: false };
  }
  return { tokenEnc: encryptWavoipSecret(trimmed), changed: true };
}
