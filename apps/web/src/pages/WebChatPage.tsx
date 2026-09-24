import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ChangeEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import clsx from "clsx";
import {
  Bot,
  CheckCircle2,
  CheckCheck,
  Download,
  FileText,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  SendHorizonal,
  Shield,
  Smile,
} from "lucide-react";
import { VoicePreviewPanel, VoiceRecordingPanel } from "@/components/conversation/VoiceMessageComposer";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";
import { parseAudioTranscriptionBody, parseImageTranscriptionBody } from "@/lib/messagePreviewText";

/**
 * Web Chat externo (/s/:token) — continuidade da MESMA conversa.
 * Layout fixo estilo WhatsApp/Telegram; logo da organização; preview de áudio antes do envio.
 */

type PublicMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  channel: string | null;
  status: string;
  createdAt: string;
};

type SessionInfo = {
  organizationName: string;
  organizationLogoUrl: string | null;
  agentName: string | null;
  assigneeName: string | null;
  expiresAt: string;
  humanActive: boolean;
  messagesUnlocked?: boolean;
};

type ConnectionState = "CONNECTING" | "CONNECTED" | "RECONNECTING" | "OFFLINE";
type SessionErrorCode = "NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_REVOKED" | "SESSION_CLAIMED";
type SessionEndReason = "resolved" | "bot_queue" | "manual";

type SessionEndInfo = {
  endReason: SessionEndReason | null;
  agentName: string | null;
  organizationName: string;
  organizationLogoUrl: string | null;
};

type SessionFailurePayload = {
  error?: string;
  endReason?: SessionEndReason | null;
  agentName?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
};

const POLL_INTERVAL_MS = 2000;
const WEBCHAT_CLIENT_SESSION_PREFIX = "webchat_client_session:";
/** Cache em memória — mesmo segredo por aba quando localStorage falha (ex.: WhatsApp in-app). */
const webchatClientSessionCache = new Map<string, string>();
const QUICK_EMOJIS = ["😊", "👍", "🙏", "❤️", "😅", "🎉"];
const WEBCHAT_VIEWPORT =
  "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content";
const WEBCHAT_MOBILE_MAX_WIDTH_PX = 767;
const DRAFT_MIN_HEIGHT_PX = 40;
const DRAFT_MAX_HEIGHT_PX = 132;

type WebchatLayoutMode = "mobile" | "desktop";

function useWebchatLayoutMode(): WebchatLayoutMode {
  const [mode, setMode] = useState<WebchatLayoutMode>(() => {
    if (typeof window === "undefined") return "desktop";
    return window.matchMedia(`(max-width: ${WEBCHAT_MOBILE_MAX_WIDTH_PX}px)`).matches ? "mobile" : "desktop";
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${WEBCHAT_MOBILE_MAX_WIDTH_PX}px)`);
    const sync = () => setMode(mq.matches ? "mobile" : "desktop");
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return mode;
}

function getOrCreateWebchatClientSession(token: string): string {
  const trimmedToken = token.trim();
  if (!trimmedToken) return crypto.randomUUID();

  const cached = webchatClientSessionCache.get(trimmedToken);
  if (cached) return cached;

  const key = `${WEBCHAT_CLIENT_SESSION_PREFIX}${trimmedToken}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing?.trim()) {
      webchatClientSessionCache.set(trimmedToken, existing.trim());
      return existing.trim();
    }
    const secret = crypto.randomUUID();
    try {
      localStorage.setItem(key, secret);
    } catch {
      /* persistência indisponível — segredo fica só no cache da aba */
    }
    webchatClientSessionCache.set(trimmedToken, secret);
    return secret;
  } catch {
    const secret = crypto.randomUUID();
    webchatClientSessionCache.set(trimmedToken, secret);
    return secret;
  }
}

function parseSessionErrorCode(status: number, data: SessionFailurePayload | null): SessionErrorCode | null {
  if (status === 404) return "NOT_FOUND";
  if (status === 403) {
    if (data?.error === "SESSION_CLAIMED") return "SESSION_CLAIMED";
    return null;
  }
  if (status === 410) {
    return data?.error === "SESSION_REVOKED" ? "SESSION_REVOKED" : "SESSION_EXPIRED";
  }
  return null;
}

function parseSessionEndInfo(data: SessionFailurePayload | null): SessionEndInfo | null {
  if (!data || data.error !== "SESSION_REVOKED") return null;
  return {
    endReason: data.endReason ?? null,
    agentName: data.agentName ?? null,
    organizationName: data.organizationName?.trim() || "",
    organizationLogoUrl: data.organizationLogoUrl ?? null,
  };
}

