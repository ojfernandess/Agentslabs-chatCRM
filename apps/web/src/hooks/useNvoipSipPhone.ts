import { useCallback, useEffect, useRef, useState } from "react";
import JsSIP from "jssip";
import { api, ApiError } from "@/lib/api";
import { maskSipUser, sipDiag, sipDiagMessage, sipFrames } from "@/lib/sipDiagnostics";
import { repairInvite } from "@/lib/sipInviteNormalize";

const SIP_PC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
};

type SipRtcSession = {
  answer: (options: {
    mediaConstraints: { audio: boolean; video: boolean };
    mediaStream?: MediaStream;
    pcConfig?: RTCConfiguration;
  }) => void;
  terminate: (options?: { status_code?: number; reason_phrase?: string }) => void;
  direction?: string;
  connection?: RTCPeerConnection | null;
  remote_identity?: { display_name?: string; uri?: { user?: string } };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

export type NvoipSipRemoteParty = { number: string; name: string };

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

function readRemoteParty(session: SipRtcSession): NvoipSipRemoteParty {
  const number = String(session.remote_identity?.uri?.user ?? "").trim();
  const rawName = String(session.remote_identity?.display_name ?? "").trim();
  const name = rawName && rawName !== number ? rawName : "";
  return { number, name };
}

let incomingRingTimer: ReturnType<typeof setInterval> | null = null;
let incomingRingCtx: AudioContext | null = null;

function stopIncomingRing(): void {
  if (incomingRingTimer != null) {
    window.clearInterval(incomingRingTimer);
    incomingRingTimer = null;
  }
  const ctx = incomingRingCtx;
  incomingRingCtx = null;
  void ctx?.close().catch(() => {});
}

function startIncomingRing(): void {
  try {
    startIncomingRingUnsafe();
  } catch {
    sipDiag("AUDIO", "Ring unavailable");
  }
}

function startIncomingRingUnsafe(): void {
  stopIncomingRing();
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  incomingRingCtx = ctx;
  const beep = () => {
    if (incomingRingCtx !== ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  };
  void ctx.resume().then(beep).catch(() => {});
  incomingRingTimer = setInterval(() => {
    void ctx.resume().then(beep).catch(() => {});
  }, 1600);
}

function publishInboundRoute(syncOnly = false): void {
  void api
    .post<{ warning?: string | null; updated?: string[]; webphoneReleased?: boolean }>(
      "/sip/inbound-route",
      syncOnly ? { syncOnly: true } : undefined,
    )
    .then((res) => {
      if (syncOnly) return;
      if (res.webphoneReleased) sipDiag("SIP", "Panel webphone off");
      if ((res.updated ?? []).length > 0) sipDiag("SIP", `DID updated ${res.updated?.length ?? 0}`);
      else if (!res.warning) sipDiag("SIP", "DID unchanged");
      if (res.warning) sipDiag("SIP", `DID ${res.warning}`);
    })
    .catch(() => sipDiag("SIP", "DID route failed"));
}

function watchIce(pc: RTCPeerConnection): void {
  sipDiag("WEBRTC", "Creating PeerConnection");
  sipDiag("ICE", pc.iceConnectionState);
  pc.addEventListener("iceconnectionstatechange", () => {
    sipDiag("ICE", pc.iceConnectionState);
  });
}

function traceSocket(
  socket: InstanceType<typeof JsSIP.WebSocketInterface>,
  wssUrl: string,
  sipUser: string,
  inviteGate: { accepted: boolean },
): void {
  sipDiag("WSS", `Connecting ${wssUrl}`);
  const origConnect = socket.connect.bind(socket);
  socket.connect = () => {
    origConnect();
    const ws = (socket as { _ws?: WebSocket })._ws;
    if (!ws) return;
    const prevOpen = ws.onopen;
    ws.onopen = (ev) => {
      sipDiag("WSS", "Connected");
      if (typeof prevOpen === "function") prevOpen.call(ws, ev);
    };
    const prevClose = ws.onclose;
    ws.onclose = (ev) => {
      sipDiag("WSS", `Closed ${ev.code}`);
      if (typeof prevClose === "function") prevClose.call(ws, ev);
    };
    const prevMessage = ws.onmessage as
      | ((this: WebSocket, event: { data: unknown }) => void)
      | null;
    ws.onmessage = (ev) => {
      const frames = sipFrames(ev.data);
      if (frames.length === 0) return;
      for (const frame of frames) {
        const prepared = repairInvite(frame, sipUser);
        if (prepared.note) sipDiag("SIP", `INVITE fixed ${prepared.note}`);
        sipDiagMessage("in", prepared.message);
        const incomingInvite = /^INVITE\s/i.test(prepared.message);
        if (incomingInvite) inviteGate.accepted = false;
        try {
          if (typeof prevMessage === "function") prevMessage.call(ws, { data: prepared.message });
        } catch {
          if (incomingInvite) sipDiag("SIP", "INVITE error");
        }
        if (incomingInvite && !inviteGate.accepted) sipDiag("SIP", "INVITE dropped");
      }
    };
  };
  const origSend = socket.send.bind(socket);
  socket.send = (message) => {
    sipDiagMessage("out", message);
    return origSend(message);
  };
}

function beginSipCallLog(direction: "INCOMING" | "OUTGOING", phone: string): string {
  const id = crypto.randomUUID();
  void api.post("/sip/calls", { clientCallId: id, direction, phone }).catch(() => {});
  return id;
}

function finishSipCallLog(id: string, status: string, durationSec: number): void {
  void api
    .post("/sip/calls/complete", { clientCallId: id, status, durationSec })
    .catch(() => {});
}

function stableSipInstanceId(sipUser: string, sipDomain: string): string {
  const input = `${sipUser}@${sipDomain}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x811c9dc5);
  }
  const part = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const chars = (part(h1) + part(h2) + part(h1 ^ h2) + part(Math.imul(h1, h2))).slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = "8";
  const s = chars.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function sipContactUri(sipUser: string, sipDomain: string): string {
  const host = `${stableSipInstanceId(sipUser, sipDomain).replace(/-/g, "").slice(0, 12)}.invalid`;
  return `sip:${sipUser}@${host};transport=ws;ob`;
}

function buildWssCandidates(creds: SipCredentials): string[] {
  const primary = creds.wssUrl?.trim() ?? "";
  if (!primary) return [];
  const alternates = creds.wssUrlAlternates ?? [];
  return [...new Set([primary, ...alternates.map((u) => u.trim()).filter(Boolean)])];
}

export function useNvoipSipPhone(enabled: boolean) {
  const uaRef = useRef<InstanceType<typeof JsSIP.UA> | null>(null);
  const sessionRef = useRef<SipRtcSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wssIndexRef = useRef(0);
  const credsRef = useRef<SipCredentials | null>(null);
  const callLogRef = useRef<{ id: string; answeredAt: number | null } | null>(null);

  const outboundLegRef = useRef(false);
  const localEndRef = useRef(false);
  const [status, setStatus] = useState<NvoipSipCallStatus>("unregistered");
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<NvoipSipRemoteParty | null>(null);
  const [answeredAt, setAnsweredAt] = useState<number | null>(null);
  const [answering, setAnswering] = useState(false);

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
      sipDiag("AUDIO", "Remote stream attached");
      void audioRef.current.play().catch(() => sipDiag("AUDIO", "Autoplay blocked"));
    };
    peerconnection.addEventListener("track", (e) => {
      if (e.streams[0]) playStream(e.streams[0]);
    });
  }, []);

  const answerSession = useCallback(
    async (session: SipRtcSession) => {
      setAnswering(true);
      const localStream = await ensureLocalAudio();
      if (sessionRef.current !== session) {
        setAnswering(false);
        return;
      }
      try {
        session.answer({
          mediaConstraints: { audio: true, video: false },
          pcConfig: SIP_PC_CONFIG,
          ...(localStream ? { mediaStream: localStream } : {}),
        });
      } catch {
        setAnswering(false);
        setStatusSafe("error", "sip_answer_failed");
      }
    },
    [ensureLocalAudio, setStatusSafe],
  );

  const startUa = useCallback(
    (creds: SipCredentials, wssUrl: string) => {
      if (uaRef.current) {
        uaRef.current.stop();
        uaRef.current = null;
      }

      const sipDomain = creds.sipDomain?.trim() || "app.nvoip.com.br";
      const sipUser = creds.sipUser.trim();

      const socket = new JsSIP.WebSocketInterface(wssUrl);
      socket.via_transport = "WS";
      const inviteGate = { accepted: false };
      traceSocket(socket, wssUrl, sipUser, inviteGate);
      sipDiag("SOFTPHONE", "Inicializando");
      sipDiag("SIP", `User ${maskSipUser(sipUser)} Contact ${sipContactUri(sipUser, sipDomain)}`);

      // O host do Contact não pode ser o domínio do PABX: o JsSIP copia esse host
      // para o Via e o servidor tenta entregar o INVITE nele mesmo, fora do websocket.
      // Host .invalid + ;ob faz o PABX devolver a chamada na conexão WebSocket.
      // O instance id estável substitui o registro anterior do mesmo ramal.
      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${sipUser}@${sipDomain}`,
        authorization_user: sipUser,
        password: creds.sipPassword,
        display_name: creds.displayName?.trim() || sipUser,
        registrar_server: `sip:${sipDomain}`,
        contact_uri: sipContactUri(sipUser, sipDomain),
        instance_id: stableSipInstanceId(sipUser, sipDomain),
        register: true,
        register_expires: 600,
        session_timers: false,
      });

      ua.on("registered", () => {
        sipDiag("SIP", "Registered");
        setStatusSafe("registered", null);
        publishInboundRoute();
      });
      ua.on("unregistered", () => {
        sipDiag("SIP", "Unregistered");
        setStatusSafe("unregistered", null);
      });
      ua.on("registrationFailed", (e) => {
        const cause = String((e as { cause?: string }).cause ?? "unknown");
        const code = (e as { response?: { status_code?: number } }).response?.status_code;
        sipDiag("SIP", `REGISTER failed${code ? ` ${code}` : ""} ${cause}`);
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
        const session = payload.session;
        const outbound = payload.originator === "local";
        outboundLegRef.current = false;
        sessionRef.current = session;
        if (!outbound) inviteGate.accepted = true;
        sipDiag("SIP", outbound ? "Outgoing session" : "Ringing");
        try {
        if (session.connection) {
          watchIce(session.connection);
          attachRemoteAudio(session.connection);
        }
        setStatusSafe("ringing", null);

        session.on("peerconnection", (ev: unknown) => {
          const peerconnection = (ev as { peerconnection?: RTCPeerConnection }).peerconnection;
          if (!peerconnection) return;
          watchIce(peerconnection);
          attachRemoteAudio(peerconnection);
        });

        session.on("ended", () => {
          stopIncomingRing();
          const log = callLogRef.current;
          callLogRef.current = null;
          if (log) {
            const durationSec = log.answeredAt
              ? Math.max(0, Math.floor((Date.now() - log.answeredAt) / 1000))
              : 0;
            finishSipCallLog(log.id, log.answeredAt ? "ENDED" : "MISSED", durationSec);
          }
          sessionRef.current = null;
          setIncoming(null);
          publishInboundRoute(true);
          setAnsweredAt(null);
          setAnswering(false);
          setStatusSafe(ua.isRegistered() ? "registered" : "unregistered", null);
          window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
        });
        session.on("failed", (ev: unknown) => {
          stopIncomingRing();
          const log = callLogRef.current;
          callLogRef.current = null;
          const localEnd = localEndRef.current;
          if (log) {
            const durationSec = log.answeredAt
              ? Math.max(0, Math.floor((Date.now() - log.answeredAt) / 1000))
              : 0;
            const cause = String((ev as { cause?: string }).cause ?? "");
            const status = log.answeredAt
              ? "ENDED"
              : localEnd
                ? "REJECTED"
                : cause === "Canceled" || cause === "Busy"
                  ? "MISSED"
                  : "FAILED";
            finishSipCallLog(log.id, status, durationSec);
          }
          sessionRef.current = null;
          setIncoming(null);
          publishInboundRoute(true);
          setAnsweredAt(null);
          setAnswering(false);
          localEndRef.current = false;
          const failed = ev as { cause?: string; message?: { status_code?: number; reason_phrase?: string } };
          const cause = String(failed.cause ?? "unknown");
          const code = failed.message?.status_code;
          const reason = failed.message?.reason_phrase?.trim();
          const detail = [code, reason, cause].filter(Boolean).join(" ");
          const noBalance = code === 402 || code === 480;
          if (!localEnd) sipDiag("SIP", noBalance ? "No balance" : `Call failed ${detail}`);
          setStatusSafe(
            ua.isRegistered() ? "registered" : "unregistered",
            localEnd ? null : noBalance ? "sip_no_balance" : `sip_call_failed:${detail}`,
          );
          window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
        });
        session.on("confirmed", () => {
          sipDiag("SIP", "Call confirmed");
          stopIncomingRing();
          if (callLogRef.current) callLogRef.current.answeredAt = Date.now();
          setAnswering(false);
          setAnsweredAt(Date.now());
          setStatusSafe("in-call", null);
          window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-active"));
        });

        if (outbound) {
          setIncoming(null);
          return;
        }

        setIncoming(readRemoteParty(session));
        setAnsweredAt(null);
        setAnswering(false);
        setStatusSafe("ringing", null);
        startIncomingRing();
        publishInboundRoute(true);
        const remote = readRemoteParty(session).number || "inbound";
        callLogRef.current = { id: beginSipCallLog("INCOMING", remote), answeredAt: null };
        } catch {
          sipDiag("SIP", "Session handler error");
        }
      });

      ua.start();
      uaRef.current = ua;
    },
    [attachRemoteAudio, setStatusSafe],
  );

  const register = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    wssIndexRef.current = 0;

    let creds: SipCredentials;
    try {
      creds = await api.get<SipCredentials>("/sip/credentials");
      credsRef.current = creds;
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
    if (!candidates[0]) {
      setStatusSafe("unregistered", "sip_server_not_configured");
      return;
    }
    startUa(creds, candidates[0]);
  }, [enabled, ensureLocalAudio, setStatusSafe, startUa]);

  const placeCall = useCallback((rawNumber: string) => {
    const phone = rawNumber.replace(/[^\d+]/g, "");
    const creds = credsRef.current;
    const ua = uaRef.current;
    if (!phone || !creds?.sipDomain || !ua?.isRegistered()) {
      sipDiag("SIP", "Call blocked: extension is not registered");
      return false;
    }
    outboundLegRef.current = true;
    const id = crypto.randomUUID();
    callLogRef.current = { id, answeredAt: null };
    void api.post("/sip/calls", { clientCallId: id, direction: "OUTGOING", phone }).catch(() => {});
    const localStream = localStreamRef.current;
    try {
      ua.call(`sip:${phone.replace(/^\+/, "")}@${creds.sipDomain}`, {
        mediaConstraints: { audio: true, video: false },
        pcConfig: SIP_PC_CONFIG,
        ...(localStream ? { mediaStream: localStream } : {}),
      });
    } catch {
      outboundLegRef.current = false;
      callLogRef.current = null;
      setStatusSafe(ua.isRegistered() ? "registered" : "unregistered", "sip_call_failed:setup");
      return false;
    }
    return true;
  }, [setStatusSafe]);

  const hangup = useCallback(() => {
    stopIncomingRing();
    const session = sessionRef.current;
    localEndRef.current = true;
    sessionRef.current = null;
    setIncoming(null);
    setAnsweredAt(null);
    setAnswering(false);
    try {
      session?.terminate();
    } catch {
      /* session already gone */
    }
    setStatusSafe(uaRef.current?.isRegistered() ? "registered" : "unregistered", null);
  }, [setStatusSafe]);

  const reject = useCallback(() => {
    stopIncomingRing();
    const session = sessionRef.current;
    localEndRef.current = true;
    sessionRef.current = null;
    setIncoming(null);
    setAnsweredAt(null);
    setAnswering(false);
    try {
      session?.terminate({ status_code: 486, reason_phrase: "Busy Here" });
    } catch {
      try {
        session?.terminate();
      } catch {
        /* session already gone */
      }
    }
    setStatusSafe(uaRef.current?.isRegistered() ? "registered" : "unregistered", null);
  }, [setStatusSafe]);

  const answer = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || answering) return;
    await answerSession(session);
  }, [answerSession, answering]);

  useEffect(() => {
    if (!enabled) {
      stopIncomingRing();
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
    const onOutboundLeg = () => {
      outboundLegRef.current = true;
    };
    const onOutboundLegClear = () => {
      outboundLegRef.current = false;
    };
    window.addEventListener("openconduit:nvoip-sip-outbound-leg", onOutboundLeg);
    window.addEventListener("openconduit:nvoip-sip-outbound-leg-cancel", onOutboundLegClear);
    window.addEventListener("openconduit:nvoip-call-ended", onOutboundLegClear);
    window.addEventListener("openconduit:nvoip-sip-call-ended", onOutboundLegClear);
    return () => {
      window.removeEventListener("openconduit:nvoip-sip-refresh", onRefresh);
      window.removeEventListener("openconduit:nvoip-sip-prepare-media", onPrepareMedia);
      window.removeEventListener("openconduit:nvoip-sip-outbound-leg", onOutboundLeg);
      window.removeEventListener("openconduit:nvoip-sip-outbound-leg-cancel", onOutboundLegClear);
      window.removeEventListener("openconduit:nvoip-call-ended", onOutboundLegClear);
      window.removeEventListener("openconduit:nvoip-sip-call-ended", onOutboundLegClear);
      stopIncomingRing();
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

  return {
    status,
    error,
    incoming,
    answeredAt,
    answering,
    register,
    hangup,
    answer,
    reject,
    placeCall,
    isInCall: status === "in-call" || status === "ringing",
  };
}
