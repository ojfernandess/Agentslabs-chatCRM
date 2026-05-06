import { useState, useEffect, useRef, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Send, ArrowLeft, Clock, User, AlertTriangle, CheckCircle, PauseCircle, RotateCcw, Mic, Square, Paperclip, ImagePlus, Lock } from "lucide-react";
import clsx from "clsx";
import { format, differenceInHours } from "date-fns";
import { motion, AnimatePresence, backdropVariants, modalVariants } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";

interface Message {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isPrivate?: boolean;
  status: string;
  sentAt: string;
  createdAt: string;
}

interface LeadTypeRow {
  id: string;
  name: string;
  color: string;
}

interface ConversationDetail {
  id: string;
  status: string;
  closureReason: string | null;
  closureValue?: number | null;
  leadType: LeadTypeRow | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    assignedTo?: { id: string; name: string } | null;
    createdBy?: { id: string; name: string } | null;
  };
  team: { id: string; name: string } | null;
  messages?: Message[];
}

export function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [leadTypes, setLeadTypes] = useState<LeadTypeRow[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [closureReason, setClosureReason] = useState("");
  const [closureAmount, setClosureAmount] = useState("");
  const [leadTypeId, setLeadTypeId] = useState("");
  const [resolveError, setResolveError] = useState("");
  const [flowError, setFlowError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [teamPickerId, setTeamPickerId] = useState("");
  const [evolutionRichChat, setEvolutionRichChat] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [privateNote, setPrivateNote] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seenMessageIds = useRef(new Set<string>());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  const loadConversation = async () => {
    try {
      const data = await api.get<ConversationDetail>(`/conversations/${id}`);
      setConversation(data);
      setTeamPickerId(data.team?.id ?? "");
    } catch {
      /* failed */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    async function loadChannel() {
      try {
        const ch = await api.get<{ evolutionRichChat: boolean }>("/settings/channel");
        setEvolutionRichChat(ch.evolutionRichChat);
      } catch {
        setEvolutionRichChat(false);
      }
    }
    void loadChannel();
  }, []);

  useEffect(() => {
    async function loadLeadTypes() {
      try {
        const rows = await api.get<LeadTypeRow[]>("/lead-types");
        setLeadTypes(rows);
      } catch {
        /* ignore */
      }
    }
    loadLeadTypes();
  }, []);

  useEffect(() => {
    if (!tenantAdmin) return;
    async function loadTeams() {
      try {
        const res = await api.get<{ data: { id: string; name: string }[] }>("/teams");
        setTeamOptions(res.data.map((x) => ({ id: x.id, name: x.name })));
      } catch {
        setTeamOptions([]);
      }
    }
    void loadTeams();
  }, [tenantAdmin]);

  useEffect(() => {
    loadConversation();
    const interval = setInterval(loadConversation, 5000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

  const lastInbound = conversation?.messages?.filter((m) => m.direction === "INBOUND").at(-1);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
      style: "currency",
      currency: locale === "pt-BR" ? "BRL" : "USD",
    }).format(n);

  const isOutsideWindow = lastInbound
    ? differenceInHours(new Date(), new Date(lastInbound.createdAt)) > 24
    : true;

  useEffect(() => {
    return () => {
      const mr = mediaRecorderRef.current;
      if (mr?.state === "recording") {
        mr.stop();
      }
      mr?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function pickRecorderMimeTypes(): string[] {
    const ua = navigator.userAgent.toLowerCase();
    const appleLike =
      /iphone|ipad|ipod/.test(ua) ||
      ua.includes("mac os") ||
      (navigator.platform?.toLowerCase().includes("mac") ?? false);
    const base = appleLike
      ? ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of base) {
      if (!seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
    return out;
  }

  function createVoiceMediaRecorder(stream: MediaStream): MediaRecorder {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder unsupported");
    }
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

  async function handleVoiceToggle() {
    if (!conversation || isOutsideWindow || voiceBusy) return;

    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      return;
    }

    if (!canUseVoiceRecording()) {
      setFlowError(t("conversationDetail.voiceNeedsHttps"));
      return;
    }

    const contactId = conversation.contact.id;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = createVoiceMediaRecorder(stream);
      mediaChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setRecording(false);
        const blobType = mr.mimeType || "audio/webm";
        const ext = blobType.includes("mp4") || blobType.includes("aac") ? "m4a" : "webm";
        const blob = new Blob(mediaChunksRef.current, { type: blobType });
        mediaChunksRef.current = [];
        if (blob.size < 1) return;
        setVoiceBusy(true);
        setFlowError("");
        try {
          const { mediaUrl, mimeType } = await api.uploadMessageAudio(blob, `voice.${ext}`);
          await api.post("/messages", {
            contactId,
            type: "AUDIO",
            mediaUrl,
            mediaType: mimeType,
          });
          await loadConversation();
        } catch {
          setFlowError(t("conversationDetail.voiceSendFailed"));
        } finally {
          setVoiceBusy(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setFlowError(t("conversationDetail.voicePermissionDenied"));
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setFlowError(t("conversationDetail.voiceNoMic"));
      } else {
        setFlowError(t("conversationDetail.voiceNotSupported"));
      }
    }
  }

  const sendAttachment = async (file: File) => {
    if (!conversation) return;
    const kind: "IMAGE" | "DOCUMENT" = file.type.startsWith("image/") ? "IMAGE" : "DOCUMENT";
    setAttachBusy(true);
    setFlowError("");
    try {
      const { mediaUrl, mimeType } = await api.uploadMessageMedia(file);
      await api.post("/messages", {
        contactId: conversation.contact.id,
        type: kind,
        mediaUrl,
        mediaType: mimeType,
        body: newMessage.trim() || undefined,
        isPrivate: privateNote || undefined,
      });
      setNewMessage("");
      await loadConversation();
    } catch {
      setFlowError(t("conversationDetail.attachFailed"));
    } finally {
      setAttachBusy(false);
    }
  };

  const onImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void sendAttachment(file);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void sendAttachment(file);
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversation) return;

    setSending(true);
    try {
      await api.post("/messages", {
        contactId: conversation.contact.id,
        type: "TEXT",
        body: newMessage.trim(),
        isPrivate: privateNote || undefined,
      });
      setNewMessage("");
      await loadConversation();
    } catch {
      /* send failed */
    } finally {
      setSending(false);
    }
  };

  const applyStatus = async (
    status: "OPEN" | "PENDING" | "RESOLVED",
    extra?: { closureReason?: string; leadTypeId?: string; closureValue?: number | null },
  ) => {
    if (!conversation || !id) return;
    setActionLoading(true);
    setResolveError("");
    setFlowError("");
    try {
      const body: Record<string, unknown> = { status };
      if (extra?.closureReason) body.closureReason = extra.closureReason;
      if (extra?.leadTypeId) body.leadTypeId = extra.leadTypeId;
      if (extra && "closureValue" in extra) {
        body.closureValue = extra.closureValue;
      }
      const data = await api.put<ConversationDetail>(`/conversations/${id}`, body);
      setConversation(data);
      setResolveOpen(false);
      setClosureReason("");
      setClosureAmount("");
      setLeadTypeId("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (status === "RESOLVED") {
        setResolveError(msg || "Request failed");
      } else {
        setFlowError(msg || "Request failed");
      }
    } finally {
      setActionLoading(false);
    }
  };

  const saveConversationTeam = async () => {
    if (!conversation || !id) return;
    setActionLoading(true);
    setFlowError("");
    try {
      const data = await api.put<ConversationDetail>(`/conversations/${id}`, {
        teamId: teamPickerId || null,
      });
      setConversation(data);
      setTeamPickerId(data.team?.id ?? "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setFlowError(msg || "Request failed");
    } finally {
      setActionLoading(false);
    }
  };

  const submitResolve = async (e: FormEvent) => {
    e.preventDefault();
    setResolveError("");
    if (closureReason.trim().length < 3) {
      setResolveError(t("conversationDetail.closureReasonHint"));
      return;
    }
    if (!leadTypeId) {
      setResolveError(t("conversationDetail.selectLeadType"));
      return;
    }
    const rawAmount = closureAmount.trim();
    let closureValue: number | null;
    if (rawAmount === "") {
      closureValue = null;
    } else {
      const n = parseFloat(rawAmount.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        setResolveError(t("conversationDetail.closureValueInvalid"));
        return;
      }
      closureValue = n;
    }
    await applyStatus("RESOLVED", {
      closureReason: closureReason.trim(),
      leadTypeId,
      closureValue,
    });
  };

  const statusLabel = (s: string) => {
    if (s === "OPEN") return t("conversationDetail.statusOpen");
    if (s === "PENDING") return t("conversationDetail.statusPending");
    if (s === "RESOLVED") return t("conversationDetail.statusResolved");
    return s;
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">{t("conversationDetail.notFound")}</p>
      </div>
    );
  }

  const canResolve = conversation.status === "OPEN" || conversation.status === "PENDING";

  return (
    <div className="flex h-full flex-col">
      <motion.div
        className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-6 py-4"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <Link
          to="/conversations"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold">
          {conversation.contact.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-900">{conversation.contact.name}</h2>
          <p className="text-xs text-gray-500">{conversation.contact.phone}</p>
          <div className="mt-1 space-y-0.5 text-[11px] text-gray-500">
            <p>
              <span className="font-medium text-gray-600">{t("audit.contactOwner")}:</span>{" "}
              {conversation.contact.assignedTo?.name ?? "—"}
            </p>
            <p>
              <span className="font-medium text-gray-600">{t("audit.contactCreatedBy")}:</span>{" "}
              {conversation.contact.createdBy?.name ?? t("audit.sourceInbound")}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                conversation.status === "OPEN" && "bg-green-100 text-green-800",
                conversation.status === "PENDING" && "bg-amber-100 text-amber-800",
                conversation.status === "RESOLVED" && "bg-gray-100 text-gray-600",
              )}
            >
              {statusLabel(conversation.status)}
            </span>
            {conversation.status === "RESOLVED" && conversation.leadType && (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: conversation.leadType.color }}
              >
                {conversation.leadType.name}
              </span>
            )}
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
              {t("conversationDetail.team")}: {conversation.team?.name ?? t("conversationDetail.noTeam")}
            </span>
          </div>
          {tenantAdmin ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor="conv-team" className="sr-only">
                {t("conversationDetail.assignTeam")}
              </label>
              <select
                id="conv-team"
                value={teamPickerId}
                onChange={(e) => setTeamPickerId(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800"
              >
                <option value="">{t("conversationDetail.noTeam")}</option>
                {teamOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={actionLoading || teamPickerId === (conversation.team?.id ?? "")}
                onClick={() => void saveConversationTeam()}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t("conversationDetail.saveTeam")}
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
          {isOutsideWindow && (
            <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("conversationDetail.outsideWindow")}
            </div>
          )}
          <Link
            to={`/contacts/${conversation.contact.id}`}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <User className="mr-1 inline h-3.5 w-3.5" />
            {t("conversationDetail.viewContact")}
          </Link>
          {conversation.status === "OPEN" && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void applyStatus("PENDING")}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              <PauseCircle className="h-3.5 w-3.5" />
              {t("conversationDetail.setPending")}
            </button>
          )}
          {canResolve && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => {
                setResolveError("");
                setClosureAmount("");
                setResolveOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              {t("conversationDetail.finalize")}
            </button>
          )}
          {conversation.status === "RESOLVED" && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void applyStatus("OPEN")}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("conversationDetail.reopen")}
            </button>
          )}
        </div>
      </motion.div>

      {flowError && (
        <div className="border-b border-red-100 bg-red-50 px-6 py-2 text-center text-sm text-red-700">{flowError}</div>
      )}

      {conversation.status === "RESOLVED" && (conversation.closureReason || conversation.leadType) && (
        <div className="border-b border-gray-200 bg-brand-50/50 px-6 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">
            {t("conversationDetail.resolvedSummary")}
          </p>
          {conversation.leadType && (
            <p className="mt-1 text-sm text-gray-800">
              <span className="font-medium">{t("conversationDetail.leadLabel")}:</span>{" "}
              <span style={{ color: conversation.leadType.color }} className="font-semibold">
                {conversation.leadType.name}
              </span>
            </p>
          )}
          {conversation.closureReason && (
            <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{conversation.closureReason}</p>
          )}
          {conversation.closureValue != null && conversation.closureValue > 0 && (
            <p className="mt-2 text-sm text-gray-800">
              <span className="font-medium">{t("conversationDetail.closureValueLabel")}:</span>{" "}
              {fmtMoney(conversation.closureValue)}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {(conversation.messages ?? []).map((msg, i) => {
            const isNew = !seenMessageIds.current.has(msg.id);
            if (isNew) seenMessageIds.current.add(msg.id);
            return (
              <motion.div
                key={msg.id}
                className={clsx("flex", msg.direction === "OUTBOUND" ? "justify-end" : "justify-start")}
                initial={isNew ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.25,
                  delay: isNew ? Math.min(i * 0.03, 0.3) : 0,
                  ease: "easeOut",
                }}
              >
                <div
                  className={clsx(
                    "max-w-[70%] rounded-2xl px-4 py-2.5",
                    msg.isPrivate
                      ? "border-2 border-amber-300 bg-amber-50 text-amber-950"
                      : msg.direction === "OUTBOUND"
                        ? "bg-brand-500 text-white"
                        : "border border-gray-200 bg-white text-gray-900",
                  )}
                >
                  {msg.isPrivate ? (
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                      <Lock className="h-3 w-3" />
                      {t("conversationDetail.internalNoteLabel")}
                    </p>
                  ) : null}
                  {msg.type === "IMAGE" && msg.mediaUrl && (
                    <a href={msg.mediaUrl} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={msg.mediaUrl}
                        alt=""
                        className={clsx(
                          "max-h-64 max-w-full rounded-lg object-contain",
                          msg.direction === "OUTBOUND" && !msg.isPrivate && "opacity-95",
                        )}
                      />
                    </a>
                  )}
                  {msg.type === "DOCUMENT" && msg.mediaUrl && (
                    <a
                      href={msg.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className={clsx(
                        "mt-1 inline-block text-sm underline",
                        msg.direction === "OUTBOUND" && !msg.isPrivate
                          ? "text-brand-100"
                          : "text-brand-700",
                      )}
                    >
                      {msg.body?.trim() || t("conversationDetail.downloadAttachment")}
                    </a>
                  )}
                  {msg.body && msg.type !== "DOCUMENT" ? (
                    <p className={clsx("text-sm", msg.type === "IMAGE" && msg.mediaUrl && "mt-2")}>{msg.body}</p>
                  ) : null}
                  {msg.type === "VIDEO" && msg.mediaUrl && (
                    <video
                      src={msg.mediaUrl}
                      controls
                      className="mt-1 max-h-64 w-full max-w-md rounded-lg"
                      preload="metadata"
                    />
                  )}
                  {msg.type === "AUDIO" && msg.mediaUrl && (
                    <audio
                      controls
                      src={msg.mediaUrl}
                      className={clsx(
                        "mt-2 w-full min-w-[200px] max-w-[280px]",
                        msg.direction === "OUTBOUND" && !msg.isPrivate && "opacity-95",
                      )}
                      preload="metadata"
                    />
                  )}
                  <div
                    className={clsx(
                      "mt-1 flex items-center gap-1 text-[10px]",
                      msg.isPrivate
                        ? "text-amber-800/80"
                        : msg.direction === "OUTBOUND"
                          ? "text-brand-100"
                          : "text-gray-400",
                    )}
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {format(new Date(msg.sentAt), "HH:mm")}
                    {msg.direction === "OUTBOUND" && (
                      <span className="ml-1 capitalize">{msg.status.toLowerCase()}</span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <motion.div
        className="border-t border-gray-200 bg-white px-6 py-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1, ease: "easeOut" }}
      >
        <form onSubmit={handleSend} className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">
              <input
                type="checkbox"
                checked={privateNote}
                onChange={(e) => setPrivateNote(e.target.checked)}
                className="rounded border-gray-300"
              />
              <Lock className="h-3.5 w-3.5" />
              {t("conversationDetail.privateNote")}
            </label>
            {privateNote ? (
              <span className="text-xs text-gray-500">{t("conversationDetail.privateNoteHint")}</span>
            ) : null}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onImageInputChange}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={onFileInputChange}
          />
          <div className="flex items-center gap-2 sm:gap-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={
                privateNote
                  ? t("conversationDetail.privateNotePlaceholder")
                  : isOutsideWindow
                    ? t("conversationDetail.placeholderTemplate")
                    : t("conversationDetail.placeholderNormal")
              }
              disabled={(isOutsideWindow && !privateNote) || recording}
              className="min-w-0 flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
            {evolutionRichChat ? (
              <>
                <motion.button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={
                    attachBusy || (!privateNote && isOutsideWindow) || recording
                  }
                  title={t("conversationDetail.attachImage")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  whileTap={{ scale: 0.92 }}
                >
                  <ImagePlus className="h-5 w-5" />
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    attachBusy || (!privateNote && isOutsideWindow) || recording
                  }
                  title={t("conversationDetail.attachFile")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  whileTap={{ scale: 0.92 }}
                >
                  <Paperclip className="h-5 w-5" />
                </motion.button>
              </>
            ) : null}
            <motion.button
              type="button"
              onClick={() => void handleVoiceToggle()}
              disabled={isOutsideWindow || voiceBusy || sending || attachBusy}
              title={recording ? t("conversationDetail.stopRecording") : t("conversationDetail.recordVoice")}
              className={clsx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm disabled:opacity-50",
                recording
                  ? "border-red-200 bg-red-500 text-white hover:bg-red-600"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              )}
              whileTap={{ scale: 0.92 }}
              aria-pressed={recording}
            >
              {recording ? <Square className="h-5 w-5 fill-current" /> : <Mic className="h-5 w-5" />}
            </motion.button>
            <motion.button
              type="submit"
              disabled={sending || !newMessage.trim() || (isOutsideWindow && !privateNote) || attachBusy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
              whileTap={{ scale: 0.92 }}
            >
              <Send className="h-5 w-5" />
            </motion.button>
          </div>
          {(recording || voiceBusy || attachBusy) && (
            <p className="text-center text-xs text-gray-500">
              {attachBusy
                ? t("conversationDetail.sendingAttachment")
                : voiceBusy
                  ? t("conversationDetail.voiceSending")
                  : t("conversationDetail.recording")}
            </p>
          )}
        </form>
      </motion.div>

      <AnimatePresence>
        {resolveOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            variants={backdropVariants}
            initial="hidden"
            animate="show"
            exit="hidden"
            onClick={() => !actionLoading && setResolveOpen(false)}
          >
            <motion.div
              variants={modalVariants}
              initial="hidden"
              animate="show"
              exit="hidden"
              className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900">{t("conversationDetail.finalizeTitle")}</h3>
              <p className="mt-1 text-sm text-gray-500">{t("conversationDetail.finalizeSubtitle")}</p>
              <form onSubmit={submitResolve} className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    {t("conversationDetail.leadType")} *
                  </label>
                  <select
                    value={leadTypeId}
                    onChange={(e) => setLeadTypeId(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    required
                  >
                    <option value="">{t("conversationDetail.selectLeadType")}</option>
                    {leadTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>
                        {lt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    {t("conversationDetail.closureReason")} *
                  </label>
                  <textarea
                    value={closureReason}
                    onChange={(e) => setClosureReason(e.target.value)}
                    rows={4}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    placeholder={t("conversationDetail.closureReasonHint")}
                    required
                    minLength={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    {t("conversationDetail.closureValueOptional")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={closureAmount}
                    onChange={(e) => setClosureAmount(e.target.value)}
                    placeholder={t("conversationDetail.closureValuePlaceholder")}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">{t("conversationDetail.closureValueHint")}</p>
                </div>
                {resolveError && (
                  <p className="text-sm text-red-600">{resolveError}</p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setResolveOpen(false)}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {t("common.confirm")}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
