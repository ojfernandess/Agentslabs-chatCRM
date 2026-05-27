import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import {
  ArrowLeft,
  Phone,
  Tag,
  MessageSquare,
  Trash2,
  Edit,
  Plus,
  X,
  ChevronDown,
  History,
  Send,
  Mail,
  Building2,
} from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { PageTransition, motion, AnimatePresence, dropdownVariants } from "@/components/Motion";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import { ContactAvatar } from "@/components/ContactAvatar";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  timelineChannelLabel,
  timelineEventSummary,
  timelineEventTitle,
  type TimelinePayload,
} from "@/lib/contactTimeline";
import { ContactQuickMessageModal } from "@/components/ContactQuickMessageModal";

interface TagItem {
  id: string;
  name: string;
  color: string;
}

interface StageItem {
  id: string;
  name: string;
  color: string;
  order: number;
  leadTypeId?: string | null;
  probabilityPct?: number;
}

interface TimelineEventApi {
  id: string;
  eventType: string;
  channel: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  actorUser: { id: string; name: string } | null;
}

interface ContactDetail {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  profilePictureUrl: string | null;
  lifecycleStage: string | null;
  notes: string | null;
  optedIn: boolean;
  optedInAt: string | null;
  createdAt: string;
  tags: { tag: TagItem }[];
  pipelineStage: StageItem | null;
  assignedTo: { id: string; name: string } | null;
  account: {
    id: string;
    name: string;
    website: string | null;
    industry: string | null;
    metadata: unknown;
  } | null;
  conversations: {
    id: string;
    status: string;
    updatedAt: string;
    inbox?: { channelType: string; name: string } | null;
  }[];
}

interface ThreadMessage {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  createdAt: string;
  isPrivate: boolean;
  conversation: {
    id: string;
    inbox: { channelType: string; name: string } | null;
  };
}

