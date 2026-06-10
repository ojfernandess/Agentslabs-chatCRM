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
  voiceMode?: "click_to_call";
};

function trunkStorageKey(organizationId: string) {
  return `nvoip_trunk_${organizationId}`;
}

type ActiveCall = {
  clientCallId: string;
  callId: string;
  status: string;
  elapsedSec: number;
  dialPhone: string;
  caller: string | null;
};

type OutboundResult =
  | { ok: true; dialPhone: string; caller: string | null; contactId: string | null; conversationId: string | null }
  | { ok: false; message: string };

type NvoipVoiceContextValue = {
  ready: boolean;
  canPlaceCalls: boolean;
  caller: string | null;
  voiceMode: "click_to_call";
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

const MAX_POLL_FAILURES = 3;

export function NvoipVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [canPlaceCalls, setCanPlaceCalls] = useState(false);
  const [caller, setCaller] = useState<string | null>(null);
  const [trunks, setTrunks] = useState<TrunkRow[]>([]);
  const [selectedTrunkId, setSelectedTrunkIdState] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const pollFailuresRef = useRef(0);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

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
      setCaller(null);
      setReady(false);
      return;
    }
    if (isSuperAdminRole(user.role) && !user.actingOrganizationId) return;
    if (!(user.organizationFeatures?.nvoip_voice ?? false)) {
      setCanPlaceCalls(false);
      setCaller(null);
      setReady(true);
      return;
    }

    try {
      const res = await api.get<SessionPayload>("/nvoip/session");
      setCanPlaceCalls(!!res.canPlaceCalls);
      setCaller(res.caller?.trim() || null);
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
      setCaller(null);
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

  const finalizeCall = useCallback(
    async (call: ActiveCall, status: string, durationSec: number | null) => {
      stopPolling();
      pollFailuresRef.current = 0;
      try {
        await api.post("/nvoip/calls/outbound/complete", {
          clientCallId: call.clientCallId,
          callId: call.callId,
          status,
          durationSec,
        });
      } catch {
        /* best-effort */
      }
      setActiveCall((prev) =>
        prev && prev.callId === call.callId && prev.clientCallId === call.clientCallId ? null : prev,
      );
    },
    [stopPolling],
  );

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
        pollFailuresRef.current = 0;
        setActiveCall((prev) =>
          prev && prev.callId === call.callId
            ? { ...prev, status: res.status, elapsedSec: prev.elapsedSec + 2 }
            : prev,
        );
        if (res.terminal) {
          await finalizeCall(call, res.status, res.durationSec);
        }
      } catch {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= MAX_POLL_FAILURES) {
          await finalizeCall(call, "ENDED", call.elapsedSec);
        }
      }
    },
    [finalizeCall],
  );

  useEffect(() => {
    if (!activeCall) {
      stopPolling();
      pollFailuresRef.current = 0;
      return;
    }

    pollFailuresRef.current = 0;
    void pollCall(activeCall);

    const elapsedTimer = setInterval(() => {
      setActiveCall((prev) => (prev ? { ...prev, elapsedSec: prev.elapsedSec + 1 } : prev));
    }, 1000);

    pollRef.current = setInterval(() => {
      const current = activeCallRef.current;
      if (current) void pollCall(current);
    }, 2500);

    return () => {
      stopPolling();
      clearInterval(elapsedTimer);
    };
  }, [activeCall?.callId, activeCall?.clientCallId, pollCall, stopPolling]);

  useEffect(() => {
    const onEnded = (event: Event) => {
      const detail = (event as CustomEvent<{ callId?: string; clientCallId?: string; userId?: string }>)
        .detail;
      if (detail?.userId && user?.id && detail.userId !== user.id) return;
      setActiveCall((prev) => {
        if (!prev) return null;
        if (detail?.clientCallId && prev.clientCallId === detail.clientCallId) return null;
        if (detail?.callId && prev.callId === detail.callId) return null;
        return prev;
      });
      stopPolling();
    };
    window.addEventListener("openconduit:nvoip-call-ended", onEnded);
    return () => window.removeEventListener("openconduit:nvoip-call-ended", onEnded);
  }, [stopPolling, user?.id]);

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
          caller?: string;
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
          status: "CALLING_ORIGIN",
          elapsedSec: 0,
          dialPhone: res.dialPhone ?? input.phone,
          caller: res.caller?.trim() || caller,
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
          caller: res.caller?.trim() || caller,
          contactId: res.contactId ?? null,
          conversationId: res.conversationId ?? null,
        };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "call_failed" };
      }
    },
    [caller, selectedTrunkId],
  );

  const endActiveCall = useCallback(async () => {
    const call = activeCall;
    if (!call) return;
    stopPolling();
    try {
      await api.post("/nvoip/calls/end", { callId: call.callId });
    } catch {
      /* fall through to complete */
    }
    await finalizeCall(call, "ENDED", call.elapsedSec);
  }, [activeCall, finalizeCall, stopPolling]);

  const value = useMemo(
    () => ({
      ready,
      canPlaceCalls,
      caller,
      voiceMode: "click_to_call" as const,
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
      caller,
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
