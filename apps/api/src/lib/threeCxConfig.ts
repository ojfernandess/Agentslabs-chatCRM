import { randomBytes } from "node:crypto";
import type { ThreeCxRoutePoint, ThreeCxRouteStatus } from "@prisma/client";
import { encrypt, decrypt } from "./encryption.js";
import { parseIncomingQueue } from "./wavoipIncomingQueue.js";
import { threeCxCrmBaseUrl } from "../config.js";

export const MASKED_THREECX_SECRET = "••••••••";

export type ThreeCxRoutePointClientRow = {
  id: string;
  name: string;
  pbxBaseUrl: string;
  clientId: string;
  routePointDn: string;
  sourceExtensionDn: string | null;
  status: ThreeCxRouteStatus;
  crmBaseUrl: string;
  incomingQueue: {
    mode: "all" | "assignee" | "team";
    teamId: string | null;
    teamName: string | null;
  };
  inboxId: string | null;
  inboxName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  monitoredDns: string[];
  lastStatusAt: string | null;
  lastError: string | null;
  hasApiKey: boolean;
  hasCrmApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

export function generateThreeCxCrmApiKey(): string {
  return randomBytes(24).toString("hex");
}

export function encryptThreeCxSecret(value: string): string {
  return encrypt(value.trim());
}

export function decryptThreeCxSecret(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  return decrypt(stored);
}

export function normalizePbxBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function parseMonitoredDns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0)
    .slice(0, 32);
}

export function routePointToClientRow(
  row: ThreeCxRoutePoint & {
    inbox?: { name: string } | null;
    assignedUser?: { name: string } | null;
  },
  organizationId: string,
  teamName?: string | null,
): ThreeCxRoutePointClientRow {
  const queue = parseIncomingQueue(row.externalConfig);
  return {
    id: row.id,
    name: row.name,
    pbxBaseUrl: row.pbxBaseUrl,
    clientId: row.clientId,
    routePointDn: row.routePointDn,
    sourceExtensionDn: row.sourceExtensionDn,
    status: row.status,
    crmBaseUrl: threeCxCrmBaseUrl(organizationId, row.id),
    incomingQueue: {
      mode: queue.mode,
      teamId: queue.teamId,
      teamName: teamName ?? null,
    },
    inboxId: row.inboxId,
    inboxName: row.inbox?.name ?? null,
    assignedUserId: row.assignedUserId,
    assignedUserName: row.assignedUser?.name ?? null,
    monitoredDns: parseMonitoredDns(row.monitoredDns),
    lastStatusAt: row.lastStatusAt?.toISOString() ?? null,
    lastError: row.lastError,
    hasApiKey: Boolean(row.apiKeyEnc),
    hasCrmApiKey: Boolean(row.crmApiKeyEnc),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
