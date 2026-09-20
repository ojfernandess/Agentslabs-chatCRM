import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  USER_AVAILABILITY_CHANGED_EVENT,
  USER_PRESENCE_CHANGED_EVENT,
  normalizeAvailabilityStatus,
  patchAssigneePresence,
  type UserAvailability,
} from "@/lib/userAvailability";

type AssigneeRow = {
  id: string;
  availabilityStatus: UserAvailability;
  effectiveAvailabilityStatus?: UserAvailability;
  presenceConnected?: boolean;
};

/** Mantém listas de atendentes atualizadas quando disponibilidade ou presença mudam. */
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
          const effective =
            status === "online"
              ? resolvePresenceAwareEffective(row, status)
              : status;
          return {
            ...row,
            availabilityStatus: status,
            effectiveAvailabilityStatus: effective,
          };
        });
        return changed ? next : rows;
      });
    };

    const onPresence = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          userId?: string;
          presenceConnected?: boolean;
          effectiveAvailabilityStatus?: UserAvailability;
        }>
      ).detail;
      if (!detail?.userId || detail.presenceConnected === undefined) return;
      const effective = normalizeAvailabilityStatus(detail.effectiveAvailabilityStatus);
      setRows((rows) =>
        patchAssigneePresence(rows, detail.userId!, detail.presenceConnected!, effective),
      );
    };

    window.addEventListener(USER_AVAILABILITY_CHANGED_EVENT, onAvailability);
    window.addEventListener(USER_PRESENCE_CHANGED_EVENT, onPresence);
    return () => {
      window.removeEventListener(USER_AVAILABILITY_CHANGED_EVENT, onAvailability);
      window.removeEventListener(USER_PRESENCE_CHANGED_EVENT, onPresence);
    };
  }, [enabled, setRows]);
}

function resolvePresenceAwareEffective(
  row: AssigneeRow,
  intent: UserAvailability,
): UserAvailability {
  if (intent !== "online") return intent;
  return row.presenceConnected === true ? "online" : "offline";
}
