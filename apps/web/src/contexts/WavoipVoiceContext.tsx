import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wavoip,
  type CallActive,
  type CallOutgoing,
  type Offer,
} from "@wavoip/wavoip-api";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { api } from "@/lib/api";
import {
  playIncomingCallQueuedPulse,
  playIncomingCallRing,
  stopIncomingCallRing,
  unlockAudioAlerts,
} from "@/lib/audioAlerts";
import { resolveTerminalCallStatus } from "@/lib/callDuration";
import { useI18n } from "@/i18n/I18nProvider";

type SessionDevice = {
  id: string;
  name: string;
  linkedPhone: string | null;
  inboxId: string | null;
  token: string;
  incomingQueueMode?: "all" | "assignee" | "team";
  incomingQueueTeamId?: string | null;
};

type IncomingCallEntry = {
  offer: Offer;
  deviceId: string;
  incomingQueueMode: "all" | "assignee" | "team";
  incomingQueueTeamId: string | null;
  conversationId: string | null;
  contactId: string | null;
  contactName: string | null;
  caller: string;
  whatsappCallId?: number;
};

type ActiveCallMeta = {
  clientCallId: string;
  /** ID do offer SDK (screen-pop) — fallback quando `call.id` difere após atender. */
  offerClientCallId?: string | null;
  deviceId: string;
  conversationId: string | null;
  contactId: string | null;
  startedAt: number;
};