function metaFirstString(metadata: unknown, keys: string[]): string {
  if (!metadata || typeof metadata !== "object") return "";
  const o = metadata as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editDocument, setEditDocument] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Tag picker state
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);

  // Stage picker state
  const [allStages, setAllStages] = useState<StageItem[]>([]);
  const [showStagePicker, setShowStagePicker] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEventApi[]>([]);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [detailTab, setDetailTab] = useState<"overview" | "chats">("overview");
  const [quickOpen, setQuickOpen] = useState(false);

  useEffect(() => {
    if (editing) setDetailTab("overview");
  }, [editing]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    async function load() {
      if (!id) return;
      try {
        const [data, tags, stages, timelineRes, msgRes] = await Promise.all([
          api.get<ContactDetail>(`/contacts/${id}`),
          api.get<TagItem[]>("/tags"),
          api.get<StageItem[]>("/lead-types"),
          api.get<{ data: TimelineEventApi[] }>(
            `/crm/timeline?subjectType=CONTACT&subjectId=${encodeURIComponent(id)}`,
          ).catch(() => ({ data: [] as TimelineEventApi[] })),
          api.get<ThreadMessage[]>(`/contacts/${id}/messages`).catch(() => [] as ThreadMessage[]),
        ]);
        setContact(data);
        setEditName(data.name);
        setEditPhone(data.phone);
        setEditEmail(data.email ?? "");
        setEditCompany(data.account?.name ?? "");
        setEditDocument(
          metaFirstString(data.account?.metadata, ["document", "documento", "cpf", "cnpj", "taxId"]),
        );
        setEditCity(metaFirstString(data.account?.metadata, ["city", "cidade", "municipio"]));
        setEditWebsite(data.account?.website ?? "");
        setEditNotes(data.notes ?? "");
        setAllTags(tags);
        setAllStages(stages.sort((a, b) => a.order - b.order));
        setTimeline(timelineRes.data ?? []);
        setThreadMessages(Array.isArray(msgRes) ? msgRes : []);
      } catch {
        // failed
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    try {
      const updated = await api.put<ContactDetail>(`/contacts/${id}`, {
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim() === "" ? null : editEmail.trim(),
        notes: editNotes.trim() === "" ? undefined : editNotes,
        company: editCompany.trim() === "" ? null : editCompany.trim(),
        document: editDocument.trim() === "" ? null : editDocument.trim(),
        city: editCity.trim() === "" ? null : editCity.trim(),
        website: editWebsite.trim() === "" ? null : editWebsite.trim(),
      });
      setContact(updated);
      setEditName(updated.name);
      setEditPhone(updated.phone);
      setEditEmail(updated.email ?? "");
      setEditCompany(updated.account?.name ?? "");
      setEditDocument(
        metaFirstString(updated.account?.metadata, ["document", "documento", "cpf", "cnpj", "taxId"]),
      );
      setEditCity(metaFirstString(updated.account?.metadata, ["city", "cidade", "municipio"]));
      setEditWebsite(updated.account?.website ?? "");
      setEditNotes(updated.notes ?? "");
      setEditing(false);
    } catch {
      // failed
    }
  };

  const confirmDelete = async () => {
    if (!id) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.delete(`/contacts/${id}`);
      navigate("/contacts");
    } catch {
      setDeleteError(t("contacts.deleteError"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const addTag = async (tagId: string) => {
    try {
      const updated = await api.post<ContactDetail>(`/contacts/${id}/tags`, { tagIds: [tagId] });
      setContact({ ...contact!, tags: updated.tags });
      setShowTagPicker(false);
    } catch {
      // failed
    }
  };

  const removeTag = async (tagId: string) => {
    try {
      await api.delete(`/contacts/${id}/tags/${tagId}`);
      setContact({
        ...contact!,
        tags: contact!.tags.filter((t) => t.tag.id !== tagId),
      });
    } catch {
      // failed
    }
  };

  const setStage = async (leadTypeId: string | null) => {
    try {
      const updated = await api.put<ContactDetail>(`/contacts/${id}/stage`, { leadTypeId });
      setContact({ ...contact!, pipelineStage: updated.pipelineStage });
      setShowStagePicker(false);
    } catch {
      // failed
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500 dark:text-ink-400">{t("contacts.notFound")}</p>
      </div>
    );
  }

  const assignedTagIds = new Set(contact.tags.map((t) => t.tag.id));
  const availableTags = allTags.filter((t) => !assignedTagIds.has(t.id));

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex items-center gap-4">
        <Link
          to="/contacts"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-ink-500 dark:hover:bg-ink-800 dark:hover:text-ink-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex flex-1 items-start gap-4">
          <ContactAvatar
            contactId={contact.id}
            name={contact.name}
            profilePictureUrl={contact.profilePictureUrl}
            className="h-14 w-14 rounded-2xl text-lg"
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-ink-50">{contact.name}</h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-ink-400">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" /> {contact.phone}
              </span>
              {contact.email ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {contact.email}
                </span>
              ) : null}
              {contact.account ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> {contact.account.name}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            <Send className="h-4 w-4" />
            {t("contacts.quickMessage")}
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
          >
            <Edit className="h-4 w-4" />
            {t("common.edit")}
          </button>
          <button
            onClick={() => {
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-4 w-4" />
            {t("contacts.deleteContact")}
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b border-gray-200 dark:border-ink-800">
        {(["overview", "chats"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setDetailTab(k)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium transition",
              detailTab === k
                ? "border-b-2 border-brand-500 text-brand-600 dark:text-brand-400"
                : "text-gray-500 hover:text-gray-800 dark:text-ink-400 dark:hover:text-ink-200",
            )}
          >
            {k === "overview" ? t("contactDrawer.tabGeneral") : t("contactDrawer.tabConversations")}
          </button>
        ))}
      </div>

      <motion.div
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1, ease: "easeOut" }}
      >
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {detailTab === "chats" ? (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/40">
                <h2 className="mb-4 font-semibold text-gray-900 dark:text-ink-50">
                  {t("contactDetail.conversationsTitle")}
                </h2>
                {contact.conversations.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-ink-400">{t("contactDetail.noConversations")}</p>
                ) : (
                  <div className="space-y-2">
                    {contact.conversations.map((conv) => (
                      <Link
                        key={conv.id}
                        to={`/conversations/${conv.id}`}
                        className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50 dark:border-ink-800 dark:hover:bg-ink-900/60"
                      >
                        {conv.inbox?.channelType === "WHATSAPP" ? (
                          <WhatsAppBrandIcon className="h-4 w-4 shrink-0" />
                        ) : (
                          <MessageSquare className="h-4 w-4 shrink-0 text-gray-400 dark:text-ink-500" />
                        )}
                        <span className="text-sm font-medium text-gray-700 dark:text-ink-200">
                          {conv.inbox?.name ?? conv.inbox?.channelType}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-ink-500">
                          {format(new Date(conv.updatedAt), "PP", { locale: dateLocale })}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/40">
                <h2 className="mb-3 font-semibold text-gray-900 dark:text-ink-50">{t("contactDrawer.threadTitle")}</h2>
                {threadMessages.filter((m) => !m.isPrivate).length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-ink-400">{t("contactDrawer.noMessagesThread")}</p>
                ) : (
                  <div className="max-h-[480px] space-y-2 overflow-y-auto rounded-xl bg-slate-50/80 p-4 dark:bg-ink-950/40">
                    {threadMessages
                      .filter((m) => !m.isPrivate)
                      .map((msg) => {
                        const inbound = msg.direction === "INBOUND";
                        return (
                          <div key={msg.id} className={clsx("flex", inbound ? "justify-start" : "justify-end")}>
                            <div
                              className={clsx(
                                "crm-bubble max-w-[min(100%,28rem)] px-3 py-2 text-sm",
                                inbound
                                  ? "crm-bubble-in border border-ink-200/60 dark:border-white/10"
                                  : "crm-bubble-out border border-brand-500/25 dark:border-brand-400/30",
                              )}
                            >
                              <p className="mb-1 text-[10px] font-medium opacity-80">
                                {msg.conversation.inbox?.name ?? msg.conversation.inbox?.channelType} ·{" "}
                                {format(new Date(msg.createdAt), "Pp", { locale: dateLocale })}
                              </p>
                              <p className="whitespace-pre-wrap break-words">
                                {msg.body?.trim()
                                  ? msg.body
                                  : msg.type !== "TEXT"
                                    ? `(${msg.type})`
                                    : ""}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </>
          ) : null}

          {detailTab === "overview" && editing ? (
            <motion.div
              className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/50"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="mb-1 font-semibold text-gray-900 dark:text-ink-50">{t("contactEdit.title")}</h2>
              <p className="mb-4 text-xs text-gray-500 dark:text-ink-400">{t("contactEdit.optionalHint")}</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                    {t("contactEdit.fieldName")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                    {t("contactEdit.fieldPhone")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                    {t("contactEdit.fieldEmail")}
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder={t("contactEdit.placeholderOptional")}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                    {t("contactEdit.fieldCompany")}
                  </label>
                  <input
                    type="text"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    placeholder={t("contactEdit.placeholderOptional")}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                    {t("contactEdit.fieldWebsite")}
                  </label>
                  <input
                    type="url"
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                    placeholder={t("contactEdit.placeholderOptional")}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                      {t("contactEdit.fieldDocument")}
                    </label>
                    <input
                      type="text"
                      value={editDocument}
                      onChange={(e) => setEditDocument(e.target.value)}
                      placeholder={t("contactEdit.placeholderOptional")}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                      {t("contactEdit.fieldCity")}
                    </label>
                    <input
                      type="text"
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      placeholder={t("contactEdit.placeholderOptional")}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-ink-300">
                    {t("contactEdit.fieldNotes")}
                  </label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    placeholder={t("contactEdit.placeholderOptional")}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!editName.trim() || !editPhone.trim()}
                    onClick={() => void handleSave()}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {t("contactEdit.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-800"
                  >
                    {t("contactEdit.cancel")}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}

          {detailTab === "overview" && !editing ? (
            <>
              {contact.notes && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/40">
                  <h2 className="mb-2 text-sm font-medium text-gray-500 dark:text-ink-400">{t("contactEdit.fieldNotes")}</h2>
                  <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-ink-200">{contact.notes}</p>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/40">
                <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-ink-50">
                  <History className="h-4 w-4 text-gray-400 dark:text-ink-500" />
                  {t("contactDetail.activityTitle")}
                </h2>
                {timeline.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-ink-400">{t("contactDetail.activityEmpty")}</p>
                ) : (
                  <ul className="space-y-4">
                    {timeline.map((ev) => {
                      const title = timelineEventTitle(ev.eventType, t);
                      const channel = timelineChannelLabel(ev.channel, t);
                      const summary = timelineEventSummary(ev.eventType, ev.payload as TimelinePayload, t);
                      return (
                        <li
                          key={ev.id}
                          className="border-l-2 border-brand-200 py-0.5 pl-3 text-sm dark:border-brand-800/60"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium text-gray-900 dark:text-ink-100">{title}</span>
                            {channel ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-ink-800 dark:text-ink-300">
                                {(ev.channel ?? "").toLowerCase() === "whatsapp" ? (
                                  <WhatsAppBrandIcon className="h-3 w-3 shrink-0" />
                                ) : null}
                                {channel}
                              </span>
                            ) : null}
                            <time
                              dateTime={ev.occurredAt}
                              className="text-xs text-gray-400 dark:text-ink-500"
                            >
                              {format(new Date(ev.occurredAt), "PPp", { locale: dateLocale })}
                            </time>
                          </div>
                          {summary ? (
                            <p className="mt-1.5 whitespace-pre-wrap text-gray-600 dark:text-ink-300">{summary}</p>
                          ) : null}
                          {ev.actorUser ? (
                            <p className="mt-1 text-xs text-gray-500 dark:text-ink-400">
                              <span className="font-medium text-gray-600 dark:text-ink-300">
                                {t("contactDetail.timelineActor")}
                              </span>
                              : {ev.actorUser.name}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/40">
            <h2 className="mb-3 text-sm font-medium text-gray-500 dark:text-ink-400">{t("contactDrawer.tabGeneral")}</h2>
            <dl className="space-y-3">
              {contact.email ? (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-ink-500">{t("contactDrawer.email")}</dt>
                  <dd className="text-sm text-gray-700 dark:text-ink-200">{contact.email}</dd>
                </div>
              ) : null}
              {contact.account ? (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-ink-500">{t("contactDrawer.company")}</dt>
                  <dd className="text-sm text-gray-700 dark:text-ink-200">{contact.account.name}</dd>
                </div>
              ) : null}
              {contact.account?.website ? (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-ink-500">{t("contactDrawer.website")}</dt>
                  <dd className="text-sm text-gray-700 dark:text-ink-200">
                    <a
                      href={contact.account.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {contact.account.website}
                    </a>
                  </dd>
                </div>
              ) : null}
              {contact.lifecycleStage ? (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-ink-500">{t("contacts.colSource")}</dt>
                  <dd className="text-sm text-gray-700 dark:text-ink-200">{contact.lifecycleStage}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-gray-400 dark:text-ink-500">Created</dt>
                <dd className="text-sm text-gray-700 dark:text-ink-200">
                  {format(new Date(contact.createdAt), "MMM d, yyyy")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400 dark:text-ink-500">Opted In</dt>
                <dd className="text-sm text-gray-700 dark:text-ink-200">
                  {contact.optedIn ? "Yes" : "No"}
                </dd>
              </div>
              {contact.assignedTo && (
                <div>
                  <dt className="text-xs text-gray-400 dark:text-ink-500">Assigned To</dt>
                  <dd className="text-sm text-gray-700 dark:text-ink-200">{contact.assignedTo.name}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Pipeline Stage */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/40">
            <h2 className="mb-3 text-sm font-medium text-gray-500 dark:text-ink-400">{t("contacts.colPipeline")}</h2>
            <div className="relative">
              <button
                onClick={() => setShowStagePicker(!showStagePicker)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
              >
                {contact.pipelineStage ? (
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: contact.pipelineStage.color }}
                    />
                    {contact.pipelineStage.name}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-ink-500">{t("contacts.noStage")}</span>
                )}
                <ChevronDown className="h-4 w-4 text-gray-400 dark:text-ink-500" />
              </button>
              <AnimatePresence>
              {showStagePicker && (
                <motion.div
                  className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900"
                  variants={dropdownVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                >
                  <button
                    onClick={() => setStage(null)}
                    className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50 dark:text-ink-500 dark:hover:bg-ink-800"
                  >
                    {t("contacts.noStage")}
                  </button>
                  {allStages.map((stage) => (
                    <button
                      key={stage.id}
                      onClick={() => setStage(stage.id)}
                      className={clsx(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-ink-200 dark:hover:bg-ink-800",
                        (contact.pipelineStage?.leadTypeId ?? contact.pipelineStage?.id) === stage.id
                          ? "bg-gray-50 font-medium dark:bg-ink-800 dark:text-ink-100"
                          : "",
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      {stage.name}
                    </button>
                  ))}
                </motion.div>
              )}
              </AnimatePresence>
            </div>
          </div>

          {/* Tags */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900/40">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-500 dark:text-ink-400">{t("contacts.colTags")}</h2>
              {availableTags.length > 0 && (
                <button
                  onClick={() => setShowTagPicker(!showTagPicker)}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-ink-500 dark:hover:bg-ink-800 dark:hover:text-ink-200"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <AnimatePresence>
            {showTagPicker && (
              <motion.div
                className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-ink-700 dark:bg-ink-950/50"
                variants={dropdownVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <p className="mb-2 text-xs font-medium text-gray-500 dark:text-ink-400">{t("contacts.addTag")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => addTag(tag.id)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      <Plus className="h-2.5 w-2.5" />
                      {tag.name}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
            </AnimatePresence>
            {contact.tags.length === 0 && !showTagPicker ? (
              <p className="text-sm text-gray-400 dark:text-ink-500">{t("contacts.noTags")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {contact.tags.map(({ tag }) => (
                  <span
                    key={tag.id}
                    className="group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {tag.name}
                    <button
                      onClick={() => removeTag(tag.id)}
                      className="ml-0.5 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>

      <ContactQuickMessageModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        contact={contact ? { id: contact.id, name: contact.name, phone: contact.phone } : null}
      />

      <ConfirmDialog
        open={showDeleteModal}
        title={t("contacts.deleteTitle")}
        message={t("contacts.deleteConfirm").replace("{name}", contact?.name ?? "")}
        confirmLabel={t("contacts.deleteContact")}
        variant="danger"
        loading={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleteBusy) {
            setShowDeleteModal(false);
            setDeleteError(null);
          }
        }}
      />
    </PageTransition>
  );
}
