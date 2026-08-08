import type { UserAvailabilityStatus } from "@prisma/client";

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
