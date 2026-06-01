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

type SessionPayload = {
  ready: boolean;
  canPlaceCalls: boolean;
  caller: string | null;
  balance: string | null;
};

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
  activeCall: ActiveCall | null;
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
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
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

    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<SessionPayload>("/nvoip/session");
        if (!cancelled) setCanPlaceCalls(!!res.canPlaceCalls);
      } catch {
        if (!cancelled) setCanPlaceCalls(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

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
    [],
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
      activeCall,
      startOutboundCall,
      endActiveCall,
    }),
    [ready, canPlaceCalls, activeCall, startOutboundCall, endActiveCall],
  );

  return <NvoipVoiceContext.Provider value={value}>{children}</NvoipVoiceContext.Provider>;
}
