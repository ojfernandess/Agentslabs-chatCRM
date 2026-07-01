import type { Prisma } from "@prisma/client";
import {
  mergeIncomingQueueIntoExternalConfig,
  parseIncomingQueue,
  type NvoipIncomingQueueConfig,
} from "./nvoipIncomingQueue.js";
import { parseNvoipPabxMode, type NvoipPabxMode } from "./nvoipPabxConfig.js";

export type NvoipHomologationStored = {
  ranAt: string;
  pass: number;
  fail: number;
  warn: number;
  manual: number;
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function readNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readNvoipExternalConfig(externalConfig: unknown): {
  incomingQueue: ReturnType<typeof parseIncomingQueue>;
  lowBalanceAlertBrl: number | null;
  balanceAlertEmails: string[];
  recordingRetentionDays: number | null;
  lastBalanceAlertEmailAt: string | null;
  homologationLast: NvoipHomologationStored | null;
  pabxMode: NvoipPabxMode;
  trunkSipPasswordConfigured: boolean;
} {
  const c = asRecord(externalConfig);
  const emailsRaw = c.balanceAlertEmails;
  const balanceAlertEmails = Array.isArray(emailsRaw)
    ? emailsRaw
        .filter((e): e is string => typeof e === "string" && e.includes("@"))
        .map((e) => e.trim().toLowerCase())
        .slice(0, 10)
    : [];

  const homRaw = c.homologationLast;
  const homologationLast =
    homRaw != null && typeof homRaw === "object" && !Array.isArray(homRaw)
      ? (homRaw as NvoipHomologationStored)
      : null;

  return {
    incomingQueue: parseIncomingQueue(externalConfig),
    lowBalanceAlertBrl: readNumber(c.lowBalanceAlertBrl),
    balanceAlertEmails,
    recordingRetentionDays: readNumber(c.recordingRetentionDays),
    lastBalanceAlertEmailAt:
      typeof c.lastBalanceAlertEmailAt === "string" ? c.lastBalanceAlertEmailAt : null,
    homologationLast,
    pabxMode: parseNvoipPabxMode(c.pabxMode),
    trunkSipPasswordConfigured: Boolean(
      typeof c.trunkSipPasswordEnc === "string" && c.trunkSipPasswordEnc.trim(),
    ),
  };
}

export function mergeNvoipExternalConfig(
  current: unknown,
  input: {
    incomingQueue?: NvoipIncomingQueueConfig;
    lowBalanceAlertBrl?: number | null;
    balanceAlertEmails?: string[];
    recordingRetentionDays?: number | null;
    homologationLast?: NvoipHomologationStored | null;
    lastBalanceAlertEmailAt?: string | null;
    pabxMode?: NvoipPabxMode;
    trunkSipPasswordEnc?: string | null;
    clearTrunkSipPassword?: boolean;
    callWebhookSecretEnc?: string | null;
    clearCallWebhookSecret?: boolean;
  },
): Prisma.InputJsonValue {
  const base = mergeIncomingQueueIntoExternalConfig(current, input.incomingQueue) as Record<
    string,
    unknown
  >;

  if (input.lowBalanceAlertBrl !== undefined) {
    if (input.lowBalanceAlertBrl == null) delete base.lowBalanceAlertBrl;
    else base.lowBalanceAlertBrl = input.lowBalanceAlertBrl;
  }
  if (input.balanceAlertEmails !== undefined) {
    base.balanceAlertEmails = input.balanceAlertEmails;
  }
  if (input.recordingRetentionDays !== undefined) {
    if (input.recordingRetentionDays == null) delete base.recordingRetentionDays;
    else base.recordingRetentionDays = input.recordingRetentionDays;
  }
  if (input.homologationLast !== undefined) {
    if (input.homologationLast == null) delete base.homologationLast;
    else base.homologationLast = input.homologationLast;
  }
  if (input.lastBalanceAlertEmailAt !== undefined) {
    if (input.lastBalanceAlertEmailAt == null) delete base.lastBalanceAlertEmailAt;
    else base.lastBalanceAlertEmailAt = input.lastBalanceAlertEmailAt;
  }
  if (input.pabxMode !== undefined) {
    base.pabxMode = input.pabxMode;
  }
  if (input.clearTrunkSipPassword) {
    delete base.trunkSipPasswordEnc;
  } else if (input.trunkSipPasswordEnc !== undefined) {
    if (input.trunkSipPasswordEnc == null) delete base.trunkSipPasswordEnc;
    else base.trunkSipPasswordEnc = input.trunkSipPasswordEnc;
  }
  if (input.clearCallWebhookSecret) {
    delete base.callWebhookSecretEnc;
  } else if (input.callWebhookSecretEnc !== undefined) {
    if (input.callWebhookSecretEnc == null) delete base.callWebhookSecretEnc;
    else base.callWebhookSecretEnc = input.callWebhookSecretEnc;
  }

  return base as Prisma.InputJsonValue;
}
