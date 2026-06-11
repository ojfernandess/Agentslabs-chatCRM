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
  voiceMode?: "click_to_call" | "embedded_sip";
  embeddedSipEnabled?: boolean;
  hasUserSipCredentials?: boolean;
  callerHasWebphone?: boolean;
  callerWarning?: "pabx_trunk_not_webphone" | "no_webphone_users" | null;
  webphoneUsers?: { numbersip: string; caller: string | null; name: string | null }[];
  accountNumbersip?: string;
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
  conversationId: string | null;
};

type OutboundResult =
  | { ok: true; dialPhone: string; caller: string | null; contactId: string | null; conversationId: string | null }
  | { ok: false; message: string };

type NvoipVoiceContextValue = {
  ready: boolean;
  canPlaceCalls: boolean;
  caller: string | null;
  callerHasWebphone: boolean;
  callerWarning: "pabx_trunk_not_webphone" | "no_webphone_users" | null;
  webphoneUsers: { numbersip: string; caller: string | null; name: string | null }[];
  accountNumbersip: string | null;
  voiceMode: "click_to_call" | "embedded_sip";
  embeddedSipEnabled: boolean;
  trunks: TrunkRow[];
  selectedTrunkId: string | null;
  setSelectedTrunkId: (id: string | null) => void;
  activeCall: ActiveCall | null;
  isOnCallForConversation: (conversationId: string) => boolean;
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

const MAX_POLL_FAILURES = 24;
const POLL_MS_ACTIVE = 2000;
const POLL_MS_IDLE = 2500;

function isNvoipCallPhaseActive(status: string): boolean {
  const s = status.toUpperCase();
  return ["CALLING_ORIGIN", "CALLING_DESTINATION", "ACTIVE", "DIALING", "RINGING"].includes(s);
}

export function NvoipVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [canPlaceCalls, setCanPlaceCalls] = useState(false);
  const [caller, setCaller] = useState<string | null>(null);
  const [callerHasWebphone, setCallerHasWebphone] = useState(false);
  const [callerWarning, setCallerWarning] = useState<
    "pabx_trunk_not_webphone" | "no_webphone_users" | null
  >(null);
  const [webphoneUsers, setWebphoneUsers] = useState<
    { numbersip: string; caller: string | null; name: string | null }[]
  >([]);
  const [accountNumbersip, setAccountNumbersip] = useState<string | null>(null);
  const [trunks, setTrunks] = useState<TrunkRow[]>([]);
  const [selectedTrunkId, setSelectedTrunkIdState] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState<"click_to_call" | "embedded_sip">("click_to_call");
  const [embeddedSipEnabled, setEmbeddedSipEnabled] = useState(false);
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
      setVoiceMode(res.voiceMode === "embedded_sip" ? "embedded_sip" : "click_to_call");
      setEmbeddedSipEnabled(!!res.embeddedSipEnabled);
      setCaller(res.caller?.trim() || null);
      setCallerHasWebphone(!!res.callerHasWebphone);
      setCallerWarning(res.callerWarning ?? null);
      setWebphoneUsers(res.webphoneUsers ?? []);
      setAccountNumbersip(res.accountNumbersip?.trim() || null);
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
          ? { ...prev, status: res.status }
          : prev,
      );
        if (res.terminal) {
          await finalizeCall(call, res.status, res.durationSec);
          if (call.conversationId) {
            window.dispatchEvent(
              new CustomEvent("openconduit:conversation-updated", {
                detail: { conversationId: call.conversationId },
              }),
            );
          }
        }
      } catch {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= MAX_POLL_FAILURES && call.elapsedSec >= 600) {
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

    const pollMs = isNvoipCallPhaseActive(activeCall.status) ? POLL_MS_ACTIVE : POLL_MS_IDLE;
    pollRef.current = setInterval(() => {
      const current = activeCallRef.current;
      if (current) void pollCall(current);
    }, pollMs);

    return () => {
      stopPolling();
      clearInterval(elapsedTimer);
    };
  }, [activeCall?.callId, activeCall?.clientCallId, activeCall?.status, pollCall, stopPolling]);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          callId?: string;
          clientCallId?: string;
          userId?: string;
          status?: string;
          conversationId?: string | null;
        }>
      ).detail;
      if (detail?.userId && user?.id && detail.userId !== user.id) return;
      setActiveCall((prev) => {
        if (!prev) return null;
        const matches =
          (detail?.clientCallId && prev.clientCallId === detail.clientCallId) ||
          (detail?.callId && prev.callId === detail.callId);
        if (!matches) return prev;
        return {
          ...prev,
          status: detail.status?.trim() || prev.status,
          conversationId: detail.conversationId ?? prev.conversationId,
        };
      });
      if (detail?.conversationId) {
        window.dispatchEvent(
          new CustomEvent("openconduit:conversation-updated", {
            detail: { conversationId: detail.conversationId },
          }),
        );
      }
    };

    const onEnded = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          callId?: string;
          clientCallId?: string;
          userId?: string;
          conversationId?: string | null;
        }>
      ).detail;
      if (detail?.userId && user?.id && detail.userId !== user.id) return;
      setActiveCall((prev) => {
        if (!prev) return null;
        if (detail?.clientCallId && prev.clientCallId === detail.clientCallId) return null;
        if (detail?.callId && prev.callId === detail.callId) return null;
        return prev;
      });
      stopPolling();
      if (detail?.conversationId) {
        window.dispatchEvent(
          new CustomEvent("openconduit:conversation-updated", {
            detail: { conversationId: detail.conversationId },
          }),
        );
      }
    };

    window.addEventListener("openconduit:nvoip-call-updated", onUpdated);
    window.addEventListener("openconduit:nvoip-call-ended", onEnded);
    return () => {
      window.removeEventListener("openconduit:nvoip-call-updated", onUpdated);
      window.removeEventListener("openconduit:nvoip-call-ended", onEnded);
    };
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
          initialStatus?: string;
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
        const initialStatus = res.initialStatus?.trim() || "CALLING_ORIGIN";
        setActiveCall({
          clientCallId,
          callId: res.callId,
          status: initialStatus,
          elapsedSec: 0,
          dialPhone: res.dialPhone ?? input.phone,
          caller: res.caller?.trim() || caller,
          conversationId: res.conversationId ?? input.conversationId ?? null,
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
    window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-hangup-request"));
    stopPolling();
    try {
      const res = await api.post<{
        ok?: boolean;
        terminal?: boolean;
        status?: string;
        durationSec?: number | null;
      }>("/nvoip/calls/end", { callId: call.callId });
      const status = res.status?.trim() || "ENDED";
      const duration =
        res.durationSec != null && Number.isFinite(res.durationSec)
          ? res.durationSec
          : call.elapsedSec;
      await finalizeCall(call, status, duration);
    } catch {
      pollFailuresRef.current = 0;
      const pollMs = isNvoipCallPhaseActive(call.status) ? POLL_MS_ACTIVE : POLL_MS_IDLE;
      pollRef.current = setInterval(() => {
        const current = activeCallRef.current;
        if (current) void pollCall(current);
      }, pollMs);
    }
  }, [activeCall, finalizeCall, pollCall, stopPolling]);

  const isOnCallForConversation = useCallback(
    (conversationId: string) => {
      if (!activeCall || activeCall.conversationId !== conversationId) return false;
      return isNvoipCallPhaseActive(activeCall.status);
    },
    [activeCall],
  );

  const value = useMemo(
    () => ({
      ready,
      canPlaceCalls,
      caller,
      callerHasWebphone,
      callerWarning,
      webphoneUsers,
      accountNumbersip,
      voiceMode,
      embeddedSipEnabled,
      trunks,
      selectedTrunkId,
      setSelectedTrunkId,
      activeCall,
      isOnCallForConversation,
      refreshSession,
      startOutboundCall,
      endActiveCall,
    }),
    [
      ready,
      canPlaceCalls,
      caller,
      callerHasWebphone,
      callerWarning,
      webphoneUsers,
      accountNumbersip,
      voiceMode,
      embeddedSipEnabled,
      trunks,
      selectedTrunkId,
      setSelectedTrunkId,
      activeCall,
      isOnCallForConversation,
      refreshSession,
      startOutboundCall,
      endActiveCall,
    ],
  );

  return <NvoipVoiceContext.Provider value={value}>{children}</NvoipVoiceContext.Provider>;
}
