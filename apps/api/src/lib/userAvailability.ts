import type { UserAvailabilityStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { broadcastUserAvailabilityChanged } from "./workspaceHub.js";

export type AvailabilityClient = "online" | "away" | "offline";

export function availabilityToClient(status: UserAvailabilityStatus): AvailabilityClient {
  switch (status) {
    case "AWAY":
      return "away";
    case "OFFLINE":
      return "offline";
    default:
      return "online";
  }
}

export function availabilityFromClient(value: string): UserAvailabilityStatus | null {
  switch (value) {
    case "online":
      return "ONLINE";
    case "away":
      return "AWAY";
    case "offline":
      return "OFFLINE";
    default:
      return null;
  }
}

export function isOnlineForTransfer(status: UserAvailabilityStatus): boolean {
  return status === "ONLINE";
}

/** Estado visual efectivo: intent (availability) + presença activa (heartbeat). */
export function resolveEffectiveAvailability(
  status: UserAvailabilityStatus,
  presenceConnected: boolean,
): AvailabilityClient {
  if (status === "AWAY") return "away";
  if (status === "OFFLINE") return "offline";
  return presenceConnected ? "online" : "offline";
}

/** Ao assumir conversa ou enviar mensagem ao cliente, passa ausente/offline → online. */
export async function promoteUserToOnlineIfInactive(
  userId: string,
  organizationId: string,
): Promise<AvailabilityClient> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { availabilityStatus: true },
  });
  if (!user) return "offline";
  if (user.availabilityStatus === "ONLINE") return "online";

  await prisma.user.update({
    where: { id: userId },
    data: { availabilityStatus: "ONLINE", availabilityUpdatedAt: new Date() },
  });
  broadcastUserAvailabilityChanged(organizationId, userId, "online");
  return "online";
}