function applySessionFailure(
  status: number,
  data: SessionFailurePayload | null,
  setSessionError: (code: SessionErrorCode) => void,
  setSessionEndInfo: (info: SessionEndInfo | null) => void,
) {
  const code = parseSessionErrorCode(status, data);
  if (!code) return;
  setSessionError(code);
  setSessionEndInfo(code === "SESSION_REVOKED" ? parseSessionEndInfo(data) : null);
}

function dayLabel(iso: string, todayLabel: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return todayLabel;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function timeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function fileNameFromUrl(url: string): string {
  try {
    const name = url.split("/").pop() ?? "file";
    return decodeURIComponent(name.split("?")[0] ?? name);
  } catch {
    return "file";
  }
}

function pickRecorderMimeTypes(): string[] {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
}

function createVoiceMediaRecorder(stream: MediaStream): MediaRecorder {
  if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder unsupported");
  for (const mime of pickRecorderMimeTypes()) {
    if (!MediaRecorder.isTypeSupported(mime)) continue;
    try {
      return new MediaRecorder(stream, { mimeType: mime });
    } catch {
      /* next */
    }
  }
  return new MediaRecorder(stream);
}

function canUseVoiceRecording(): boolean {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  const host = window.location.hostname.toLowerCase();
  if (!window.isSecureContext && host !== "localhost" && host !== "127.0.0.1") return false;
  return true;
}

/** Shell fixo no mobile — evita zoom do iOS e mantém header/composer visíveis com o teclado. */
function useWebchatMobileShell(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const html = document.documentElement;
    const body = document.body;
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const prevViewport = viewportMeta?.getAttribute("content") ?? null;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyWidth = body.style.width;
    const prevBodyHeight = body.style.height;
    const prevBodyTop = body.style.top;
    const prevBodyLeft = body.style.left;

    viewportMeta?.setAttribute("content", WEBCHAT_VIEWPORT);
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = "0";
    body.style.left = "0";
    body.style.width = "100%";
    body.style.height = "100%";

    const applyViewport = () => {
      const vv = window.visualViewport;
      if (!vv) {
        html.style.setProperty("--webchat-vh", "100dvh");
        html.style.setProperty("--webchat-vt", "0px");
        return;
      }
      html.style.setProperty("--webchat-vh", `${vv.height}px`);
      html.style.setProperty("--webchat-vt", `${vv.offsetTop}px`);
    };

    applyViewport();
    window.visualViewport?.addEventListener("resize", applyViewport);
    window.visualViewport?.addEventListener("scroll", applyViewport);

    return () => {
      if (prevViewport) viewportMeta?.setAttribute("content", prevViewport);
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.width = prevBodyWidth;
      body.style.height = prevBodyHeight;
      body.style.top = prevBodyTop;
      body.style.left = prevBodyLeft;
      html.style.removeProperty("--webchat-vh");
      html.style.removeProperty("--webchat-vt");
      window.visualViewport?.removeEventListener("resize", applyViewport);
      window.visualViewport?.removeEventListener("scroll", applyViewport);
    };
  }, [active]);
}

function WebchatOrgAvatar({
  logoUrl,
  label,
  className,
  onDark = false,
}: {
  logoUrl: string | null;
  label: string;
  className?: string;
  onDark?: boolean;
}) {
  const systemLogo = brandAssetUrl("/logo.svg");
  const [src, setSrc] = useState(logoUrl?.trim() || systemLogo);
  const isSystemLogo = src === systemLogo;

  useEffect(() => {
    setSrc(logoUrl?.trim() || systemLogo);
  }, [logoUrl, systemLogo]);

  return (
    <img
      src={src}
      alt={label}
      onError={() => {
        if (src !== systemLogo) setSrc(systemLogo);
      }}
      className={clsx(
        "h-9 w-9 shrink-0 rounded-full bg-white/10 object-cover ring-1 ring-white/20",
        isSystemLogo && onDark && "object-contain p-1 brightness-0 invert",
        isSystemLogo && !onDark && "bg-white object-contain p-1 ring-gray-200",
        className,
      )}
      decoding="async"
    />
  );
}

function publicVisibleMessageBody(message: PublicMessage): string | null {
  const body = message.body?.trim();
  if (!body) return null;
  if (message.type === "IMAGE" && parseImageTranscriptionBody(body)) return null;
  if (message.type === "AUDIO" && parseAudioTranscriptionBody(body)) return null;
  return body;
}

