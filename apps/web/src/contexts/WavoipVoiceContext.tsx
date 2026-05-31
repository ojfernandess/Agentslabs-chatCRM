import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext, type ReactNode } from "react";
import {
  Wavoip,
  type CallActive,
  type CallOutgoing,
  type Offer,
} from "@wavoip/wavoip-api";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";
import { api } from "@/lib/api";
import { unlockAudioAlerts } from "@/lib/audioAlerts";
import { resolveTerminalCallStatus } from "@/lib/callDuration";
import { useI18n } from "@/i18n/I18nProvider";

type SessionDevice = {
  id: string;
  name: string;
  linkedPhone: string | null;
  inboxId: string | null;
  token: string;
};

type PendingIncomingMeta = {
  conversationId: string | null;
  contactId: string | null;
  caller: string;
  whatsappCallId?: number;
};

type ActiveCallMeta = {
  clientCallId: string;
  deviceId: string;
  conversationId: string | null;
  contactId: string | null;
  startedAt: number;
};

type WavoipVoiceContextValue = {
  ready: boolean;
  devices: SessionDevice[];
  incomingOffer: Offer | null;
  activeCall: CallActive | CallOutgoing | null;
  callStatus: string | null;
  activeCallConversationId: string | null;
  callStartedAt: number | null;
  callElapsedSec: number;
  isOnCallForConversation: (conversationId: string) => boolean;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  startOutboundCall: (params: {
    phone: string;
    inboxId?: string | null;
    conversationId?: string | null;
    contactId?: string | null;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  dismissIncoming: () => void;
};

const WavoipVoiceContext = createContext<WavoipVoiceContextValue | null>(null);

function playIncomingRing(): void {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.35);
    setTimeout(() => void ctx.close(), 500);
  } catch {
    /* ignore */
  }
}

async function reportCallComplete(meta: ActiveCallMeta, status: string, durationSec: number | null) {
  try {
    await api.post("/wavoip/calls/outbound/complete", {
      clientCallId: meta.clientCallId,
      status,
      durationSec,
    });
    window.dispatchEvent(
      new CustomEvent("openconduit:wavoip-call-logged", {
        detail: {
          conversationId: meta.conversationId,
          contactId: meta.contactId,
        },
      }),
    );
  } catch {
    /* best-effort */
  }
}

