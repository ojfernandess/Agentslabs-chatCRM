import { useCallback, useEffect, useRef, useState } from "react";
import JsSIP from "jssip";
import { api, ApiError } from "@/lib/api";

type SipRtcSession = {
  answer: (options: { mediaConstraints: { audio: boolean; video: boolean } }) => void;
  terminate: () => void;
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
};

function emitSipStatus(status: NvoipSipCallStatus, error: string | null): void {
  window.dispatchEvent(
    new CustomEvent("openconduit:nvoip-sip-status", { detail: { status, error } }),
  );
}

export function useNvoipSipPhone(enabled: boolean) {
  const uaRef = useRef<InstanceType<typeof JsSIP.UA> | null>(null);
  const sessionRef = useRef<SipRtcSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [status, setStatus] = useState<NvoipSipCallStatus>("unregistered");
  const [error, setError] = useState<string | null>(null);

  const setStatusSafe = useCallback((next: NvoipSipCallStatus, err: string | null = null) => {
    setStatus(next);
    setError(err);
    emitSipStatus(next, err);
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

  const register = useCallback(async () => {
    if (!enabled) return;
    setError(null);

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

    if (uaRef.current) {
      uaRef.current.stop();
      uaRef.current = null;
    }

    const wssUrl = creds.wssUrl?.trim() || `wss://${creds.sipDomain}:6443`;
    const sipDomain = creds.sipDomain?.trim() || "sip.nvoip.com.br";
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

    ua.on("connected", () => {
      setStatusSafe("unregistered", null);
    });
    ua.on("disconnected", () => setStatusSafe("unregistered", null));
    ua.on("registered", () => setStatusSafe("registered", null));
    ua.on("unregistered", () => setStatusSafe("unregistered", null));
    ua.on("registrationFailed", (e) => {
      setStatusSafe(
        "error",
        `sip_registration_failed:${String((e as { cause?: string }).cause ?? "unknown")}`,
      );
    });

    ua.on("newRTCSession", (data: unknown) => {
      const session = (data as { session: SipRtcSession }).session;
      sessionRef.current = session;
      setStatusSafe("ringing", null);

      session.on("ended", () => {
        sessionRef.current = null;
        setStatusSafe(ua.isRegistered() ? "registered" : "unregistered", null);
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
      });
      session.on("failed", () => {
        sessionRef.current = null;
        setStatusSafe(ua.isRegistered() ? "registered" : "unregistered", null);
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
      });
      session.on("confirmed", () => {
        setStatusSafe("in-call", null);
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-active"));
      });

      session.on("peerconnection", (ev: unknown) => {
        const peerconnection = (ev as { peerconnection?: RTCPeerConnection }).peerconnection;
        if (peerconnection) attachRemoteAudio(peerconnection);
      });

      session.answer({
        mediaConstraints: { audio: true, video: false },
      });
    });

    ua.start();
    uaRef.current = ua;
  }, [attachRemoteAudio, enabled, setStatusSafe]);

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
      setStatusSafe("unregistered", null);
      return;
    }
    void register();
    const onRefresh = () => {
      void register();
    };
    window.addEventListener("openconduit:nvoip-sip-refresh", onRefresh);
    return () => {
      window.removeEventListener("openconduit:nvoip-sip-refresh", onRefresh);
      uaRef.current?.stop();
      uaRef.current = null;
      if (audioRef.current) {
        audioRef.current.srcObject = null;
        audioRef.current = null;
      }
    };
  }, [enabled, register, setStatusSafe]);

  return { status, error, register, hangup, isInCall: status === "in-call" || status === "ringing" };
}
