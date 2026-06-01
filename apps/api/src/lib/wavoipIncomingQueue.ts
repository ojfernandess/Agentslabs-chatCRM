import type { WavoipDevice } from "@prisma/client";
import { prisma } from "../db.js";

export type IncomingQueueMode = "all" | "assignee" | "team";

export type WavoipIncomingQueueConfig = {
  mode: IncomingQueueMode;
  teamId: string | null;
};

export type WavoipDeviceQueueContext = Pick<WavoipDevice, "assignedUserId" | "externalConfig">;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseIncomingQueue(raw: unknown): WavoipIncomingQueueConfig {
  const c = asRecord(raw);
  const modeRaw = typeof c?.incomingQueueMode === "string" ? c.incomingQueueMode : "all";
  const mode: IncomingQueueMode =
    modeRaw === "assignee" || modeRaw === "team" ? modeRaw : "all";
  const teamId = typeof c?.incomingQueueTeamId === "string" ? c.incomingQueueTeamId : null;
  return { mode, teamId };
}

export function mergeIncomingQueueIntoExternalConfig(
  current: unknown,
  incoming: WavoipIncomingQueueConfig | undefined,
): Record<string, unknown> {
  const base = { ...(asRecord(current) ?? {}) };
  if (!incoming) return base;
  base.incomingQueueMode = incoming.mode;
  base.incomingQueueTeamId = incoming.teamId;
  return base;
}

export async function agentCanUseWavoipDevice(userId: string, device: WavoipDeviceQueueContext): Promise<boolean> {
  if (device.assignedUserId && device.assignedUserId !== userId) {
    return false;
  }

  const queue = parseIncomingQueue(device.externalConfig);
  if (queue.mode === "all") return true;

  if (queue.mode === "assignee") {
    return device.assignedUserId === userId;
  }

  if (queue.mode === "team") {
    if (!queue.teamId) return true;
    const member = await prisma.teamMember.findFirst({
      where: { userId, teamId: queue.teamId },
      select: { id: true },
    });
    return !!member;
  }

  return true;
}

export async function filterWavoipDevicesForAgent<T extends WavoipDeviceQueueContext>(
  userId: string,
  devices: T[],
): Promise<T[]> {
  const results: T[] = [];
  for (const device of devices) {
    if (await agentCanUseWavoipDevice(userId, device)) {
      results.push(device);
    }
  }
  return results;
}

export async function resolveIncomingCallTargetUserIds(
  device: WavoipDeviceQueueContext,
  organizationId: string,
): Promise<string[] | null> {
  const queue = parseIncomingQueue(device.externalConfig);

  if (queue.mode === "all") {
    return null;
  }

  if (queue.mode === "assignee") {
    return device.assignedUserId ? [device.assignedUserId] : [];
  }

  if (queue.mode === "team" && queue.teamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: queue.teamId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  return null;
}
