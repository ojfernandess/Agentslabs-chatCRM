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
import { useI18n } from "@/i18n/I18nProvider";

type SessionDevice = {
  id: string;
  name: string;
  linkedPhone: string | null;
  inboxId: string | null;
  token: string;
};

type WavoipVoiceContextValue = {
  ready: boolean;
  devices: SessionDevice[];
  incomingOffer: Offer | null;
  activeCall: CallActive | CallOutgoing | null;
  callStatus: string | null;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  startOutboundCall: (params: { phone: string; inboxId?: string | null }) => Promise<{ ok: true } | { ok: false; message: string }>;
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

export function WavoipVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const wavoipRef = useRef<Wavoip | null>(null);
  const [devices, setDevices] = useState<SessionDevice[]>([]);
  const [ready, setReady] = useState(false);
  const [incomingOffer, setIncomingOffer] = useState<Offer | null>(null);
  const [activeCall, setActiveCall] = useState<CallActive | CallOutgoing | null>(null);
  const [callStatus, setCallStatus] = useState<string | null>(null);

  const bindActiveCall = useCallback((call: CallActive | CallOutgoing) => {
    setActiveCall(call);
    setCallStatus(call.status);

    if (call.direction === "OUTGOING") {
      const outgoing = call as CallOutgoing;
      outgoing.on("status", (status: string) => setCallStatus(status));
      outgoing.on("ended", () => {
        setActiveCall(null);
        setCallStatus(null);
      });
      outgoing.on("peerAccept", (active: CallActive) => {
        setActiveCall(active);
        setCallStatus(active.status);
        active.on("status", (status: string) => setCallStatus(status));
        active.on("ended", () => {
          setActiveCall(null);
          setCallStatus(null);
        });
      });
      return;
    }

    const active = call as CallActive;
    active.on("status", (status: string) => setCallStatus(status));
    active.on("ended", () => {
      setActiveCall(null);
      setCallStatus(null);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setDevices([]);
      setReady(false);
      wavoipRef.current = null;
      return;
    }
    if (isSuperAdminRole(user.role) && !user.actingOrganizationId) return;

    let cancelled = false;

    const init = async () => {
      try {
        const session = await api.get<{ devices: SessionDevice[] }>("/wavoip/session");
        if (cancelled) return;
        const list = session.devices ?? [];
        setDevices(list);
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

  const acceptIncoming = useCallback(async () => {
    const offer = incomingOffer;
    if (!offer) return;
    void unlockAudioAlerts();
    const { call, err } = await offer.accept();
    if (err || !call) return;
    setIncomingOffer(null);
    bindActiveCall(call);
  }, [incomingOffer, bindActiveCall]);

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
    await activeCall.end();
    setActiveCall(null);
    setCallStatus(null);
  }, [activeCall]);

  const startOutboundCall = useCallback(
    async (params: { phone: string; inboxId?: string | null }) => {
      const wavoip = wavoipRef.current;
      if (!wavoip || devices.length === 0) {
        return { ok: false as const, message: "no_devices" };
      }

      void unlockAudioAlerts();

      let fromTokens: string[] | undefined;
      if (params.inboxId) {
        const matched = devices.filter((d) => d.inboxId === params.inboxId);
        if (matched.length > 0) fromTokens = matched.map((d) => d.token);
      }

      const { call, err } = await wavoip.startCall({ to: params.phone, fromTokens });
      if (!call) {
        const msg = typeof err === "object" && err && "message" in err ? String(err.message) : "call_failed";
        return { ok: false as const, message: msg };
      }

      bindActiveCall(call);
      return { ok: true as const };
    },
    [devices, bindActiveCall],
  );

  const value = useMemo(
    () => ({
      ready,
      devices,
      incomingOffer,
      activeCall,
      callStatus,
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