export function WavoipVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const wavoipRef = useRef<Wavoip | null>(null);
  const devicesRef = useRef<SessionDevice[]>([]);
  const activeMetaRef = useRef<ActiveCallMeta | null>(null);
  const pendingIncomingRef = useRef<PendingIncomingMeta | null>(null);
  const callStatusRef = useRef<string | null>(null);
  const finalizedCallIdsRef = useRef<Set<string>>(new Set());
  const [devices, setDevices] = useState<SessionDevice[]>([]);
  const [ready, setReady] = useState(false);
  const [incomingOffer, setIncomingOffer] = useState<Offer | null>(null);
  const [activeCall, setActiveCall] = useState<CallActive | CallOutgoing | null>(null);
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [activeCallConversationId, setActiveCallConversationId] = useState<string | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callElapsedSec, setCallElapsedSec] = useState(0);

  const finalizeCall = useCallback(async (status: string) => {
    const meta = activeMetaRef.current;
    if (!meta) return;
    if (finalizedCallIdsRef.current.has(meta.clientCallId)) return;
    finalizedCallIdsRef.current.add(meta.clientCallId);
    const durationSec = Math.max(0, Math.round((Date.now() - meta.startedAt) / 1000));
    await reportCallComplete(meta, resolveTerminalCallStatus(status), durationSec > 0 ? durationSec : null);
    activeMetaRef.current = null;
    setActiveCallConversationId(null);
    setCallStartedAt(null);
    setCallElapsedSec(0);
  }, []);

  const bindActiveCall = useCallback(
    (call: CallActive | CallOutgoing, meta?: ActiveCallMeta) => {
      if (meta) {
        activeMetaRef.current = meta;
        setActiveCallConversationId(meta.conversationId);
        setCallStartedAt(meta.startedAt);
        setCallElapsedSec(0);
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
    [finalizeCall],
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
    if (user.organizationFeatures?.wavoip_voice === false) {
      setReady(true);
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const session = await api.get<{ devices: SessionDevice[] }>("/wavoip/session");
        if (cancelled) return;
        const list = session.devices ?? [];
        setDevices(list);
        devicesRef.current = list;
        if (list.length === 0) {
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
          void unlockAudioAlerts();
          playIncomingRing();
          setIncomingOffer(offer);
          offer.on("ended", () => setIncomingOffer((cur) => (cur === offer ? null : cur)));
          offer.on("acceptedElsewhere", () => setIncomingOffer((cur) => (cur === offer ? null : cur)));
          offer.on("rejectedElsewhere", () => setIncomingOffer((cur) => (cur === offer ? null : cur)));
        });

        setReady(true);
      } catch {
        if (!cancelled) setReady(true);
      }
    };

    void init();

    return () => {
      cancelled = true;
      wavoipRef.current = null;
    };
  }, [user, locale]);

  useEffect(() => {
    if (!activeCall || callStartedAt == null) return;
    const tick = () => {
      setCallElapsedSec(Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activeCall, callStartedAt]);

  useEffect(() => {
    const onIncoming = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        caller?: string;
        conversationId?: string | null;
        contactId?: string | null;
        whatsappCallId?: number;
      };
      pendingIncomingRef.current = {
        caller: (detail.caller ?? "").trim(),
        conversationId: detail.conversationId ?? null,
        contactId: detail.contactId ?? null,
        whatsappCallId: detail.whatsappCallId,
      };
    };
    window.addEventListener("openconduit:wavoip-call-incoming", onIncoming);
    return () => window.removeEventListener("openconduit:wavoip-call-incoming", onIncoming);
  }, []);

  const acceptIncoming = useCallback(async () => {
    const offer = incomingOffer;
    if (!offer) return;
    void unlockAudioAlerts();
    const pending = pendingIncomingRef.current;
    const { call, err } = await offer.accept();
    if (err || !call) return;
    setIncomingOffer(null);

    const conversationId = pending?.conversationId ?? null;
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

    const meta: ActiveCallMeta = {
      clientCallId: call.id,
      deviceId: devicesRef.current.find((d) => d.token === call.device_token)?.id ?? devicesRef.current[0]?.id ?? "",
      conversationId,
      contactId: pending?.contactId ?? null,
      startedAt: Date.now(),
    };
    pendingIncomingRef.current = null;
    bindActiveCall(call, meta);
  }, [incomingOffer, bindActiveCall, user?.id]);

  const rejectIncoming = useCallback(async () => {
    const offer = incomingOffer;
    if (!offer) return;
    await offer.reject();
    setIncomingOffer(null);
  }, [incomingOffer]);

  const dismissIncoming = useCallback(() => {
    setIncomingOffer(null);
  }, []);

  const endActiveCall = useCallback(async () => {
    if (!activeCall) return;
    const meta = activeMetaRef.current;
    await activeCall.end();
    if (meta && !finalizedCallIdsRef.current.has(meta.clientCallId)) {
      await finalizeCall(resolveTerminalCallStatus(callStatusRef.current));
    }
    setActiveCall(null);
    setCallStatus(null);
    callStatusRef.current = null;
    setCallStartedAt(null);
    setCallElapsedSec(0);
  }, [activeCall, finalizeCall]);

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

  const value = useMemo(
    () => ({
      ready,
      devices,
      incomingOffer,
      activeCall,
      callStatus,
      activeCallConversationId,
      callStartedAt,
      callElapsedSec,
      isOnCallForConversation,
      acceptIncoming,
      rejectIncoming,
      endActiveCall,
      startOutboundCall,
      dismissIncoming,
    }),
    [
      ready,
      devices,
      incomingOffer,
      activeCall,
      callStatus,
      activeCallConversationId,
      callStartedAt,
      callElapsedSec,
      isOnCallForConversation,
      acceptIncoming,
      rejectIncoming,
      endActiveCall,
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
