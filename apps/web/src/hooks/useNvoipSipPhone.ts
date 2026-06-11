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
  sipServer: string;
  wssPort: string;
};

export function useNvoipSipPhone(enabled: boolean) {
  const uaRef = useRef<InstanceType<typeof JsSIP.UA> | null>(null);
  const sessionRef = useRef<SipRtcSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [status, setStatus] = useState<NvoipSipCallStatus>("unregistered");
  const [error, setError] = useState<string | null>(null);

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
        setStatus("unregistered");
        setError("sip_credentials_not_configured");
        return;
      }
      setStatus("error");
      setError(e instanceof Error ? e.message : "sip_register_failed");
      return;
    }

    if (uaRef.current) {
      uaRef.current.stop();
      uaRef.current = null;
    }

    const socket = new JsSIP.WebSocketInterface(
      `wss://${creds.sipServer}:${creds.wssPort}`,
    );

    const ua = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${creds.sipUser}@${creds.sipServer}`,
      password: creds.sipPassword,
      display_name: creds.displayName?.trim() || creds.sipUser,
      register: true,
    });

    ua.on("registered", () => setStatus("registered"));
    ua.on("unregistered", () => setStatus("unregistered"));
    ua.on("registrationFailed", (e) => {
      setStatus("error");
      setError(`sip_registration_failed:${String((e as { cause?: string }).cause ?? "unknown")}`);
    });

    ua.on("newRTCSession", (data: unknown) => {
      const session = (data as { session: SipRtcSession }).session;
      sessionRef.current = session;
      setStatus("ringing");

      session.on("ended", () => {
        sessionRef.current = null;
        setStatus(ua.isRegistered() ? "registered" : "unregistered");
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
      });
      session.on("failed", () => {
        sessionRef.current = null;
        setStatus(ua.isRegistered() ? "registered" : "unregistered");
        window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
      });
      session.on("confirmed", () => {
        setStatus("in-call");
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
  }, [attachRemoteAudio, enabled]);

  const hangup = useCallback(() => {
    sessionRef.current?.terminate();
    sessionRef.current = null;
    setStatus(uaRef.current?.isRegistered() ? "registered" : "unregistered");
  }, []);

  useEffect(() => {
    if (!enabled) {
      uaRef.current?.stop();
      uaRef.current = null;
      sessionRef.current = null;
      setStatus("unregistered");
      setError(null);
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
  }, [enabled, register]);

  return { status, error, register, hangup, isInCall: status === "in-call" || status === "ringing" };
}
