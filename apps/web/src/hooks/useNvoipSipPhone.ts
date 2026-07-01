import { useCallback, useEffect, useRef, useState } from "react";
import JsSIP from "jssip";
import { api, ApiError } from "@/lib/api";

type SipRtcSession = {
  answer: (options: {
    mediaConstraints: { audio: boolean; video: boolean };
    mediaStream?: MediaStream;
  }) => void;
  terminate: () => void;
  direction?: string;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

export type NvoipSipCallStatus =
  | "unregistered"
  | "registered"
  | "ringing"
  | "in-call"
  | "ended"
  | "error";

type SipCredentials = {
  sipUser: string;
  sipPassword: string;
  displayName?: string | null;
  sipDomain: string;
  wssUrl: string;
  wssUrlAlternates?: string[];
};

function emitSipStatus(status: NvoipSipCallStatus, error: string | null): void {
  window.dispatchEvent(
    new CustomEvent("openconduit:nvoip-sip-status", { detail: { status, error } }),
  );
}

async function acquireLocalAudio(existing: MediaStream | null): Promise<MediaStream | null> {
  if (existing?.active && existing.getAudioTracks().some((t) => t.readyState === "live")) {
    return existing;
  }
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    return null;
  }
}

function buildWssCandidates(creds: SipCredentials): string[] {
  const primary = creds.wssUrl?.trim() || `wss://${creds.sipDomain}:6443`;
  const alternates = creds.wssUrlAlternates ?? [];
  return [...new Set([primary, ...alternates.map((u) => u.trim()).filter(Boolean)])];
}

export function useNvoipSipPhone(enabled: boolean) {
  const uaRef = useRef<InstanceType<typeof JsSIP.UA> | null>(null);
  const sessionRef = useRef<SipRtcSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wssIndexRef = useRef(0);

  const [status, setStatus] = useState<NvoipSipCallStatus>("unregistered");
  const [error, setError] = useState<string | null>(null);

  const setStatusSafe = useCallback((next: NvoipSipCallStatus, err: string | null = null) => {
    setStatus(next);
    setError(err);
    emitSipStatus(next, err);
  }, []);

  const ensureLocalAudio = useCallback(async () => {
    const stream = await acquireLocalAudio(localStreamRef.current);
    if (stream) localStreamRef.current = stream;
    return stream;
  }, []);

  const attachRemoteAudio = useCallback((peerconnection: RTCPeerConnection) => {
    const playStream = (stream: MediaStream) => {
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.autoplay = true;
      }
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => {});
    };
    peerconnection.addEventListener("track", (e) => {
      if (e.streams[0]) playStream(e.streams[0]);
    });
  }, []);

  const startUa = useCallback(
    (creds: SipCredentials, wssUrl: string) => {
      if (uaRef.current) {
        uaRef.current.stop();
        uaRef.current = null;
      }

      const sipDomain = creds.sipDomain?.trim() || "app.nvoip.com.br";
      const sipUser = creds.sipUser.trim();

      const socket = new JsSIP.WebSocketInterface(wssUrl);
      socket.via_transport = "WSS";

      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${sipUser}@${sipDomain}`,
        authorization_user: sipUser,
        password: creds.sipPassword,
        display_name: creds.displayName?.trim() || sipUser,
        registrar_server: `sip:${sipDomain}`,
        register: true,
        register_expires: 600,
        session_timers: false,
        use_preloaded_route: true,
      });

      ua.on("registered", () => setStatusSafe("registered", null));
      ua.on("unregistered", () => setStatusSafe("unregistered", null));
      ua.on("registrationFailed", (e) => {
        const cause = String((e as { cause?: string }).cause ?? "unknown");
        const candidates = buildWssCandidates(creds);
        const nextIndex = wssIndexRef.current + 1;
        if (nextIndex < candidates.length && (cause === "Connection Error" || cause === "Request Timeout")) {
          wssIndexRef.current = nextIndex;
          startUa(creds, candidates[nextIndex]!);
          return;
        }
        setStatusSafe("error", `sip_registration_failed:${cause}`);
      });

      ua.on("newRTCSession", (data: unknown) => {
        const payload = data as { originator?: string; session: SipRtcSession };
        if (payload.originator && payload.originator !== "remote") return;

        const session = payload.session;
        sessionRef.current = session;
        setStatusSafe("ringing", null);

        session.on("peerconnection", (ev: unknown) => {
          const peerconnection = (ev as { peerconnection?: RTCPeerConnection }).peerconnection;
          if (peerconnection) attachRemoteAudio(peerconnection);
        });

        session.on("ended", () => {
          sessionRef.current = null;
          setStatusSafe(ua.isRegistered() ? "registered" : "unregistered", null);
          window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
        });
        session.on("failed", (ev: unknown) => {
          sessionRef.current = null;
          const cause = String((ev as { cause?: string }).cause ?? "unknown");
          setStatusSafe(
            ua.isRegistered() ? "registered" : "unregistered",
            cause !== "Canceled" ? `sip_call_failed:${cause}` : null,
          );
          window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
        });
        session.on("confirmed", () => {
          setStatusSafe("in-call", null);
          window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-active"));
        });

        void (async () => {
          const localStream = await ensureLocalAudio();
          try {
            session.answer({
              mediaConstraints: { audio: true, video: false },
              ...(localStream ? { mediaStream: localStream } : {}),
            });
          } catch {
            setStatusSafe("error", "sip_answer_failed");
          }
        })();
      });

      ua.start();
      uaRef.current = ua;
    },
    [attachRemoteAudio, ensureLocalAudio, setStatusSafe],
  );

  const register = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    wssIndexRef.current = 0;

    let creds: SipCredentials;
    try {
      creds = await api.get<SipCredentials>("/sip/credentials");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setStatusSafe("unregistered", "sip_credentials_not_configured");
        return;
      }
      setStatusSafe("error", e instanceof Error ? e.message : "sip_register_failed");
      return;
    }

    void ensureLocalAudio();

    const candidates = buildWssCandidates(creds);
    startUa(creds, candidates[0] ?? `wss://app.nvoip.com.br:6443`);
  }, [enabled, ensureLocalAudio, setStatusSafe, startUa]);

  const hangup = useCallback(() => {
    sessionRef.current?.terminate();
    sessionRef.current = null;
    setStatusSafe(uaRef.current?.isRegistered() ? "registered" : "unregistered", null);
  }, [setStatusSafe]);

  useEffect(() => {
    if (!enabled) {
      uaRef.current?.stop();
      uaRef.current = null;
      sessionRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setStatusSafe("unregistered", null);
      return;
    }
    void register();
    const onRefresh = () => {
      void register();
    };
    const onPrepareMedia = () => {
      void ensureLocalAudio();
    };
    window.addEventListener("openconduit:nvoip-sip-refresh", onRefresh);
    window.addEventListener("openconduit:nvoip-sip-prepare-media", onPrepareMedia);
    return () => {
      window.removeEventListener("openconduit:nvoip-sip-refresh", onRefresh);
      window.removeEventListener("openconduit:nvoip-sip-prepare-media", onPrepareMedia);
      uaRef.current?.stop();
      uaRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      if (audioRef.current) {
        audioRef.current.srcObject = null;
        audioRef.current = null;
      }
    };
  }, [enabled, ensureLocalAudio, register, setStatusSafe]);

  return { status, error, register, hangup, isInCall: status === "in-call" || status === "ringing" };
}
