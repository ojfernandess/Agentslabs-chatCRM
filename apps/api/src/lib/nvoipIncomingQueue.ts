import { prisma } from "../db.js";
import {
  mergeIncomingQueueIntoExternalConfig,
  parseIncomingQueue,
  type WavoipIncomingQueueConfig,
} from "./wavoipIncomingQueue.js";
import { readNvoipExternalConfig, mergeNvoipExternalConfig } from "./nvoipExternalConfig.js";

export { mergeIncomingQueueIntoExternalConfig, parseIncomingQueue };
export type { WavoipIncomingQueueConfig as NvoipIncomingQueueConfig };

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function extensionMatchesReceiver(extensionCaller: string, receiver: string): boolean {
  const a = digitsOnly(extensionCaller);
  const b = digitsOnly(receiver);
  if (!a || !b) return false;
  if (a === b) return true;
  const tail = Math.min(8, a.length, b.length);
  return a.slice(-tail) === b.slice(-tail);
}

/** @deprecated Use readNvoipExternalConfig */
export function readNvoipAccountRouting(externalConfig: unknown) {
  const ext = readNvoipExternalConfig(externalConfig);
  return {
    incomingQueue: ext.incomingQueue,
    lowBalanceAlertBrl: ext.lowBalanceAlertBrl,
  };
}

/** @deprecated Use mergeNvoipExternalConfig */
export function mergeNvoipRoutingIntoExternalConfig(
  current: unknown,
  input: {
    incomingQueue?: WavoipIncomingQueueConfig;
    lowBalanceAlertBrl?: number | null;
    balanceAlertEmails?: string[];
    recordingRetentionDays?: number | null;
  },
): Record<string, unknown> {
  return mergeNvoipExternalConfig(current, input) as Record<string, unknown>;
}

/** Ramais mapeados primeiro; depois fila global da conta (modo all/team). */
export async function resolveNvoipIncomingTargetUserIds(
  organizationId: string,
  receiver: string,
  externalConfig: unknown,
): Promise<string[] | null> {
  const receiverDigits = digitsOnly(receiver);
  if (!receiverDigits) return null;

  const extensions = await prisma.nvoipAgentExtension.findMany({
    where: { organizationId },
    select: { userId: true, caller: true },
  });
  const fromExtensions = extensions
    .filter((ext) => extensionMatchesReceiver(ext.caller, receiver))
    .map((ext) => ext.userId);
  if (fromExtensions.length > 0) return fromExtensions;

  const queue = parseIncomingQueue(externalConfig);
  if (queue.mode === "all") return null;

  if (queue.mode === "team" && queue.teamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: queue.teamId, team: { organizationId } },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  return [];
}
