import { useState, useEffect, useRef, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Send, ArrowLeft, Clock, User, AlertTriangle, CheckCircle, PauseCircle, RotateCcw } from "lucide-react";
import clsx from "clsx";
import { format, differenceInHours } from "date-fns";
import { motion, AnimatePresence, backdropVariants, modalVariants } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";

interface Message {
  id: string;
  direction: string;
  type: string;
  body: string | null;
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
  leadType: LeadTypeRow | null;
  contact: { id: string; name: string; phone: string };
  messages: Message[];
}

export function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [leadTypes, setLeadTypes] = useState<LeadTypeRow[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [closureReason, setClosureReason] = useState("");
  const [leadTypeId, setLeadTypeId] = useState("");
  const [resolveError, setResolveError] = useState("");
  const [flowError, setFlowError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seenMessageIds = useRef(new Set<string>());

  const loadConversation = async () => {
    try {
      const data = await api.get<ConversationDetail>(`/conversations/${id}`);
      setConversation(data);
    } catch {
      /* failed */
    } finally {
      setLoading(false);
    }
  };

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
    loadConversation();
    const interval = setInterval(loadConversation, 5000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

  const lastInbound = conversation?.messages.filter((m) => m.direction === "INBOUND").at(-1);

  const isOutsideWindow = lastInbound
    ? differenceInHours(new Date(), new Date(lastInbound.createdAt)) > 24
    : true;

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversation) return;

    setSending(true);
    try {
      await api.post("/messages", {
        contactId: conversation.contact.id,
        type: "TEXT",
        body: newMessage.trim(),
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
    extra?: { closureReason?: string; leadTypeId?: string },
  ) => {
    if (!conversation || !id) return;
    setActionLoading(true);
    setResolveError("");
    setFlowError("");
    try {
      const body: Record<string, unknown> = { status };
      if (extra?.closureReason) body.closureReason = extra.closureReason;
      if (extra?.leadTypeId) body.leadTypeId = extra.leadTypeId;
      const data = await api.put<ConversationDetail>(`/conversations/${id}`, body);
      setConversation(data);
      setResolveOpen(false);
      setClosureReason("");
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
    await applyStatus("RESOLVED", {
      closureReason: closureReason.trim(),
      leadTypeId,
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
          </div>
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
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {conversation.messages.map((msg, i) => {
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
                    msg.direction === "OUTBOUND"
                      ? "bg-brand-500 text-white"
                      : "border border-gray-200 bg-white text-gray-900",
                  )}
                >
                  {msg.body && <p className="text-sm">{msg.body}</p>}
                  <div
                    className={clsx(
                      "mt-1 flex items-center gap-1 text-[10px]",
                      msg.direction === "OUTBOUND" ? "text-brand-100" : "text-gray-400",
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
        <form onSubmit={handleSend} className="mx-auto flex max-w-3xl items-center gap-3">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={isOutsideWindow ? t("conversationDetail.placeholderTemplate") : t("conversationDetail.placeholderNormal")}
            disabled={isOutsideWindow}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <motion.button
            type="submit"
            disabled={sending || !newMessage.trim() || isOutsideWindow}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
            whileTap={{ scale: 0.92 }}
          >
            <Send className="h-5 w-5" />
          </motion.button>
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
