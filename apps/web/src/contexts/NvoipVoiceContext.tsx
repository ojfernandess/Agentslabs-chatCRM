import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";

type TrunkRow = { id: string; name: string; defaultCaller: string; isDefault: boolean };

type SessionPayload = {
  ready: boolean;
  canPlaceCalls: boolean;
  caller: string | null;
  balance: string | null;
  trunks?: TrunkRow[];
};

function trunkStorageKey(organizationId: string) {
  return `nvoip_trunk_${organizationId}`;
}

type ActiveCall = {
  clientCallId: string;
  callId: string;
  status: string;
  elapsedSec: number;
};

type OutboundResult =
  | { ok: true; dialPhone: string; contactId: string | null; conversationId: string | null }
  | { ok: false; message: string };

type NvoipVoiceContextValue = {
  ready: boolean;
  canPlaceCalls: boolean;
  trunks: TrunkRow[];
  selectedTrunkId: string | null;
  setSelectedTrunkId: (id: string | null) => void;
  activeCall: ActiveCall | null;
  refreshSession: () => Promise<void>;
  startOutboundCall: (input: {
    phone: string;
    contactId?: string | null;
    conversationId?: string | null;
  }) => Promise<OutboundResult>;
  endActiveCall: () => Promise<void>;
};

const NvoipVoiceContext = createContext<NvoipVoiceContextValue | null>(null);

export function useNvoipVoiceOptional() {
  return useContext(NvoipVoiceContext);
}

export function NvoipVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [canPlaceCalls, setCanPlaceCalls] = useState(false);
  const [trunks, setTrunks] = useState<TrunkRow[]>([]);
  const [selectedTrunkId, setSelectedTrunkIdState] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setSelectedTrunkId = useCallback(
    (id: string | null) => {
      setSelectedTrunkIdState(id);
      const orgId = user?.actingOrganizationId ?? user?.organizationId;
      if (orgId) {
        if (id) localStorage.setItem(trunkStorageKey(orgId), id);
        else localStorage.removeItem(trunkStorageKey(orgId));
      }
    },
    [user?.actingOrganizationId, user?.organizationId],
  );

  const refreshSession = useCallback(async () => {
    if (!user) {
      setCanPlaceCalls(false);
      setReady(false);
      return;
    }
    if (isSuperAdminRole(user.role) && !user.actingOrganizationId) return;
    if (!(user.organizationFeatures?.nvoip_voice ?? false)) {
      setCanPlaceCalls(false);
      setReady(true);
      return;
    }

    try {
      const res = await api.get<SessionPayload>("/nvoip/session");
      setCanPlaceCalls(!!res.canPlaceCalls);
      const list = res.trunks ?? [];
      setTrunks(list);
      const orgId = user.actingOrganizationId ?? user.organizationId;
      if (orgId) {
        const stored = localStorage.getItem(trunkStorageKey(orgId));
        const valid =
          stored && list.some((t) => t.id === stored)
            ? stored
            : list.find((t) => t.isDefault)?.id ?? null;
        setSelectedTrunkIdState(valid);
      }
    } catch {
      setCanPlaceCalls(false);
    } finally {
      setReady(true);
    }
  }, [user]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const onRefresh = () => {
      void refreshSession();
    };
    window.addEventListener("openconduit:nvoip-session-refresh", onRefresh);
    return () => window.removeEventListener("openconduit:nvoip-session-refresh", onRefresh);
  }, [refreshSession]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollCall = useCallback(
    async (call: ActiveCall) => {
      try {
        const res = await api.get<{
          ok: boolean;
          status: string;
          terminal: boolean;
          durationSec: number | null;
        }>(
          `/nvoip/calls/status?callId=${encodeURIComponent(call.callId)}&clientCallId=${encodeURIComponent(call.clientCallId)}`,
        );
        setActiveCall((prev) =>
          prev && prev.callId === call.callId
            ? { ...prev, status: res.status, elapsedSec: prev.elapsedSec + 2 }
            : prev,
        );
        if (res.terminal) {
          stopPolling();
          await api.post("/nvoip/calls/outbound/complete", {
            clientCallId: call.clientCallId,
            callId: call.callId,
            status: res.status,
            durationSec: res.durationSec,
          });
          setActiveCall(null);
        }
      } catch {
        /* ignore transient poll errors */
      }
    },
    [stopPolling],
  );

  useEffect(() => {
    if (!activeCall) {
      stopPolling();
      return;
    }
    const tick = () => {
      setActiveCall((prev) => (prev ? { ...prev, elapsedSec: prev.elapsedSec + 1 } : prev));
      void pollCall(activeCall);
    };
    pollRef.current = setInterval(tick, 2500);
    return () => stopPolling();
  }, [activeCall?.callId, activeCall?.clientCallId, pollCall, stopPolling]);

  const startOutboundCall = useCallback(
    async (input: {
      phone: string;
      contactId?: string | null;
      conversationId?: string | null;
    }): Promise<OutboundResult> => {
      const clientCallId = crypto.randomUUID();
      try {
        const res = await api.post<{
          ok: boolean;
          callId?: string;
          dialPhone?: string;
          contactId?: string | null;
          conversationId?: string | null;
          message?: string;
        }>("/nvoip/calls/outbound/start", {
          clientCallId,
          phone: input.phone,
          contactId: input.contactId ?? null,
          conversationId: input.conversationId ?? null,
          trunkId: selectedTrunkId,
        });
        if (!res.ok || !res.callId) {
          return { ok: false, message: res.message ?? "call_failed" };
        }
        setActiveCall({
          clientCallId,
          callId: res.callId,
          status: "DIALING",
          elapsedSec: 0,
        });
        void api
          .post("/nvoip/calls/claim-agent", {
            clientCallId,
            ...(res.conversationId ? { conversationId: res.conversationId } : {}),
          })
          .catch(() => {});
        return {
          ok: true,
          dialPhone: res.dialPhone ?? input.phone,
          contactId: res.contactId ?? null,
          conversationId: res.conversationId ?? null,
        };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "call_failed" };
      }
    },
    [selectedTrunkId],
  );

  const endActiveCall = useCallback(async () => {
    const call = activeCall;
    if (!call) return;
    stopPolling();
    try {
      await api.post("/nvoip/calls/end", { callId: call.callId });
    } catch {
      await api.post("/nvoip/calls/outbound/complete", {
        clientCallId: call.clientCallId,
        callId: call.callId,
        status: "ENDED",
        durationSec: call.elapsedSec,
      });
    }
    setActiveCall(null);
  }, [activeCall, stopPolling]);

  const value = useMemo(
    () => ({
      ready,
      canPlaceCalls,
      trunks,
      selectedTrunkId,
      setSelectedTrunkId,
      activeCall,
      refreshSession,
      startOutboundCall,
      endActiveCall,
    }),
    [
      ready,
      canPlaceCalls,
      trunks,
      selectedTrunkId,
      setSelectedTrunkId,
      activeCall,
      refreshSession,
      startOutboundCall,
      endActiveCall,
    ],
  );

  return <NvoipVoiceContext.Provider value={value}>{children}</NvoipVoiceContext.Provider>;
}
