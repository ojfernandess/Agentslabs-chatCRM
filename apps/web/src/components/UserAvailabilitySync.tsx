import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  applyServerAvailability,
  hasLocalAvailabilityPreference,
  readLocalAvailability,
  syncAvailabilityToServer,
} from "@/lib/userAvailability";

/**
 * Sincroniza disponibilidade local ↔ servidor após login.
 * Primeiro acesso (sem preferência local): aplica o estado do servidor.
 * Dispositivo com preferência local diferente do servidor: envia local → servidor
 * (evita que o default ONLINE no banco ignore offline escolhido pelo atendente).
 */
export function UserAvailabilitySync() {
  const { user, refreshUser } = useAuth();

  useEffect(() => {
    if (!user) return;

    const local = readLocalAvailability();
    const server = user.availabilityStatus;

    if (!hasLocalAvailabilityPreference()) {
      if (server) applyServerAvailability(server);
      return;
    }

    if (server && local === server) return;

    void (async () => {
      const ok = await syncAvailabilityToServer(local, user.id);
      if (ok) await refreshUser();
    })();
  }, [user?.id, user?.availabilityStatus, refreshUser]);

  return null;
}
