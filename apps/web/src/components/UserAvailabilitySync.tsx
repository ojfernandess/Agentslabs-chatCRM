import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  applyServerAvailability,
  readLocalAvailability,
  syncAvailabilityToServer,
} from "@/lib/userAvailability";

/** Sincroniza disponibilidade local ↔ servidor após login. */
export function UserAvailabilitySync() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (user.availabilityStatus) {
      applyServerAvailability(user.availabilityStatus);
      return;
    }
    void syncAvailabilityToServer(readLocalAvailability());
  }, [user?.id, user?.availabilityStatus]);

  return null;
}
