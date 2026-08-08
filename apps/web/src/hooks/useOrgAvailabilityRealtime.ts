import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  USER_AVAILABILITY_CHANGED_EVENT,
  normalizeAvailabilityStatus,
  type UserAvailability,
} from "@/lib/userAvailability";

type AssigneeRow = { id: string; availabilityStatus: UserAvailability };

/** Mantém listas de atendentes atualizadas quando a disponibilidade muda (WebSocket ou local). */
export function useOrgAvailabilityRealtime<T extends AssigneeRow>(
  setRows: Dispatch<SetStateAction<T[]>>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const onAvailability = (e: Event) => {
      const detail = (e as CustomEvent<{ userId?: string; status?: UserAvailability }>).detail;
      if (!detail?.userId) return;
      const status = normalizeAvailabilityStatus(detail.status);
      setRows((rows) => {
        let changed = false;
        const next = rows.map((row) => {
          if (row.id !== detail.userId) return row;
          if (row.availabilityStatus === status) return row;
          changed = true;
          return { ...row, availabilityStatus: status };
        });
        return changed ? next : rows;
      });
    };

    window.addEventListener(USER_AVAILABILITY_CHANGED_EVENT, onAvailability);
    return () => window.removeEventListener(USER_AVAILABILITY_CHANGED_EVENT, onAvailability);
  }, [enabled, setRows]);
}