type WavoipVoiceContextValue = {
  ready: boolean;
  /** True when Wavoip is enabled and at least one device is OPEN (connected). */
  canPlaceCalls: boolean;
  devices: SessionDevice[];
  incomingOffer: Offer | null;
  incomingCallCount: number;
  incomingMinimized: boolean;
  minimizeIncoming: () => void;
  expandIncoming: () => void;
  cycleIncomingCall: () => void;
  incomingScreenPopConversationId: string | null;
  incomingScreenPopContactName: string | null;
  openIncomingConversation: () => void;
  activeCall: CallActive | CallOutgoing | null;
  callStatus: string | null;
  activeCallConversationId: string | null;
  callStartedAt: number | null;
  callElapsedSec: number;
  isOnCallForConversation: (conversationId: string) => boolean;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  forceEndConversationCall: (conversationId: string) => Promise<void>;
  startOutboundCall: (params: {
    phone: string;
    inboxId?: string | null;
    conversationId?: string | null;
    contactId?: string | null;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  dismissIncoming: () => void;
};

const WavoipVoiceContext = createContext<WavoipVoiceContextValue | null>(null);

async function reportCallComplete(meta: ActiveCallMeta, status: string, durationSec: number | null) {
  try {
    await api.post("/wavoip/calls/outbound/complete", {
      clientCallId: meta.clientCallId,
      conversationId: meta.conversationId ?? undefined,
      status,
      durationSec,
    });
    dispatchCallLogged(meta.conversationId, meta.contactId);
  } catch {
    if (meta.offerClientCallId && meta.offerClientCallId !== meta.clientCallId) {
      try {
        await api.post("/wavoip/calls/outbound/complete", {
          clientCallId: meta.offerClientCallId,
          conversationId: meta.conversationId ?? undefined,
          status,
          durationSec,
        });
        dispatchCallLogged(meta.conversationId, meta.contactId);
      } catch {
        /* best-effort */
      }
    } else if (meta.conversationId) {
      try {
        await api.post("/wavoip/calls/outbound/complete", {
          conversationId: meta.conversationId,
          status,
          durationSec,
        });
        dispatchCallLogged(meta.conversationId, meta.contactId);
      } catch {
        /* best-effort */
      }
    }
  }
}

function dispatchCallLogged(conversationId: string | null, contactId: string | null) {
  window.dispatchEvent(
    new CustomEvent("openconduit:wavoip-call-logged", {
      detail: { conversationId, contactId },
    }),
  );
  if (conversationId) {
    window.dispatchEvent(
      new CustomEvent("openconduit:conversation-updated", {
        detail: { conversationId },
      }),
    );
  }
}

async function reportRemoteCallEnded(params: {
  clientCallId: string;
  conversationId: string | null;
  contactId?: string | null;
  status: string;
}) {
  try {
    await api.post("/wavoip/calls/outbound/complete", {
      clientCallId: params.clientCallId,
      conversationId: params.conversationId ?? undefined,
      status: params.status,
      durationSec: null,
    });
    dispatchCallLogged(params.conversationId, params.contactId ?? null);
  } catch {
    if (params.conversationId) {
      try {
        await api.post("/wavoip/calls/outbound/complete", {
          conversationId: params.conversationId,
          status: params.status,
          durationSec: null,
        });
        dispatchCallLogged(params.conversationId, params.contactId ?? null);
      } catch {
        /* best-effort */
      }
    }
  }
}

function dispatchInboundCrmEvents(detail: {
  conversationId: string;
  contactId: string | null;
  caller: string;
  whatsappCallId?: number;
}) {
  window.dispatchEvent(
    new CustomEvent("openconduit:conversation-updated", {
      detail: { conversationId: detail.conversationId },
    }),
  );
  window.dispatchEvent(
    new CustomEvent("openconduit:wavoip-call-logged", {
      detail: { conversationId: detail.conversationId, contactId: detail.contactId },
    }),
  );
  window.dispatchEvent(
    new CustomEvent("openconduit:wavoip-call-incoming", {
      detail,
    }),
  );
}

export function WavoipVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const wavoipRef = useRef<Wavoip | null>(null);
  const devicesRef = useRef<SessionDevice[]>([]);
  const activeMetaRef = useRef<ActiveCallMeta | null>(null);
  const callStatusRef = useRef<string | null>(null);
  const finalizedCallIdsRef = useRef<Set<string>>(new Set());
  const incomingEntriesRef = useRef<Map<string, IncomingCallEntry>>(new Map());
  const [devices, setDevices] = useState<SessionDevice[]>([]);
  const [ready, setReady] = useState(false);
  const [incomingCalls, setIncomingCalls] = useState<IncomingCallEntry[]>([]);
  const [incomingMinimized, setIncomingMinimized] = useState(false);
  const [activeCall, setActiveCall] = useState<CallActive | CallOutgoing | null>(null);
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [activeCallConversationId, setActiveCallConversationId] = useState<string | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callElapsedSec, setCallElapsedSec] = useState(0);

  const headIncoming = incomingCalls[0] ?? null;
  const incomingOffer = headIncoming?.offer ?? null;
  const incomingScreenPopConversationId = headIncoming?.conversationId ?? null;
  const incomingScreenPopContactName = headIncoming?.contactName ?? null;

  const removeIncomingCall = useCallback((offerId: string) => {
    incomingEntriesRef.current.delete(offerId);
    setIncomingCalls((prev) => {
      const next = prev.filter((e) => e.offer.id !== offerId);
      if (next.length === 0) {
        stopIncomingCallRing();
        setIncomingMinimized(false);
      }
      return next;
    });
  }, []);

  const minimizeIncoming = useCallback(() => setIncomingMinimized(true), []);
  const expandIncoming = useCallback(() => setIncomingMinimized(false), []);
  const cycleIncomingCall = useCallback(() => {
    setIncomingCalls((prev) => (prev.length < 2 ? prev : [...prev.slice(1), prev[0]!]));
  }, []);

  const finalizeCall = useCallback(async (status: string) => {
    const meta = activeMetaRef.current;
    if (!meta) return;
    const finalizeKeys = [meta.clientCallId, meta.offerClientCallId].filter(Boolean) as string[];
    if (finalizeKeys.length > 0 && finalizeKeys.every((k) => finalizedCallIdsRef.current.has(k))) {
      return;
    }
    for (const k of finalizeKeys) finalizedCallIdsRef.current.add(k);
    const durationSec = Math.max(0, Math.round((Date.now() - meta.startedAt) / 1000));
    await reportCallComplete(meta, resolveTerminalCallStatus(status), durationSec > 0 ? durationSec : null);
    activeMetaRef.current = null;
    setActiveCallConversationId(null);
    setCallStartedAt(null);
    setCallElapsedSec(0);
  }, []);

  const claimCallAgent = useCallback((meta: ActiveCallMeta) => {
    void api
      .post("/wavoip/calls/claim-agent", {
        clientCallId: meta.clientCallId,
        ...(meta.conversationId ? { conversationId: meta.conversationId } : {}),
      })
      .catch(() => {});
  }, []);

  const bindActiveCall = useCallback(
    (call: CallActive | CallOutgoing, meta?: ActiveCallMeta) => {
      if (meta) {
        activeMetaRef.current = meta;
        setActiveCallConversationId(meta.conversationId);
        setCallStartedAt(meta.startedAt);
        setCallElapsedSec(0);
        claimCallAgent(meta);
      }
      setActiveCall(call);
      setCallStatus(call.status);
      callStatusRef.current = call.status;

      const onEnded = () => {
        void finalizeCall(resolveTerminalCallStatus(callStatusRef.current));
        setActiveCall(null);
        setCallStatus(null);
        callStatusRef.current = null;
        setCallStartedAt(null);
        setCallElapsedSec(0);
      };

      if (call.direction === "OUTGOING") {
        const outgoing = call as CallOutgoing;
        outgoing.on("status", (status: string) => {
          setCallStatus(status);
          callStatusRef.current = status;
        });
        outgoing.on("ended", onEnded);
        outgoing.on("peerAccept", (active: CallActive) => {
          bindActiveCall(active, activeMetaRef.current ?? undefined);
        });
        return;
      }

      const active = call as CallActive;
      active.on("status", (status: string) => {
        setCallStatus(status);
        callStatusRef.current = status;
      });
      active.on("ended", onEnded);
    },
    [claimCallAgent, finalizeCall],
  );

  useEffect(() => {
    if (!user) {
      setDevices([]);
      devicesRef.current = [];
      setReady(false);
      wavoipRef.current = null;
      return;
    }
    if (isSuperAdminRole(user.role) && !user.actingOrganizationId) return;
    if (!(user.organizationFeatures?.wavoip_voice ?? false)) {
      setDevices([]);
      devicesRef.current = [];
      setReady(true);
      return;
    }

    let cancelled = false;

    const bootstrapSession = async () => {
      try {
        const session = await api.get<{ devices: SessionDevice[] }>("/wavoip/session");
        if (cancelled) return;
        const list = session.devices ?? [];
        setDevices(list);
        devicesRef.current = list;

        if (list.length === 0) {
          wavoipRef.current = null;
          setReady(true);
          return;
        }

        const lang = locale.startsWith("pt") ? "pt-BR" : locale.startsWith("es") ? "es" : "en";
        const wavoip = new Wavoip({
          tokens: list.map((d) => d.token),
          platform: "openconduit",
          language: lang,
        });
        wavoipRef.current = wavoip;

        wavoip.on("offer", (offer) => {
          const phone = (offer.peer.phone ?? "").trim();
          const device =
            devicesRef.current.find((d) => d.token === offer.device_token) ?? devicesRef.current[0];

          const baseEntry: IncomingCallEntry = {
            offer,
            deviceId: device?.id ?? "",
            incomingQueueMode: device?.incomingQueueMode ?? "all",
            incomingQueueTeamId: device?.incomingQueueTeamId ?? null,
            conversationId: null,
            contactId: null,
            contactName: offer.peer.displayName?.trim() || null,
            caller: phone,
          };

          setIncomingCalls((prev) => {
            if (prev.some((e) => e.offer.id === offer.id)) return prev;
            if (prev.length > 0) {
              void playIncomingCallQueuedPulse();
              setIncomingMinimized(false);
            }
            const next = [...prev, baseEntry];
            incomingEntriesRef.current.set(offer.id, baseEntry);
            return next;
          });
          void playIncomingCallRing();

          const onOfferCleared = (status: string) => {
            const entry = incomingEntriesRef.current.get(offer.id);
            removeIncomingCall(offer.id);
            void reportRemoteCallEnded({
              clientCallId: offer.id,
              conversationId: entry?.conversationId ?? null,
              contactId: entry?.contactId ?? null,
              status,
            });
          };
          offer.on("ended", () => onOfferCleared("NOT_ANSWERED"));
          offer.on("acceptedElsewhere", () => onOfferCleared("HANDLED_REMOTELY"));
          offer.on("rejectedElsewhere", () => onOfferCleared("REJECTED"));

          if (device && phone) {
            void api
              .post<{
                ok: true;
                conversationId: string;
                contactId: string;
                contactName: string | null;
                whatsappCallId: number;
                caller: string;
              }>("/wavoip/calls/incoming/screen-pop", {
                wavoipDeviceId: device.id,
                phone,
                clientCallId: offer.id,
                displayName: offer.peer.displayName ?? undefined,
              })
              .then((res) => {
                const enriched: IncomingCallEntry = {
                  ...baseEntry,
                  conversationId: res.conversationId,
                  contactId: res.contactId,
                  contactName: res.contactName,
                  caller: res.caller,
                  whatsappCallId: res.whatsappCallId,
                };
                incomingEntriesRef.current.set(offer.id, enriched);
                setIncomingCalls((prev) =>
                  prev.map((e) => (e.offer.id === offer.id ? enriched : e)),
                );
                dispatchInboundCrmEvents({
                  conversationId: res.conversationId,
                  contactId: res.contactId,
                  caller: res.caller,
                  whatsappCallId: res.whatsappCallId,
                });
              })
              .catch(() => {
                /* webhook may still update later */
              });
          }
        });

        setReady(true);
      } catch {
        if (!cancelled) {
          setDevices([]);
          devicesRef.current = [];
          wavoipRef.current = null;
          setReady(true);
        }
      }
    };

    void bootstrapSession();

    const onDeviceUpdated = () => {
      void bootstrapSession();
    };
    window.addEventListener("openconduit:wavoip-device-updated", onDeviceUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener("openconduit:wavoip-device-updated", onDeviceUpdated);
      wavoipRef.current = null;
    };
  }, [user, locale, navigate]);

  const openIncomingConversation = useCallback(() => {
    const id = headIncoming?.conversationId;
    if (id) navigate(`/conversations/${id}`);
  }, [headIncoming?.conversationId, navigate]);

  useEffect(() => {
    if (!activeCall || callStartedAt == null) return;
    const tick = () => {
      setCallElapsedSec(Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activeCall, callStartedAt]);

  const acceptIncoming = useCallback(async () => {
    const entry = headIncoming;
    const offer = entry?.offer;
    if (!offer) return;
    void unlockAudioAlerts();
    const { call, err } = await offer.accept();
    if (err || !call) return;
    removeIncomingCall(offer.id);
    setIncomingMinimized(false);

    const conversationId = entry.conversationId;
    if (conversationId && user?.id) {
      try {
        await api.patch(`/conversations/${conversationId}`, {
          status: "OPEN",
          assignedToId: user.id,
        });
      } catch {
        /* best-effort */
      }
    }

    if (entry.incomingQueueMode === "team" && entry.incomingQueueTeamId) {
      navigate(`/teams?teamId=${encodeURIComponent(entry.incomingQueueTeamId)}`);
    } else if (conversationId) {
      navigate(`/conversations/${conversationId}`);
    }

    const meta: ActiveCallMeta = {
      clientCallId: call.id,
      offerClientCallId: offer.id,
      deviceId: devicesRef.current.find((d) => d.token === call.device_token)?.id ?? devicesRef.current[0]?.id ?? "",
      conversationId,
      contactId: entry.contactId,
      startedAt: Date.now(),
    };
    bindActiveCall(call, meta);
  }, [headIncoming, bindActiveCall, user?.id, navigate, removeIncomingCall]);

  const rejectIncoming = useCallback(async () => {
    const offer = headIncoming?.offer;
    if (!offer) return;
    const entry = headIncoming;
    await offer.reject();
    removeIncomingCall(offer.id);
    void reportRemoteCallEnded({
      clientCallId: offer.id,
      conversationId: entry?.conversationId ?? null,
      contactId: entry?.contactId ?? null,
      status: "REJECTED",
    });
  }, [headIncoming, removeIncomingCall]);

  const dismissIncoming = useCallback(() => {
    const offer = headIncoming?.offer;
    if (offer) removeIncomingCall(offer.id);
    else {
      stopIncomingCallRing();
      setIncomingCalls([]);
      setIncomingMinimized(false);
    }
  }, [headIncoming, removeIncomingCall]);

  const endActiveCall = useCallback(async () => {
    if (!activeCall) return;
    const meta = activeMetaRef.current;
    try {
      await activeCall.end();
    } catch {
      /* SDK pode já ter terminado quando o contacto desligou */
    }
    if (meta) {
      const finalizeKey = meta.clientCallId;
      if (!finalizedCallIdsRef.current.has(finalizeKey)) {
        await finalizeCall(resolveTerminalCallStatus(callStatusRef.current));
      }
    }
    setActiveCall(null);
    setCallStatus(null);
    callStatusRef.current = null;
    setActiveCallConversationId(null);
    setCallStartedAt(null);
    setCallElapsedSec(0);
  }, [activeCall, finalizeCall]);

  const forceEndConversationCall = useCallback(async (conversationId: string) => {
    const meta = activeMetaRef.current;
    if (activeCall && meta?.conversationId === conversationId) {
      await endActiveCall();
      return;
    }
    try {
      await api.post("/wavoip/calls/force-end", { conversationId });
      dispatchCallLogged(conversationId, null);
    } catch {
      /* best-effort */
    }
  }, [activeCall, endActiveCall]);

  const startOutboundCall = useCallback(
    async (params: {
      phone: string;
      inboxId?: string | null;
      conversationId?: string | null;
      contactId?: string | null;
    }) => {
      const wavoip = wavoipRef.current;
      const deviceList = devicesRef.current;
      if (!wavoip || deviceList.length === 0) {
        return { ok: false as const, message: "no_devices" };
      }

      void unlockAudioAlerts();

      let fromTokens: string[] | undefined;
      let matchedDevices = deviceList;
      if (params.inboxId) {
        matchedDevices = deviceList.filter((d) => d.inboxId === params.inboxId);
        if (matchedDevices.length > 0) fromTokens = matchedDevices.map((d) => d.token);
      }

      const sessionDevice = matchedDevices[0] ?? deviceList[0];

      let dialPhone = params.phone;
      let resolvedContactId = params.contactId ?? null;
      let resolvedConversationId = params.conversationId ?? null;
      try {
        const prep = await api.get<{
          dialPhone: string;
          contact: { id: string; name: string; phone: string } | null;
          conversationId: string | null;
        }>(
          `/wavoip/calls/resolve-context?phone=${encodeURIComponent(params.phone)}&wavoipDeviceId=${encodeURIComponent(sessionDevice.id)}${params.contactId ? `&contactId=${encodeURIComponent(params.contactId)}` : ""}${params.conversationId ? `&conversationId=${encodeURIComponent(params.conversationId)}` : ""}`,
        );
        if (prep.dialPhone) dialPhone = prep.dialPhone;
        if (!resolvedContactId && prep.contact?.id) resolvedContactId = prep.contact.id;
        if (!resolvedConversationId && prep.conversationId) resolvedConversationId = prep.conversationId;
      } catch {
        /* continue with raw phone */
      }

      const { call, err } = await wavoip.startCall({ to: dialPhone, fromTokens });
      if (!call) {
        const msg = typeof err === "object" && err && "message" in err ? String(err.message) : "call_failed";
        return { ok: false as const, message: msg };
      }

      const callDevice =
        matchedDevices.find((d) => d.token === call.device_token) ??
        deviceList.find((d) => d.token === call.device_token) ??
        sessionDevice;

      const meta: ActiveCallMeta = {
        clientCallId: call.id,
        deviceId: callDevice.id,
        conversationId: resolvedConversationId,
        contactId: resolvedContactId,
        startedAt: Date.now(),
      };

      try {
        await api.post("/wavoip/calls/outbound/start", {
          clientCallId: meta.clientCallId,
          wavoipDeviceId: meta.deviceId,
          phone: dialPhone,
          contactId: resolvedContactId,
          conversationId: resolvedConversationId,
        });
      } catch {
        /* continue — SDK call is active */
      }

      bindActiveCall(call, meta);
      return { ok: true as const };
    },
    [bindActiveCall],
  );

  const isOnCallForConversation = useCallback(
    (conversationId: string) => activeCallConversationId === conversationId && !!activeCall,
    [activeCallConversationId, activeCall],
  );

  const canPlaceCalls = ready && devices.length > 0;

  const value = useMemo(
    () => ({
      ready,
      canPlaceCalls,
      devices,
      incomingOffer,
      incomingCallCount: incomingCalls.length,
      incomingMinimized,
      minimizeIncoming,
      expandIncoming,
      cycleIncomingCall,
      incomingScreenPopConversationId,
      incomingScreenPopContactName,
      openIncomingConversation,
      activeCall,
      callStatus,
      activeCallConversationId,
      callStartedAt,
      callElapsedSec,
      isOnCallForConversation,
      acceptIncoming,
      rejectIncoming,
      endActiveCall,
      forceEndConversationCall,
      startOutboundCall,
      dismissIncoming,
    }),
    [
      ready,
      canPlaceCalls,
      devices,
      incomingOffer,
      incomingCalls.length,
      incomingMinimized,
      minimizeIncoming,
      expandIncoming,
      cycleIncomingCall,
      incomingScreenPopConversationId,
      incomingScreenPopContactName,
      openIncomingConversation,
      activeCall,
      callStatus,
      activeCallConversationId,
      callStartedAt,
      callElapsedSec,
      isOnCallForConversation,
      acceptIncoming,
      rejectIncoming,
      endActiveCall,
      forceEndConversationCall,
      startOutboundCall,
      dismissIncoming,
    ],
  );

  return <WavoipVoiceContext.Provider value={value}>{children}</WavoipVoiceContext.Provider>;
}

export function useWavoipVoice(): WavoipVoiceContextValue {
  const ctx = useContext(WavoipVoiceContext);
  if (!ctx) {
    throw new Error("useWavoipVoice must be used within WavoipVoiceProvider");
  }
  return ctx;
}

export function useWavoipVoiceOptional(): WavoipVoiceContextValue | null {
  return useContext(WavoipVoiceContext);
}

/** Wavoip feature on + at least one device OPEN (connected) for this agent. */
export function useWavoipCanPlaceCalls(): boolean {
  return useWavoipVoiceOptional()?.canPlaceCalls ?? false;
}
