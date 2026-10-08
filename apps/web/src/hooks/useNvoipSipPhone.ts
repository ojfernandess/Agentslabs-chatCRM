import { useCallback, useEffect, useRef, useState } from "react";
import JsSIP from "jssip";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { maskSipUser, sipDiag, sipDiagMessage, sipFrames } from "@/lib/sipDiagnostics";
import { shouldDropSipLegAnsweredElsewhere, shouldQueueIncomingCall, sipEndAction, sipSessionOccupiesLine } from "@/lib/sipCallControls";
import { normalizeSipRingtone, previewSipRingtone, startSipRingtone, stopSipRingtone, type SipRingtoneId } from "@/lib/sipRingtone";
import { callerFromInvite, callIdFromSip, inviteFault, lookupInviteCaller, rememberInviteCaller, repairInvite } from "@/lib/sipInviteNormalize";
import { canClaimSipTab, parseSipTabOwner } from "@/lib/sipTabOwner";

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
  sendRequest: (method: string) => void;
  mute: (options?: { audio?: boolean; video?: boolean }) => void;
  unmute: (options?: { audio?: boolean; video?: boolean }) => void;
  isMuted: () => { audio: boolean; video: boolean };
  isEnded: () => boolean;
  isEstablished: () => boolean;
  sendDTMF: (tones: string) => void;
  id?: string;
  status: number;
  direction?: string;
  connection?: RTCPeerConnection | null;
  remote_identity?: { display_name?: string; uri?: { user?: string } };
  _request?: { call_id?: string };
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

const SIP_TAB_OWNER_KEY = "openconduit:sip-tab-owner";
const SIP_NOTIFY_ASKED_KEY = "openconduit:sip-notify-asked";

type SipTabCommand = "answer" | "reject" | "hangup" | "mute" | "dial" | "dtmf" | "resume";

export type NvoipSipRemoteParty = { number: string; name: string };

export type NvoipSipQueuedCall = {
  id: string;
  number: string;
  name: string;
  held: boolean;
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
  ringTone?: string;
  callDistribution?: boolean;
};

function emitSipStatus(status: NvoipSipCallStatus, error: string | null): void {
  window.dispatchEvent(
    new CustomEvent("openconduit:nvoip-sip-status", { detail: { status, error } }),
  );
}