function MessageBubble({
  message,
  locale,
  t,
  orgName,
  orgLogoUrl,
  wideLayout = false,
}: {
  message: PublicMessage;
  locale: string;
  t: (path: string) => string;
  orgName: string;
  orgLogoUrl: string | null;
  wideLayout?: boolean;
}) {
  const mine = message.direction === "INBOUND";
  const read = message.status === "READ" || message.status === "DELIVERED";
  const visibleBody = publicVisibleMessageBody(message);

  return (
    <div className={clsx("flex gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine ? <WebchatOrgAvatar logoUrl={orgLogoUrl} label={orgName} onDark={false} /> : null}
      <div
        className={clsx(
          wideLayout ? "max-w-[min(72%,42rem)]" : "max-w-[min(82%,20rem)]",
          mine ? "items-end" : "items-start",
        )}
      >
        <div
          className={clsx(
            "rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug shadow-sm",
            mine
              ? "rounded-br-md bg-[#d7f4dd] text-[#1f2937]"
              : "rounded-bl-md bg-[#eef1f8] text-[#1f2937]",
          )}
        >
          {message.type === "IMAGE" && message.mediaUrl ? (
            <button
              type="button"
              className="block overflow-hidden rounded-xl"
              onClick={() => window.open(message.mediaUrl!, "_blank", "noopener,noreferrer")}
            >
              <img
                src={message.mediaUrl}
                alt=""
                className="max-h-64 w-full object-cover"
                loading="lazy"
              />
            </button>
          ) : null}

          {message.type === "AUDIO" && message.mediaUrl ? (
            <audio controls preload="metadata" className="max-w-full" src={message.mediaUrl}>
              {t("webchat.mediaMessage")}
            </audio>
          ) : null}

          {message.type === "VIDEO" && message.mediaUrl ? (
            <video controls preload="metadata" className="max-h-64 w-full rounded-xl" src={message.mediaUrl} />
          ) : null}

          {message.type === "DOCUMENT" && message.mediaUrl ? (
            <a
              href={message.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-xl border border-black/5 bg-white/80 px-3 py-2.5 text-left hover:bg-white"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <FileText className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{fileNameFromUrl(message.mediaUrl)}</span>
                <span className="text-xs text-gray-500">{message.mediaType ?? t("webchat.attachment")}</span>
              </span>
              <Download className="h-4 w-4 shrink-0 text-gray-500" />
            </a>
          ) : null}

          {visibleBody ? <p className="mt-1 whitespace-pre-wrap break-words">{visibleBody}</p> : null}

          {!visibleBody && !message.mediaUrl && message.type !== "TEXT" ? (
            <p className="italic opacity-80">{t("webchat.mediaMessage")}</p>
          ) : null}

          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-gray-500">
            <span>{timeLabel(message.createdAt, locale)}</span>
            {mine && read ? <CheckCheck className="h-3.5 w-3.5 text-sky-500" /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function WebchatDesktopShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh w-full justify-center bg-[#dadde1] md:p-3 lg:p-5">
      <div
        className={clsx(
          "flex h-dvh w-full max-w-[1600px] overflow-hidden bg-white shadow-2xl md:h-[calc(100dvh-1.5rem)] md:rounded-[4px] md:border md:border-black/10 lg:h-[calc(100dvh-2.5rem)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function WebchatDesktopSidebar({
  orgName,
  orgLogoUrl,
  headerSubtitle,
  t,
}: {
  orgName: string;
  orgLogoUrl: string | null;
  headerSubtitle: string;
  t: (path: string) => string;
}) {
  return (
    <aside className="hidden min-w-[280px] max-w-[420px] flex-col border-r border-black/5 bg-[#f0f2f5] md:flex md:w-[38%] lg:w-[34%]">
      <div className="border-b border-black/5 bg-[#008069] px-5 py-4 text-white">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/80">{t("webchat.headerTitle")}</p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
        <WebchatOrgAvatar logoUrl={orgLogoUrl} label={orgName} className="!h-24 !w-24 ring-2 ring-white" />
        <h1 className="mt-5 text-xl font-semibold text-gray-900">{orgName}</h1>
        <p className="mt-2 text-sm text-gray-600">{headerSubtitle}</p>
        <p className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">
          <Lock className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          {t("webchat.secureChat")}
        </p>
      </div>
      <div className="border-t border-black/5 px-5 py-4 text-center text-[11px] text-gray-500">
        {t("webchat.poweredBy")} <span className="font-semibold text-gray-700">OpenNexo</span>
      </div>
    </aside>
  );
}

function WebchatSessionClosedScreen({
  endInfo,
  fallbackOrgName,
  fallbackOrgLogoUrl,
  t,
  layoutMode,
}: {
  endInfo: SessionEndInfo | null;
  fallbackOrgName: string;
  fallbackOrgLogoUrl: string | null;
  t: (path: string) => string;
  layoutMode: WebchatLayoutMode;
}) {
  const orgName = endInfo?.organizationName?.trim() || fallbackOrgName;
  const orgLogoUrl = endInfo?.organizationLogoUrl ?? fallbackOrgLogoUrl;
  const agentName = endInfo?.agentName?.trim() || null;
  const isBotTransfer = endInfo?.endReason === "bot_queue";
  const isResolved = endInfo?.endReason === "resolved";

  const title = isBotTransfer
    ? t("webchat.botTransferTitle")
    : isResolved
      ? t("webchat.resolvedTitle")
      : t("webchat.revokedTitle");

  const body = isBotTransfer
    ? agentName
      ? t("webchat.botTransferBody").replaceAll("{agentName}", agentName)
      : t("webchat.botTransferBodyNoName")
    : isResolved
      ? t("webchat.resolvedBody")
      : t("webchat.revokedBody");

  const card = (
    <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg md:max-w-md md:p-10">
      <WebchatOrgAvatar logoUrl={orgLogoUrl} label={orgName} className="mx-auto !h-14 !w-14" />
      <div className="mt-5 flex justify-center">
        {isBotTransfer ? (
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 ring-4 ring-brand-100">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-200/40" aria-hidden />
            <Bot className="relative h-8 w-8 animate-bounce text-brand-600" aria-hidden />
          </span>
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-100">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
          </span>
        )}
      </div>
      <h1 className="mt-5 text-lg font-bold text-gray-900">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">{body}</p>
      {isResolved && <p className="mt-3 text-xs leading-relaxed text-gray-500">{t("webchat.whatsappHint")}</p>}
    </div>
  );

  if (layoutMode === "mobile") {
    return (
      <div
        className="fixed inset-x-0 top-0 mx-auto flex w-full max-w-lg items-center justify-center bg-[#eceff1] p-6"
        style={{
          height: "var(--webchat-vh, 100dvh)",
          transform: "translateY(var(--webchat-vt, 0px))",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {card}
      </div>
    );
  }

  return (
    <WebchatDesktopShell className="items-center justify-center bg-[#eceff1]">
      <div className="flex w-full items-center justify-center p-8">{card}</div>
    </WebchatDesktopShell>
  );
}

function WebchatGenericErrorScreen({
  sessionError,
  t,
  layoutMode,
}: {
  sessionError: SessionErrorCode;
  t: (path: string) => string;
  layoutMode: WebchatLayoutMode;
}) {
  const card = (
    <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg md:max-w-md md:p-10">
      <WebchatOrgAvatar logoUrl={null} label="OpenNexo" className="mx-auto" />
      <h1 className="mt-4 text-lg font-bold text-gray-900">
        {sessionError === "SESSION_EXPIRED"
          ? t("webchat.expiredTitle")
          : sessionError === "SESSION_CLAIMED"
            ? t("webchat.claimedTitle")
            : t("webchat.notFoundTitle")}
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {sessionError === "SESSION_EXPIRED"
          ? t("webchat.expiredBody")
          : sessionError === "SESSION_CLAIMED"
            ? t("webchat.claimedBody")
            : t("webchat.notFoundBody")}
      </p>
    </div>
  );

  if (layoutMode === "mobile") {
    return (
      <div
        className="fixed inset-x-0 top-0 mx-auto flex w-full max-w-lg items-center justify-center bg-[#eceff1] p-6"
        style={{
          height: "var(--webchat-vh, 100dvh)",
          transform: "translateY(var(--webchat-vt, 0px))",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {card}
      </div>
    );
  }

  return (
    <WebchatDesktopShell className="items-center justify-center bg-[#eceff1]">
      <div className="flex w-full items-center justify-center p-8">{card}</div>
    </WebchatDesktopShell>
  );
}

export default function WebChatPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, locale } = useI18n();
  const layoutMode = useWebchatLayoutMode();
  const isMobileLayout = layoutMode === "mobile";
  const localeTag = locale === "pt-BR" ? "pt-BR" : "en";
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<SessionErrorCode | null>(null);
  const [sessionEndInfo, setSessionEndInfo] = useState<SessionEndInfo | null>(null);
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("CONNECTING");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [humanActive, setHumanActive] = useState(false);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [messagesUnlocked, setMessagesUnlocked] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voicePreview, setVoicePreview] = useState<{ blob: Blob; ext: string } | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const lastCreatedAtRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const clientSessionRef = useRef<string | null>(null);
  const messagesUnlockedRef = useRef(false);

  const webchatAuthHeaders = useCallback(
    (extra?: HeadersInit): HeadersInit => {
      if (!clientSessionRef.current) {
        clientSessionRef.current = getOrCreateWebchatClientSession(token);
      }
      return {
        ...extra,
        "X-Webchat-Client-Session": clientSessionRef.current,
      };
    },
    [token],
  );

  useEffect(() => {
    clientSessionRef.current = null;
    messagesUnlockedRef.current = false;
    setMessagesUnlocked(false);
    setSessionEndInfo(null);
  }, [token]);

  useWebchatMobileShell(!sessionError && isMobileLayout);

  const orgName = session?.organizationName ?? t("webchat.headerTitle");
  const orgLogoUrl = session?.organizationLogoUrl ?? null;

  const voicePreviewUrl = useMemo(
    () => (voicePreview ? URL.createObjectURL(voicePreview.blob) : null),
    [voicePreview],
  );

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    };
  }, [voicePreviewUrl]);

  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const adjustDraftHeight = useCallback(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(Math.max(el.scrollHeight, DRAFT_MIN_HEIGHT_PX), DRAFT_MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > DRAFT_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    adjustDraftHeight();
  }, [draft, adjustDraftHeight]);

  const base = `/api/v1/public/webchat/${encodeURIComponent(token)}`;

  const shellStyle = isMobileLayout
    ? ({
        height: "var(--webchat-vh, 100dvh)",
        transform: "translateY(var(--webchat-vt, 0px))",
      } as const)
    : undefined;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current || messages.length === 0) return;
    scrollToBottom("auto");
  }, [messages, scrollToBottom]);

  const mergeMessages = useCallback((incoming: PublicMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return prev;
      const next = [...prev, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      lastCreatedAtRef.current = next[next.length - 1]?.createdAt ?? lastCreatedAtRef.current;
      return next;
    });
  }, []);

  useEffect(() => {
    messagesUnlockedRef.current = messagesUnlocked;
  }, [messagesUnlocked]);

  const reloadMessageHistory = useCallback(async () => {
    const res = await fetch(`${base}/messages`, { headers: webchatAuthHeaders() });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      messages: PublicMessage[];
      messagesUnlocked?: boolean;
      humanActive: boolean;
      assigneeName?: string | null;
    };
    const unlocked = data.messagesUnlocked !== false;
    messagesUnlockedRef.current = unlocked;
    setMessagesUnlocked(unlocked);
    setMessages(data.messages);
    lastCreatedAtRef.current = data.messages[data.messages.length - 1]?.createdAt ?? null;
    setHumanActive(Boolean(data.humanActive));
    if (data.assigneeName !== undefined) setAssigneeName(data.assigneeName);
    stickToBottomRef.current = true;
    return true;
  }, [base, webchatAuthHeaders]);

  const pollNewMessages = useCallback(async () => {
    if (!messagesUnlockedRef.current) return;
    try {
      const since = lastCreatedAtRef.current;
      const res = await fetch(
        `${base}/messages${since ? `?since=${encodeURIComponent(since)}` : ""}`,
        { headers: webchatAuthHeaders() },
      );
      if (!res.ok) {
        if (res.status === 410 || res.status === 403) {
          const data = (await res.json().catch(() => null)) as SessionFailurePayload | null;
          applySessionFailure(res.status, data, setSessionError, setSessionEndInfo);
          return;
        }
        setConnection("RECONNECTING");
        return;
      }
      const data = (await res.json()) as {
        messages: PublicMessage[];
        humanActive: boolean;
        assigneeName?: string | null;
      };
      setHumanActive(Boolean(data.humanActive));
      if (data.assigneeName !== undefined) setAssigneeName(data.assigneeName);
      if (data.messages.length > 0) stickToBottomRef.current = true;
      mergeMessages(data.messages);
      setConnection("CONNECTED");
    } catch {
      setConnection(navigator.onLine ? "RECONNECTING" : "OFFLINE");
    }
  }, [base, mergeMessages, webchatAuthHeaders]);

  const postMessage = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: webchatAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (res.status === 410 || res.status === 403) {
        const data = (await res.json().catch(() => null)) as SessionFailurePayload | null;
        applySessionFailure(res.status, data, setSessionError, setSessionEndInfo);
        return null;
      }
      if (!res.ok) {
        setConnection("RECONNECTING");
        return null;
      }
      const data = (await res.json()) as { message: PublicMessage; messagesUnlocked?: boolean };
      if (!messagesUnlockedRef.current) {
        messagesUnlockedRef.current = true;
        setMessagesUnlocked(true);
        await reloadMessageHistory();
      } else {
        stickToBottomRef.current = true;
        mergeMessages([data.message]);
        void pollNewMessages();
      }
      return data.message;
    },
    [base, mergeMessages, pollNewMessages, reloadMessageHistory, webchatAuthHeaders],
  );

  const uploadFile = useCallback(
    async (file: Blob, filename: string, audio = false) => {
      const form = new FormData();
      form.append("file", file, filename);
      const res = await fetch(`${base}/${audio ? "upload-audio" : "upload-media"}`, {
        method: "POST",
        headers: webchatAuthHeaders(),
        body: form,
      });
      if (res.status === 403 || res.status === 410) {
        const data = (await res.json().catch(() => null)) as SessionFailurePayload | null;
        applySessionFailure(res.status, data, setSessionError, setSessionEndInfo);
        throw new Error(data?.error ?? "session error");
      }
      if (!res.ok) throw new Error("upload failed");
      return (await res.json()) as { mediaUrl: string; mimeType: string };
    },
    [base, webchatAuthHeaders],
  );

  useEffect(() => {
    let cancelled = false;
    stickToBottomRef.current = true;
    void (async () => {
      try {
        const sres = await fetch(`${base}/session`, { headers: webchatAuthHeaders() });
        if (!sres.ok) {
          const data = (await sres.json().catch(() => null)) as SessionFailurePayload | null;
          if (!cancelled) applySessionFailure(sres.status, data, setSessionError, setSessionEndInfo);
          return;
        }
        const sdata = (await sres.json()) as SessionInfo & {
          humanActive: boolean;
          assigneeName?: string | null;
          messagesUnlocked?: boolean;
        };
        const mres = await fetch(`${base}/messages`, { headers: webchatAuthHeaders() });
        if (mres.status === 403 || mres.status === 410) {
          const data = (await mres.json().catch(() => null)) as SessionFailurePayload | null;
          if (!cancelled) applySessionFailure(mres.status, data, setSessionError, setSessionEndInfo);
          return;
        }
        const mdata = mres.ok
          ? ((await mres.json()) as {
              messages: PublicMessage[];
              humanActive: boolean;
              assigneeName?: string | null;
              messagesUnlocked?: boolean;
            })
          : { messages: [], humanActive: false, assigneeName: null, messagesUnlocked: false };
        if (cancelled) return;
        const unlocked = Boolean(sdata.messagesUnlocked ?? mdata.messagesUnlocked);
        messagesUnlockedRef.current = unlocked;
        setMessagesUnlocked(unlocked);
        setSession(sdata);
        setHumanActive(unlocked && Boolean(sdata.humanActive || mdata.humanActive));
        setAssigneeName(unlocked ? (sdata.assigneeName ?? mdata.assigneeName ?? null) : null);
        setMessages(unlocked ? mdata.messages : []);
        if (unlocked && mdata.messages.length > 0) {
          lastCreatedAtRef.current = mdata.messages[mdata.messages.length - 1]?.createdAt ?? null;
        }
        setConnection("CONNECTED");
      } catch {
        if (!cancelled) setConnection(navigator.onLine ? "RECONNECTING" : "OFFLINE");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, mergeMessages, webchatAuthHeaders]);

  useEffect(() => {
    if (!session || sessionError || !messagesUnlocked) return;
    const timer = window.setInterval(() => {
      void pollNewMessages();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [session, sessionError, messagesUnlocked, pollNewMessages]);

  useEffect(() => {
    const onOnline = () => setConnection((c) => (c === "OFFLINE" ? "RECONNECTING" : c));
    const onOffline = () => setConnection("OFFLINE");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const sendText = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const content = draft.trim();
      if (!content || sending || uploading || voicePreview || recording) return;
      setSending(true);
      try {
        const ok = await postMessage({ content });
        if (ok) setDraft("");
      } finally {
        setSending(false);
      }
    },
    [draft, sending, uploading, voicePreview, recording, postMessage],
  );

  const sendAttachment = useCallback(
    async (file: File) => {
      if (uploading || sending || voicePreview || recording) return;
      setUploading(true);
      try {
        const isAudio = file.type.startsWith("audio/") || file.type === "video/webm";
        const uploaded = await uploadFile(file, file.name, isAudio);
        const type = file.type.startsWith("image/")
          ? "IMAGE"
          : isAudio
            ? "AUDIO"
            : file.type.startsWith("video/")
              ? "VIDEO"
              : "DOCUMENT";
        await postMessage({
          mediaUrl: uploaded.mediaUrl,
          mediaType: uploaded.mimeType,
          type,
          content: draft.trim() || undefined,
        });
        setDraft("");
      } catch {
        setConnection("RECONNECTING");
      } finally {
        setUploading(false);
      }
    },
    [uploading, sending, voicePreview, recording, uploadFile, postMessage, draft],
  );

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void sendAttachment(file);
    },
    [sendAttachment],
  );

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setVoiceBusy(true);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    try {
      const blobType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      chunksRef.current = [];
      if (blob.size < 1) return;
      const ext = blobType.includes("ogg") ? "ogg" : blobType.includes("mp4") || blobType.includes("aac") ? "m4a" : "webm";
      setVoicePreview({ blob, ext });
    } finally {
      setVoiceBusy(false);
    }
  }, []);

  const sendVoiceFromPreview = useCallback(async () => {
    if (!voicePreview || voiceBusy) return;
    setVoiceBusy(true);
    try {
      const uploaded = await uploadFile(voicePreview.blob, `voice.${voicePreview.ext}`, true);
      await postMessage({
        mediaUrl: uploaded.mediaUrl,
        mediaType: uploaded.mimeType,
        type: "AUDIO",
      });
      setVoicePreview(null);
    } catch {
      setConnection("RECONNECTING");
    } finally {
      setVoiceBusy(false);
    }
  }, [voicePreview, voiceBusy, uploadFile, postMessage]);

  const startRecording = useCallback(async () => {
    if (recording || voicePreview || voiceBusy || !canUseVoiceRecording()) return;
    if (voicePreview) setVoicePreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = createVoiceMediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      /* mic denied */
    }
  }, [recording, voicePreview, voiceBusy]);

  const grouped = useMemo(() => {
    const groups: Array<{ day: string; items: PublicMessage[] }> = [];
    for (const m of messages) {
      const day = dayLabel(m.createdAt, t("webchat.today"), localeTag);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(m);
      else groups.push({ day, items: [m] });
    }
    return groups;
  }, [messages, localeTag, t]);

  const headerSubtitle = useMemo(() => {
    if (connection === "CONNECTING") return t("webchat.connecting");
    if (connection === "RECONNECTING") return t("webchat.reconnecting");
    if (connection === "OFFLINE") return t("webchat.offline");
    if (assigneeName) return assigneeName;
    if (humanActive) return t("webchat.humanActive");
    return t("webchat.onlineTitle");
  }, [connection, assigneeName, humanActive, t]);

  if (sessionError === "SESSION_REVOKED") {
    return (
      <WebchatSessionClosedScreen
        endInfo={sessionEndInfo}
        fallbackOrgName={orgName}
        fallbackOrgLogoUrl={orgLogoUrl}
        t={t}
        layoutMode={layoutMode}
      />
    );
  }

  if (sessionError) {
    return <WebchatGenericErrorScreen sessionError={sessionError} t={t} layoutMode={layoutMode} />;
  }

  const chatPanel = (
    <div
      className={clsx(
        "flex min-h-0 flex-col overflow-hidden bg-[#f4f6f8]",
        isMobileLayout && "fixed inset-x-0 top-0 z-10 mx-auto w-full max-w-lg shadow-2xl",
        !isMobileLayout && "h-full min-w-0 flex-1",
      )}
      style={shellStyle}
    >
      <header
        className={clsx(
          "shrink-0 bg-[#008069] text-white shadow-sm",
          isMobileLayout ? "px-3 py-2 pt-[max(0.45rem,env(safe-area-inset-top))]" : "px-4 py-3",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <WebchatOrgAvatar logoUrl={orgLogoUrl} label={orgName} onDark className="!h-10 !w-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">{orgName}</p>
            <p className="truncate text-[13px] leading-tight text-white/75">{headerSubtitle}</p>
          </div>
          <div
            className="flex shrink-0 items-center gap-1 text-[10px] font-medium leading-tight text-white/90"
            title={t("webchat.secureChat")}
          >
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className={clsx(!isMobileLayout && "hidden sm:inline")}>{t("webchat.secureChat")}</span>
          </div>
        </div>
      </header>

      <div
        ref={listRef}
        onScroll={onListScroll}
        className={clsx(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4",
          !isMobileLayout && "bg-[#efeae2] md:px-8 md:py-5",
        )}
        style={
          !isMobileLayout
            ? {
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='%23d9d2ca' fill-opacity='0.45'%3E%3Ccircle cx='12' cy='18' r='2'/%3E%3Ccircle cx='58' cy='42' r='1.5'/%3E%3Ccircle cx='92' cy='14' r='1.5'/%3E%3Ccircle cx='34' cy='88' r='2'/%3E%3Ccircle cx='88' cy='76' r='1.5'/%3E%3C/g%3E%3C/svg%3E\")",
              }
            : undefined
        }
      >
        {grouped.map((group) => (
          <div key={group.day} className="space-y-3">
            <div className="flex justify-center py-1">
              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm">
                {group.day}
              </span>
            </div>
            {group.items.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                locale={localeTag}
                t={t}
                orgName={orgName}
                orgLogoUrl={orgLogoUrl}
                wideLayout={!isMobileLayout}
              />
            ))}
          </div>
        ))}
        {messages.length === 0 && connection === "CONNECTED" ? (
          <p className="py-10 text-center text-sm text-gray-500">
            {messagesUnlocked ? t("webchat.emptyState") : t("webchat.lockedHistory")}
          </p>
        ) : null}
        <div ref={messagesEndRef} aria-hidden className="h-px shrink-0" />
      </div>

      <form
        onSubmit={sendText}
        className={clsx(
          "min-w-0 shrink-0 border-t border-black/5 bg-white px-3 py-3",
          !isMobileLayout && "md:px-5 md:py-4",
        )}
      >
        {recording ? (
          <VoiceRecordingPanel seconds={recordingSeconds} onStop={() => void finishRecording()} />
        ) : voicePreview && voicePreviewUrl ? (
          <VoicePreviewPanel
            previewUrl={voicePreviewUrl}
            busy={voiceBusy}
            onDiscard={() => setVoicePreview(null)}
            onSend={() => void sendVoiceFromPreview()}
          />
        ) : (
          <>
            {emojiOpen ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded-lg px-2 py-1 text-lg hover:bg-gray-100"
                    onClick={() => setDraft((d) => `${d}${emoji}`)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex w-full min-w-0 items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,audio/*,video/*,application/pdf,.doc,.docx"
                onChange={onFileChange}
              />
              <div className="flex min-h-[48px] min-w-0 flex-1 items-end gap-1 rounded-[22px] border border-gray-200 bg-white px-2 py-1 shadow-sm">
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
                  aria-label={t("webchat.attachLabel")}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || sending || voiceBusy}
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                </button>
                <textarea
                  ref={draftRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendText();
                    }
                  }}
                  rows={1}
                  placeholder={t("webchat.inputPlaceholder")}
                  aria-label={t("webchat.inputPlaceholder")}
                  enterKeyHint="send"
                  inputMode="text"
                  className="max-h-[132px] min-h-[40px] min-w-0 flex-1 resize-none overflow-hidden bg-transparent px-1 py-2 text-base leading-snug text-gray-900 outline-none"
                />
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
                  aria-label={t("webchat.emojiLabel")}
                  onClick={() => setEmojiOpen((v) => !v)}
                >
                  <Smile className="h-5 w-5" />
                </button>
                {canUseVoiceRecording() ? (
                  <button
                    type="button"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
                    aria-label={t("webchat.recordVoice")}
                    onClick={() => void startRecording()}
                    disabled={uploading || sending || voiceBusy}
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={sending || uploading || voiceBusy || !draft.trim()}
                aria-label={t("webchat.sendLabel")}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1fa855] text-white shadow-md transition hover:bg-[#199648] disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
              </button>
            </div>
          </>
        )}
      </form>

      <footer
        className={clsx(
          "flex shrink-0 items-center justify-between gap-3 border-t border-black/5 bg-[#f8faf9] px-4 py-2.5 text-[11px] text-gray-600",
          !isMobileLayout && "md:px-5",
          isMobileLayout && "pb-[max(0.625rem,env(safe-area-inset-bottom))]",
        )}
      >
        <p className="flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {t("webchat.securityFooter")}
        </p>
        <p className="shrink-0">
          {t("webchat.poweredBy")} <span className="font-semibold text-gray-800">OpenNexo</span>
        </p>
      </footer>
    </div>
  );

  if (isMobileLayout) {
    return chatPanel;
  }

  return (
    <WebchatDesktopShell>
      <WebchatDesktopSidebar
        orgName={orgName}
        orgLogoUrl={orgLogoUrl}
        headerSubtitle={headerSubtitle}
        t={t}
      />
      {chatPanel}
    </WebchatDesktopShell>
  );
}