function cloneAudioStream(stream: MediaStream | null): MediaStream | null {
  if (!stream) return null;
  const next = new MediaStream();
  for (const track of stream.getAudioTracks()) {
    if (track.readyState === "live") next.addTrack(track.clone());
  }
  return next.getAudioTracks().length > 0 ? next : null;
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

function hiddenCaller(value: string): boolean {
  return /^(anonymous|unavailable|restricted|unknown|hidden|private)$/i.test(value.trim());
}

let localSipUser = "";

function isAgentExtension(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  const local = localSipUser.replace(/\D/g, "");
  return digits.length > 0 && local.length > 0 && digits === local;
}

function phoneFromLabel(value: string): string {
  if (!value || hiddenCaller(value)) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return value.trim().startsWith("+") ? `+${digits}` : digits;
}

function readRemoteParty(session: SipRtcSession): NvoipSipRemoteParty {
  const number = String(session.remote_identity?.uri?.user ?? "").trim();
  const rawName = String(session.remote_identity?.display_name ?? "").trim();
  const remembered = session._request?.call_id ? lookupInviteCaller(session._request.call_id) : null;
  const usable = (value: string) => !!value && !hiddenCaller(value) && !isAgentExtension(value);
  const visibleNumber =
    [remembered?.number ?? "", phoneFromLabel(rawName), number].find((value) => usable(value)) ?? "";
  const rememberedName = remembered?.name && !hiddenCaller(remembered.name) ? remembered.name : "";
  const name =
    rawName && !hiddenCaller(rawName) && rawName !== visibleNumber && phoneFromLabel(rawName) !== visibleNumber
      ? rawName
      : rememberedName && rememberedName !== visibleNumber
        ? rememberedName
        : "";
  return { number: visibleNumber, name };
}

let incomingRingTone: SipRingtoneId = "classic";

function stopIncomingRing(): void {
  stopSipRingtone();
}

function startIncomingRing(): void {
  try {
    startSipRingtone(incomingRingTone);
  } catch {
    sipDiag("AUDIO", "Ring unavailable");
  }
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

const STATUS_WAITING_FOR_ACK = 6;

/** O 200 já abriu o áudio. Sem o ACK, o JsSIP derruba a chamada em 32s. */
function keepAnsweredCall(session: SipRtcSession): void {
  const timers = (session as SipRtcSession & {
    _timers?: { ackTimer: number | null; invite2xxTimer: number | null };
  })._timers;
  if (!timers) return;
  if (timers.ackTimer != null) window.clearTimeout(timers.ackTimer);
  timers.ackTimer = window.setTimeout(() => {
    if (session.isEnded() || session.status !== STATUS_WAITING_FOR_ACK) return;
    if (timers.invite2xxTimer != null) {
      window.clearTimeout(timers.invite2xxTimer);
      timers.invite2xxTimer = null;
    }
    timers.ackTimer = null;
  }, 32_000);
}

const remoteClosing = new WeakSet<SipRtcSession>();

function endSessionFromRemote(session: SipRtcSession): void {
  if (session.isEnded() || remoteClosing.has(session)) return;
  remoteClosing.add(session);
  try {
    session.terminate();
  } catch {
    /* a sessão já estava encerrando */
  }
}

function setOutboundAudioEnabled(session: SipRtcSession, enabled: boolean, fallback?: MediaStream | null): void {
  const senderTracks =
    session.connection
      ?.getSenders()
      .map((sender) => sender.track)
      .filter((track): track is MediaStreamTrack => !!track && track.kind === "audio") ?? [];
  const tracks = senderTracks.length > 0 ? senderTracks : (fallback?.getAudioTracks() ?? []);
  for (const track of tracks) {
    if (track.readyState === "live") track.enabled = enabled;
  }
}

function watchIce(pc: RTCPeerConnection, session: SipRtcSession): void {
  sipDiag("WEBRTC", "Creating PeerConnection");
  sipDiag("ICE", pc.iceConnectionState);
  const finishIfDead = () => {
    sipDiag("ICE", pc.iceConnectionState);
    const ice = pc.iceConnectionState;
    const conn = pc.connectionState;
    if (ice === "failed" || ice === "closed" || conn === "failed" || conn === "closed") {
      endSessionFromRemote(session);
    }
  };
  pc.addEventListener("iceconnectionstatechange", finishIfDead);
  pc.addEventListener("connectionstatechange", finishIfDead);
}

function traceSocket(
  socket: InstanceType<typeof JsSIP.WebSocketInterface>,
  wssUrl: string,
  sipUser: string,
  inviteGate: { accepted: boolean },
): void {
  localSipUser = sipUser;
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
    const deliver = (data: unknown) => {
      const frames = sipFrames(data);
      if (frames.length === 0) return;
      for (const frame of frames) {
        if (/^INVITE\s/i.test(frame)) {
          rememberInviteCaller(callIdFromSip(frame), callerFromInvite(frame, sipUser));
        }
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
        if (/^(BYE|CANCEL)\s/i.test(prepared.message)) {
          const callId = callIdFromSip(prepared.message);
          const method = /^CANCEL\s/i.test(prepared.message) ? "CANCEL" : "BYE";
          if (callId) {
            window.dispatchEvent(new CustomEvent("openconduit:sip-remote-end", { detail: { callId, method } }));
          }
        }
        if (incomingInvite && !inviteGate.accepted) {
          const fault = inviteFault(prepared.message);
          sipDiag("SIP", fault ? `INVITE dropped ${fault}` : "INVITE dropped");
        }
      }
    };
    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof Blob !== "undefined" && data instanceof Blob) {
        void data.text().then((text) => deliver(text)).catch(() => {
          sipDiag("SIP", "Frame unreadable");
        });
        return;
      }
      deliver(data);
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

function readSipTabOwner(): { tabId: string; at: number } | null {
  try {
    return parseSipTabOwner(localStorage.getItem(SIP_TAB_OWNER_KEY));
  } catch {
    return null;
  }
}

function writeSipTabOwner(tabId: string): void {
  try {
    localStorage.setItem(SIP_TAB_OWNER_KEY, JSON.stringify({ tabId, at: Date.now() }));
  } catch {
    /* storage indisponível */
  }
}

function clearSipTabOwner(tabId: string): void {
  try {
    if (readSipTabOwner()?.tabId === tabId) localStorage.removeItem(SIP_TAB_OWNER_KEY);
  } catch {
    /* storage indisponível */
  }
}

let incomingNotice: Notification | null = null;

function closeIncomingNotice(): void {
  incomingNotice?.close();
  incomingNotice = null;
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

type SipCallSlot = {
  id: string;
  session: SipRtcSession;
  party: NvoipSipRemoteParty;
  logId: string;
  answeredAt: number | null;
  startedAt: number;
  inbound: boolean;
};

export function useNvoipSipPhone(enabled: boolean) {
  const { t } = useI18n();
  const { user } = useAuth();
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const uaRef = useRef<InstanceType<typeof JsSIP.UA> | null>(null);
  const sessionRef = useRef<SipRtcSession | null>(null);
  const tabIdRef = useRef(crypto.randomUUID());
  const leaderRef = useRef(true);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wssIndexRef = useRef(0);
  const credsRef = useRef<SipCredentials | null>(null);
  const callLogRef = useRef<{ id: string; answeredAt: number | null } | null>(null);
  const waitingRef = useRef<SipCallSlot[]>([]);
  const heldRef = useRef<SipCallSlot[]>([]);
  const activeSlotRef = useRef<SipCallSlot | null>(null);
  const slotIdsRef = useRef(new WeakMap<SipRtcSession, string>());
  const localEndIdsRef = useRef(new Set<string>());
  const answeredElsewhereIdsRef = useRef(new Set<string>());
  const announcedCallsRef = useRef(new Set<string>());
  const publishTakenRef = useRef<(session: SipRtcSession, kind: "answer" | "end") => void>(() => {});
  const callDistributionRef = useRef(false);
  const distributionBySessionRef = useRef(new WeakMap<SipRtcSession, string>());

  const outboundLegRef = useRef(false);
  const localEndRef = useRef(false);
  const answeredElsewhereRef = useRef(false);
  const [status, setStatus] = useState<NvoipSipCallStatus>("unregistered");
  const [distributionEnabled, setDistributionEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<NvoipSipRemoteParty | null>(null);
  const [queue, setQueue] = useState<NvoipSipQueuedCall[]>([]);
  const [answeredAt, setAnsweredAt] = useState<number | null>(null);
  const [answering, setAnswering] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const setMutedSafe = useCallback((value: boolean) => {
    mutedRef.current = value;
    setMuted(value);
  }, []);

  const setStatusSafe = useCallback((next: NvoipSipCallStatus, err: string | null = null) => {
    setStatus(next);
    setError(err);
    emitSipStatus(next, err);
  }, []);

  publishTakenRef.current = (session, kind) => {
    const slot = [activeSlotRef.current, ...waitingRef.current, ...heldRef.current].find(
      (item) => item?.session === session,
    );
    if (session.direction === "outgoing" || slot?.inbound === false) return;
    const callId = session._request?.call_id || session.id || "";
    const caller = (slot?.party.number ?? "").replace(/\D/g, "").slice(0, 32);
    const startedAt = slot?.startedAt ?? 0;
    const sipCallId = (callId.length >= 8 ? callId : session.id || "").slice(0, 256);
    if (sipCallId.length < 8) return;
    const token = `${kind}:${sipCallId}:${caller}`;
    if (announcedCallsRef.current.has(token)) return;
    announcedCallsRef.current.add(token);
    void api
      .post("/sip/calls/answered", {
        sipCallId,
        ...(caller.length >= 8 ? { caller } : {}),
        ...(startedAt > 0 ? { startedAt } : {}),
      })
      .catch(() => {});
  };

  const ensureLocalAudio = useCallback(async () => {
    const stream = await acquireLocalAudio(localStreamRef.current);
    if (stream) localStreamRef.current = stream;
    return stream;
  }, []);

  const releaseCallMedia = useCallback(() => {
    stopIncomingRing();
    closeIncomingNotice();
    setMutedSafe(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, [setMutedSafe]);

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

  const publishQueue = useCallback(() => {
    const held = heldRef.current.map((slot) => ({
      id: slot.id,
      number: slot.party.number,
      name: slot.party.name,
      held: true,
    }));
    const waiting = waitingRef.current.map((slot) => ({
      id: slot.id,
      number: slot.party.number,
      name: slot.party.name,
      held: false,
    }));
    setQueue([...held, ...waiting]);
  }, []);

  const playSessionAudio = useCallback((session: SipRtcSession) => {
    const pc = session.connection;
    if (!pc) return;
    const tracks = pc
      .getReceivers()
      .map((receiver) => receiver.track)
      .filter((track) => track && track.kind === "audio" && track.readyState === "live");
    if (!tracks.length) return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.autoplay = true;
    }
    audioRef.current.srcObject = new MediaStream(tracks);
    void audioRef.current.play().catch(() => sipDiag("AUDIO", "Autoplay blocked"));
  }, []);

  const answerSession = useCallback(
    async (session: SipRtcSession) => {
      setAnswering(true);
      stopIncomingRing();
      const localStream = await ensureLocalAudio();
      if (localEndRef.current || sessionRef.current !== session) {
        setAnswering(false);
        const current = sessionRef.current;
        if (current && current !== session && !current.isEnded() && !current.isEstablished()) startIncomingRing();
        return;
      }
      const sharing = heldRef.current.some((slot) => !slot.session.isEnded());
      const media = sharing ? cloneAudioStream(localStream) ?? localStream : localStream;
      try {
        session.answer({
          mediaConstraints: { audio: true, video: false },
          pcConfig: SIP_PC_CONFIG,
          ...(media ? { mediaStream: media } : {}),
        });
      } catch {
        setAnswering(false);
        if (!session.isEnded() && !session.isEstablished() && sessionRef.current === session) startIncomingRing();
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

      const rememberId = (session: SipRtcSession) => {
        const known = session.id || slotIdsRef.current.get(session);
        if (known) return known;
        const created = crypto.randomUUID();
        slotIdsRef.current.set(session, created);
        return created;
      };

      const promoteNextCall = () => {
        const nextHeld = heldRef.current.find((slot) => !slot.session.isEnded());
        if (nextHeld) {
          heldRef.current = heldRef.current.filter((slot) => slot !== nextHeld);
          sessionRef.current = nextHeld.session;
          activeSlotRef.current = nextHeld;
          callLogRef.current = { id: nextHeld.logId, answeredAt: nextHeld.answeredAt };
          try {
            nextHeld.session.unmute({ audio: true, video: false });
          } catch {
            /* o áudio local desta chamada já foi liberado */
          }
          playSessionAudio(nextHeld.session);
          setIncoming(nextHeld.party);
          setAnsweredAt(nextHeld.answeredAt);
          setAnswering(false);
          setMutedSafe(false);
          setStatusSafe("in-call", null);
          publishQueue();
          return true;
        }
        const nextWait = waitingRef.current.find((slot) => !slot.session.isEnded());
        if (nextWait) {
          waitingRef.current = waitingRef.current.filter((slot) => slot !== nextWait);
          sessionRef.current = nextWait.session;
          activeSlotRef.current = nextWait;
          callLogRef.current = { id: nextWait.logId, answeredAt: null };
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.srcObject = null;
          }
          setIncoming(nextWait.party);
          setAnsweredAt(null);
          setAnswering(false);
          setMutedSafe(false);
          setStatusSafe("ringing", null);
          startIncomingRing();
          publishQueue();
          return true;
        }
        return false;
      };

      ua.on("newRTCSession", (data: unknown) => {
        const payload = data as { originator?: string; session: SipRtcSession };
        const session = payload.session;
        const outbound = payload.originator === "local";
        if (!outbound) inviteGate.accepted = true;

        const closeSession = (kind: "ended" | "failed", ev?: unknown) => {
          const slot =
            activeSlotRef.current?.session === session
              ? activeSlotRef.current
              : waitingRef.current.find((item) => item.session === session) ??
                heldRef.current.find((item) => item.session === session) ??
                null;
          const active = sessionRef.current === session;
          waitingRef.current = waitingRef.current.filter((item) => item.session !== session);
          heldRef.current = heldRef.current.filter((item) => item.session !== session);
          if (activeSlotRef.current?.session === session) activeSlotRef.current = null;
          const log = active
            ? callLogRef.current
            : slot
              ? { id: slot.logId, answeredAt: slot.answeredAt }
              : null;
          if (active) callLogRef.current = null;
          const id = rememberId(session);
          const localEnd = localEndIdsRef.current.has(id) || (active && localEndRef.current);
          localEndIdsRef.current.delete(id);
          const distributionId = distributionBySessionRef.current.get(session);
          if (distributionId) {
            distributionBySessionRef.current.delete(session);
            const distributionStatus = log?.answeredAt ? "ENDED" : localEnd ? "REJECTED" : "MISSED";
            void api.post("/sip/distribution/result", { distributionId, status: distributionStatus }).catch(() => {});
          }
          const answeredElsewhere =
            answeredElsewhereIdsRef.current.has(id) || (active && answeredElsewhereRef.current);
          answeredElsewhereIdsRef.current.delete(id);
          if (active) {
            answeredElsewhereRef.current = false;
            localEndRef.current = false;
          }
          const failed = ev as { cause?: string; message?: { status_code?: number; reason_phrase?: string } } | undefined;
          const cause = String(failed?.cause ?? (kind === "ended" ? "" : "unknown"));
          const code = failed?.message?.status_code;
          if (log) {
            const durationSec = log.answeredAt
              ? Math.max(0, Math.floor((Date.now() - log.answeredAt) / 1000))
              : 0;
            const logStatus = log.answeredAt
              ? "ENDED"
              : answeredElsewhere || cause === "Canceled" || cause === "Busy" || code === 487
                ? "MISSED"
                : localEnd
                  ? "REJECTED"
                  : kind === "ended"
                    ? "MISSED"
                    : "FAILED";
            finishSipCallLog(log.id, logStatus, durationSec);
          }
          if (!active) {
            publishQueue();
            const focused = sessionRef.current;
            const focusedRinging = !!focused && !focused.isEnded() && !focused.isEstablished();
            if (!focusedRinging && waitingRef.current.length === 0) stopIncomingRing();
            return;
          }
          sessionRef.current = null;
          if (promoteNextCall()) return;
          releaseCallMedia();
          setIncoming(null);
          publishInboundRoute(true);
          setAnsweredAt(null);
          setAnswering(false);
          publishQueue();
          const reason = failed?.message?.reason_phrase?.trim();
          const detail = [code, reason, cause].filter(Boolean).join(" ");
          const taken = answeredElsewhere || cause === "Canceled" || cause === "Busy" || code === 487;
          const noBalance = kind === "failed" && !taken && (code === 402 || code === 480);
          if (kind === "failed" && !localEnd && !taken) {
            sipDiag("SIP", noBalance ? "No balance" : `Call failed ${detail}`);
          }
          setStatusSafe(
            ua.isRegistered() ? "registered" : "unregistered",
            kind === "ended" || localEnd || taken ? null : noBalance ? "sip_no_balance" : `sip_call_failed:${detail}`,
          );
          window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-ended"));
        };

        const watchSession = () => {
          if (session.connection) {
            watchIce(session.connection, session);
            attachRemoteAudio(session.connection);
          }
          session.on("peerconnection", (ev: unknown) => {
            const peerconnection = (ev as { peerconnection?: RTCPeerConnection }).peerconnection;
            if (!peerconnection) return;
            watchIce(peerconnection, session);
            attachRemoteAudio(peerconnection);
          });
          const announceAnswered = () => publishTakenRef.current(session, "answer");
          const reportDistributionAnswered = () => {
            const distributionId = distributionBySessionRef.current.get(session);
            if (!distributionId) return;
            void api.post("/sip/distribution/result", { distributionId, status: "ANSWERED" }).catch(() => {});
          };
          const markLive = () => {
            if (sessionRef.current !== session) return;
            stopIncomingRing();
            const at =
              (activeSlotRef.current?.session === session ? activeSlotRef.current.answeredAt : null) ??
              callLogRef.current?.answeredAt ??
              Date.now();
            if (activeSlotRef.current?.session === session) activeSlotRef.current.answeredAt = at;
            if (callLogRef.current) callLogRef.current.answeredAt = at;
            setAnswering(false);
            setAnsweredAt(at);
            setStatusSafe("in-call", null);
            window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-call-active"));
          };
          session.on("ended", () => closeSession("ended"));
          session.on("failed", (ev: unknown) => closeSession("failed", ev));
          session.on("accepted", () => {
            announceAnswered();
            reportDistributionAnswered();
            keepAnsweredCall(session);
            sipDiag("SIP", "Call accepted");
            markLive();
          });
          session.on("confirmed", () => {
            announceAnswered();
            sipDiag("SIP", "Call confirmed");
            markLive();
          });
        };

        const deliverSession = () => {
        const current = sessionRef.current;
        if (outbound && current && current !== session && sipSessionOccupiesLine(current)) {
          sipDiag("SIP", "Line busy");
          try {
            session.terminate();
          } catch {
            /* a segunda perna já encerrou */
          }
          return;
        }
        if (!outbound && shouldQueueIncomingCall(current) && current !== session) {
          sipDiag("SIP", "Queued call");
          try {
            const party = readRemoteParty(session);
            const slot: SipCallSlot = {
              id: rememberId(session),
              session,
              party,
              logId: beginSipCallLog("INCOMING", party.number || "inbound"),
              answeredAt: null,
              startedAt: Date.now(),
              inbound: true,
            };
            waitingRef.current = [...waitingRef.current, slot];
            watchSession();
            publishQueue();
            if (current?.isEstablished()) previewSipRingtone(incomingRingTone);
            publishInboundRoute(true);
          } catch {
            sipDiag("SIP", "Session handler error");
          }
          return;
        }

        outboundLegRef.current = false;
        sessionRef.current = session;
        sipDiag("SIP", outbound ? "Outgoing session" : "Ringing");
        try {
          watchSession();
          if (outbound) {
            const party = readRemoteParty(session);
            activeSlotRef.current = {
              id: rememberId(session),
              session,
              party,
              logId: callLogRef.current?.id ?? beginSipCallLog("OUTGOING", party.number || "outbound"),
              answeredAt: null,
              startedAt: Date.now(),
              inbound: false,
            };
            setIncoming(null);
            setStatusSafe("ringing", null);
            return;
          }
          const party = readRemoteParty(session);
          const logId = beginSipCallLog("INCOMING", party.number || "inbound");
          activeSlotRef.current = {
            id: rememberId(session),
            session,
            party,
            logId,
            answeredAt: null,
            startedAt: Date.now(),
            inbound: true,
          };
          callLogRef.current = { id: logId, answeredAt: null };
          setIncoming(party);
          setAnsweredAt(null);
          setAnswering(false);
          setStatusSafe("ringing", null);
          startIncomingRing();
          publishInboundRoute(true);
        } catch {
          sipDiag("SIP", "Session handler error");
        }
        };

        if (!outbound && callDistributionRef.current) {
          const party = readRemoteParty(session);
          const sipCallId = (session._request?.call_id || session.id || crypto.randomUUID()).slice(0, 256);
          const postedId = sipCallId.length >= 8 ? sipCallId : `dist-${sipCallId}`.padEnd(8, "0").slice(0, 256);
          void api
            .post<{ ring: boolean; distributionId: string | null }>("/sip/distribution/claim", {
              sipCallId: postedId,
              caller: (party.number || "").slice(0, 32),
            })
            .then((decision) => {
              if (session.isEnded()) return;
              if (!decision.ring) {
                try {
                  session.terminate({ status_code: 480, reason_phrase: "Temporarily Unavailable" });
                } catch {
                  /* a perna já encerrou */
                }
                return;
              }
              if (decision.distributionId) distributionBySessionRef.current.set(session, decision.distributionId);
              deliverSession();
            })
            .catch(() => {
              if (!session.isEnded()) deliverSession();
            });
          return;
        }
        deliverSession();
      });

      ua.start();
      uaRef.current = ua;
    },
    [attachRemoteAudio, playSessionAudio, publishQueue, releaseCallMedia, setStatusSafe],
  );

  const register = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    wssIndexRef.current = 0;

    let creds: SipCredentials;
    try {
      creds = await api.get<SipCredentials>("/sip/credentials");
      incomingRingTone = normalizeSipRingtone(creds.ringTone);
      callDistributionRef.current = creds.callDistribution === true;
      setDistributionEnabled(creds.callDistribution === true);
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

  useEffect(() => {
    if (!distributionEnabled) return;
    const state = status === "in-call" || status === "ringing" ? "busy" : status === "registered" ? "registered" : "offline";
    void api.post("/sip/presence", { state }).catch(() => {});
    if (state === "offline") return;
    const timer = window.setInterval(() => {
      const next = status === "in-call" || status === "ringing" ? "busy" : "registered";
      void api.post("/sip/presence", { state: next }).catch(() => {});
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [distributionEnabled, status]);

  const placeCall = useCallback((rawNumber: string) => {
    const phone = rawNumber.replace(/[^\d+]/g, "");
    if (!leaderRef.current) {
      if (!phone) return false;
      channelRef.current?.postMessage({ type: "cmd", tabId: tabIdRef.current, cmd: "dial", number: phone });
      return true;
    }
    const creds = credsRef.current;
    const ua = uaRef.current;
    if (!phone || !creds?.sipDomain || !ua?.isRegistered()) {
      sipDiag("SIP", "Call blocked: extension is not registered");
      return false;
    }
    const live = sessionRef.current;
    if (
      (live && sipSessionOccupiesLine(live)) ||
      waitingRef.current.length > 0 ||
      heldRef.current.length > 0
    ) {
      sipDiag("SIP", "Line busy");
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

  const postCommand = useCallback((cmd: SipTabCommand, extra?: { number?: string; tone?: string; callId?: string }) => {
    channelRef.current?.postMessage({ type: "cmd", tabId: tabIdRef.current, cmd, ...extra });
  }, []);

  const endLiveSession = useCallback((mode: "hangup" | "reject", target?: SipRtcSession) => {
    if (!leaderRef.current && !target) {
      postCommand(mode);
      return;
    }
    const session = target ?? sessionRef.current;
    const endingFocused = !target || target === sessionRef.current;
    if (endingFocused) stopIncomingRing();
    if (!session) {
      setAnswering(false);
      return;
    }
    const id = session.id || slotIdsRef.current.get(session);
    if (id) localEndIdsRef.current.add(id);
    if (endingFocused) localEndRef.current = true;
    const action = mode === "reject" && !session.isEstablished() ? "reject" : sipEndAction(session);
    if (action === "ignore") return;
    if (action === "bye") publishTakenRef.current(session, "end");
    try {
      if (action === "reject") session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
      else if (action === "bye") {
        sipDiag("SIP", "Sending BYE");
        if (session.status === 6) {
          try {
            session.sendRequest("BYE");
          } catch {
            sipDiag("SIP", "BYE request failed");
          }
        }
        if (!session.isEnded()) session.terminate();
      } else session.terminate();
    } catch {
      sipDiag("SIP", "Hangup failed");
    }
  }, [postCommand]);

  const hangup = useCallback(() => {
    endLiveSession("hangup");
  }, [endLiveSession]);

  const focusSlot = useCallback(async (slot: SipCallSlot) => {
    const current = sessionRef.current;
    const active = activeSlotRef.current;
    if (current && active && current !== slot.session && !current.isEnded()) {
      const parked = { ...active, answeredAt: callLogRef.current?.answeredAt ?? active.answeredAt };
      if (current.isEstablished()) {
        try {
          current.mute({ audio: true, video: false });
        } catch {
          /* a chamada atual não aceitou mudo */
        }
        heldRef.current = [...heldRef.current.filter((item) => item.id !== parked.id), parked];
      } else {
        waitingRef.current = [parked, ...waitingRef.current.filter((item) => item.id !== parked.id)];
      }
    }
    waitingRef.current = waitingRef.current.filter((item) => item.id !== slot.id);
    heldRef.current = heldRef.current.filter((item) => item.id !== slot.id);
    sessionRef.current = slot.session;
    activeSlotRef.current = slot;
    callLogRef.current = { id: slot.logId, answeredAt: slot.answeredAt };
    setIncoming(slot.party);
    setMutedSafe(false);
    publishQueue();
    if (slot.session.isEstablished()) {
      try {
        slot.session.unmute({ audio: true, video: false });
      } catch {
        /* a chamada em espera segue muda */
      }
      playSessionAudio(slot.session);
      setAnswering(false);
      setAnsweredAt(slot.answeredAt);
      setStatusSafe("in-call", null);
      if (waitingRef.current.length === 0) stopIncomingRing();
      return;
    }
    setAnsweredAt(null);
    setStatusSafe("ringing", null);
    await answerSession(slot.session);
  }, [answerSession, playSessionAudio, publishQueue, setStatusSafe]);

  const reject = useCallback((callId?: string) => {
    if (!leaderRef.current) {
      postCommand("reject", callId ? { callId } : undefined);
      return;
    }
    if (callId) {
      const held = heldRef.current.find((item) => item.id === callId);
      const waiting = waitingRef.current.find((item) => item.id === callId);
      const slot = held ?? waiting;
      if (slot) {
        endLiveSession(held ? "hangup" : "reject", slot.session);
        return;
      }
    }
    endLiveSession("reject");
  }, [endLiveSession, postCommand]);

  const answer = useCallback(async (callId?: string) => {
    if (!leaderRef.current) {
      postCommand("answer", callId ? { callId } : undefined);
      return;
    }
    if (answering) return;
    if (callId) {
      const slot =
        waitingRef.current.find((item) => item.id === callId) ??
        heldRef.current.find((item) => item.id === callId);
      if (slot) {
        await focusSlot(slot);
        return;
      }
    }
    const session = sessionRef.current;
    if (!session) return;
    await answerSession(session);
  }, [answerSession, answering, focusSlot, postCommand]);

  const resumeQueued = useCallback(async (callId: string) => {
    if (!leaderRef.current) {
      postCommand("resume", { callId });
      return;
    }
    const slot = heldRef.current.find((item) => item.id === callId);
    if (!slot || answering) return;
    await focusSlot(slot);
  }, [answering, focusSlot, postCommand]);

  const toggleMute = useCallback(() => {
    if (!leaderRef.current) {
      postCommand("mute");
      return;
    }
    const session = sessionRef.current;
    if (!session || session.isEnded()) return;
    const nextMuted = !mutedRef.current;
    try {
      if (nextMuted) session.mute({ audio: true, video: false });
      else session.unmute({ audio: true, video: false });
    } catch {
      sipDiag("AUDIO", "Mute unavailable");
    }
    setOutboundAudioEnabled(session, !nextMuted, localStreamRef.current);
    setMutedSafe(nextMuted);
  }, [postCommand, setMutedSafe]);

  const sendDtmf = useCallback((tone: string) => {
    const digit = tone.trim();
    if (!digit) return;
    if (!leaderRef.current) {
      postCommand("dtmf", { tone: digit });
      return;
    }
    const session = sessionRef.current;
    if (!session?.isEstablished() || session.isEnded()) return;
    try {
      session.sendDTMF(digit);
    } catch {
      sipDiag("SIP", "DTMF unavailable");
    }
  }, [postCommand]);

  const requestCallAlerts = useCallback(async () => {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    try {
      if (localStorage.getItem(SIP_NOTIFY_ASKED_KEY) === "1") return;
      localStorage.setItem(SIP_NOTIFY_ASKED_KEY, "1");
    } catch {
      return;
    }
    try {
      await Notification.requestPermission();
    } catch {
      /* o navegador recusou o pedido */
    }
  }, []);

  const controlsRef = useRef({
    answer: async (_callId?: string) => {},
    reject: (_callId?: string) => {},
    hangup: () => {},
    toggleMute: () => {},
    placeCall: (_number: string) => false as boolean,
    sendDtmf: (_tone: string) => {},
    resume: async (_callId: string) => {},
  });
  controlsRef.current = { answer, reject, hangup, toggleMute, placeCall, sendDtmf, resume: resumeQueued };
  const snapshotRef = useRef({ status, error, incoming, answeredAt, answering, muted, queue });
  snapshotRef.current = { status, error, incoming, answeredAt, answering, muted, queue };

  useEffect(() => {
    if (!leaderRef.current) return;
    channelRef.current?.postMessage({
      type: "state",
      tabId: tabIdRef.current,
      status,
      error,
      incoming,
      answeredAt,
      answering,
      muted,
      queue,
    });
  }, [answeredAt, answering, error, incoming, muted, queue, status]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") closeIncomingNotice();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const onRemoteEnd = (event: Event) => {
      const detail = (event as CustomEvent<{ callId?: string; method?: string }>).detail;
      const callId = detail?.callId?.trim();
      if (!callId) return;
      const sessions = [
        sessionRef.current,
        ...waitingRef.current.map((slot) => slot.session),
        ...heldRef.current.map((slot) => slot.session),
      ];
      for (const session of sessions) {
        if (!session || session._request?.call_id !== callId) continue;
        if (detail?.method === "CANCEL" && (session.isEstablished() || session.status === STATUS_WAITING_FOR_ACK)) continue;
        endSessionFromRemote(session);
      }
    };
    window.addEventListener("openconduit:sip-remote-end", onRemoteEnd);
    return () => window.removeEventListener("openconduit:sip-remote-end", onRemoteEnd);
  }, []);

  useEffect(() => {
    const onAnsweredElsewhere = (event: Event) => {
      const detail = (event as CustomEvent<{
        sipCallId?: string;
        userId?: string;
        caller?: string;
        startedAt?: number;
      }>).detail;
      const ringing = [
        ...(activeSlotRef.current && !activeSlotRef.current.session.isEnded() && !activeSlotRef.current.session.isEstablished()
          ? [activeSlotRef.current]
          : []),
        ...waitingRef.current,
      ];
      for (const slot of ringing) {
        if (
          !shouldDropSipLegAnsweredElsewhere({
            localUserId: userIdRef.current,
            answeredByUserId: detail?.userId,
            localDialogId: slot.session.id ?? null,
            localCallId: slot.session._request?.call_id ?? null,
            answeredDialogId: detail?.sipCallId,
            localCaller: slot.party.number,
            answeredCaller: detail?.caller,
            localStartedAt: slot.startedAt,
            answeredStartedAt: detail?.startedAt,
            localStatus: slot.session.status,
          })
        ) {
          continue;
        }
        answeredElsewhereIdsRef.current.add(slot.id);
        localEndIdsRef.current.add(slot.id);
        if (slot.session === sessionRef.current) {
          answeredElsewhereRef.current = true;
          localEndRef.current = true;
          stopIncomingRing();
          closeIncomingNotice();
        }
        try {
          if (!slot.session.isEnded()) {
            slot.session.terminate({ status_code: 487, reason_phrase: "Request Terminated" });
          }
        } catch {
          /* a perna já foi cancelada */
        }
      }
    };
    window.addEventListener("openconduit:sip-call-answered", onAnsweredElsewhere);
    return () => window.removeEventListener("openconduit:sip-call-answered", onAnsweredElsewhere);
  }, []);

  useEffect(() => {
    const waiting = queue.filter((item) => !item.held);
    const caller = status === "ringing" && incoming ? incoming : waiting[waiting.length - 1];
    if (!caller || !leaderRef.current) {
      closeIncomingNotice();
      return;
    }
    if (document.visibilityState === "visible") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const body = [caller.name, caller.number].filter(Boolean).join("\n");
    const notice = new Notification(t("nvoip.softphone.notifyTitle"), {
      body,
      tag: "openconduit-sip-call",
    });
    incomingNotice = notice;
    notice.onclick = () => {
      window.focus();
      window.dispatchEvent(new CustomEvent("openconduit:nvoip-sip-focus"));
      notice.close();
    };
    return () => notice.close();
  }, [incoming, queue, status, t]);

  useEffect(() => {
    if (!enabled) {
      stopIncomingRing();
      closeIncomingNotice();
      uaRef.current?.stop();
      uaRef.current = null;
      sessionRef.current = null;
      waitingRef.current = [];
      heldRef.current = [];
      activeSlotRef.current = null;
      setQueue([]);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setStatusSafe("unregistered", null);
      return;
    }
    const tabId = tabIdRef.current;
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("openconduit-sip");
    channelRef.current = channel;
    const claim = () => {
      if (!channel) return true;
      if (canClaimSipTab(Date.now(), readSipTabOwner(), tabId)) {
        writeSipTabOwner(tabId);
        return readSipTabOwner()?.tabId === tabId;
      }
      return false;
    };
    leaderRef.current = claim();
    if (leaderRef.current) void register();
    const publish = () => {
      if (!leaderRef.current || !channel) return;
      channel.postMessage({ type: "state", tabId, ...snapshotRef.current });
    };
    const beat = window.setInterval(() => {
      if (leaderRef.current) {
        writeSipTabOwner(tabId);
        publish();
        return;
      }
      if (!canClaimSipTab(Date.now(), readSipTabOwner(), tabId)) return;
      if (!claim()) return;
      leaderRef.current = true;
      void register();
    }, 2000);
    const onChannel = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        tabId?: string;
        cmd?: SipTabCommand;
        number?: string;
        tone?: string;
        callId?: string;
        status?: NvoipSipCallStatus;
        error?: string | null;
        incoming?: NvoipSipRemoteParty | null;
        queue?: NvoipSipQueuedCall[];
        answeredAt?: number | null;
        answering?: boolean;
        muted?: boolean;
      };
      if (!data || data.tabId === tabId) return;
      if (data.type === "hello" && leaderRef.current) {
        publish();
        return;
      }
      if (data.type === "cmd" && leaderRef.current) {
        if (data.cmd === "answer") void controlsRef.current.answer(data.callId);
        else if (data.cmd === "reject") controlsRef.current.reject(data.callId);
        else if (data.cmd === "hangup") controlsRef.current.hangup();
        else if (data.cmd === "mute") controlsRef.current.toggleMute();
        else if (data.cmd === "dial" && data.number) controlsRef.current.placeCall(data.number);
        else if (data.cmd === "dtmf" && data.tone) controlsRef.current.sendDtmf(data.tone);
        else if (data.cmd === "resume" && data.callId) void controlsRef.current.resume(data.callId);
        return;
      }
      if (data.type === "state" && !leaderRef.current && data.status) {
        setStatusSafe(data.status, data.error ?? null);
        setIncoming(data.incoming ?? null);
        setQueue(data.queue ?? []);
        setAnsweredAt(data.answeredAt ?? null);
        setAnswering(data.answering === true);
        setMutedSafe(data.muted === true);
      }
    };
    channel?.addEventListener("message", onChannel);
    if (!leaderRef.current) channel?.postMessage({ type: "hello", tabId });
    const onRefresh = () => {
      if (leaderRef.current) void register();
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
      window.clearInterval(beat);
      channel?.removeEventListener("message", onChannel);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
      if (leaderRef.current) clearSipTabOwner(tabId);
      closeIncomingNotice();
      stopIncomingRing();
      uaRef.current?.stop();
      uaRef.current = null;
      sessionRef.current = null;
      waitingRef.current = [];
      heldRef.current = [];
      activeSlotRef.current = null;
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
    queue,
    answeredAt,
    answering,
    muted,
    register,
    hangup,
    answer,
    reject,
    resumeQueued,
    toggleMute,
    sendDtmf,
    requestCallAlerts,
    placeCall,
    isInCall: status === "in-call" || status === "ringing",
  };
}
