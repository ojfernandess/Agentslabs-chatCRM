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
import { useI18n } from "@/i18n/I18nProvider";
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

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");

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
    try {
      const updated = await api.put<ContactDetail>(`/contacts/${id}`, {
        name: editName,
        notes: editNotes || undefined,
      });
      setContact({ ...contact!, ...updated });
      setEditing(false);
    } catch {
      // failed
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this contact and all associated data? This cannot be undone.")) return;
    try {
      await api.delete(`/contacts/${id}`);
      navigate("/contacts");
    } catch {
      // failed
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
        <p className="text-gray-500">Contact not found</p>
      </div>
    );
  }

  const assignedTagIds = new Set(contact.tags.map((t) => t.tag.id));
  const availableTags = allTags.filter((t) => !assignedTagIds.has(t.id));

  return (
    <PageTransition>
    <div className="p-8">
      <div className="mb-6 flex items-center gap-4">
        <Link
          to="/contacts"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex flex-1 items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 text-lg font-bold text-brand-800 dark:from-brand-900/40 dark:to-brand-800/30 dark:text-brand-100">
            {contact.profilePictureUrl ? (
              <img src={contact.profilePictureUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                {contact.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Edit className="h-4 w-4" />
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete
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
                          <MessageSquare className="h-4 w-4 shrink-0 text-gray-400" />
                        )}
                        <span className="text-sm font-medium text-gray-700 dark:text-ink-200">
                          {conv.inbox?.name ?? conv.inbox?.channelType}
                        </span>
                        <span className="text-xs text-gray-400">
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
                                "max-w-[min(100%,28rem)] rounded-2xl px-3 py-2 text-sm",
                                inbound
                                  ? "border border-gray-100 bg-white text-gray-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                                  : "bg-gradient-to-br from-brand-500 to-brand-600 text-white",
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
              className="rounded-xl border border-gray-200 bg-white p-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="mb-4 font-semibold text-gray-900">Edit Contact</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}

          {detailTab === "overview" && !editing ? (
            <>
              {contact.notes && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <h2 className="mb-2 text-sm font-medium text-gray-500">Notes</h2>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{contact.notes}</p>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
                  <History className="h-4 w-4 text-gray-400" />
                  {t("contactDetail.activityTitle")}
                </h2>
                {timeline.length === 0 ? (
                  <p className="text-sm text-gray-500">{t("contactDetail.activityEmpty")}</p>
                ) : (
                  <ul className="space-y-4">
                    {timeline.map((ev) => {
                      const title = timelineEventTitle(ev.eventType, t);
                      const channel = timelineChannelLabel(ev.channel, t);
                      const summary = timelineEventSummary(ev.eventType, ev.payload as TimelinePayload, t);
                      return (
                        <li
                          key={ev.id}
                          className="border-l-2 border-brand-200 py-0.5 pl-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium text-gray-900">{title}</span>
                            {channel ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                {(ev.channel ?? "").toLowerCase() === "whatsapp" ? (
                                  <WhatsAppBrandIcon className="h-3 w-3 shrink-0" />
                                ) : null}
                                {channel}
                              </span>
                            ) : null}
                            <time
                              dateTime={ev.occurredAt}
                              className="text-xs text-gray-400"
                            >
                              {format(new Date(ev.occurredAt), "PPp", { locale: dateLocale })}
                            </time>
                          </div>
                          {summary ? (
                            <p className="mt-1.5 whitespace-pre-wrap text-gray-600">{summary}</p>
                          ) : null}
                          {ev.actorUser ? (
                            <p className="mt-1 text-xs text-gray-500">
                              <span className="font-medium text-gray-600">
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
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-sm font-medium text-gray-500">Pipeline Stage</h2>
            <div className="relative">
              <button
                onClick={() => setShowStagePicker(!showStagePicker)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
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
                  <span className="text-gray-400">No stage</span>
                )}
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>
              <AnimatePresence>
              {showStagePicker && (
                <motion.div
                  className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                  variants={dropdownVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                >
                  <button
                    onClick={() => setStage(null)}
                    className="block w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50"
                  >
                    No stage
                  </button>
                  {allStages.map((stage) => (
                    <button
                      key={stage.id}
                      onClick={() => setStage(stage.id)}
                      className={clsx(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50",
                        (contact.pipelineStage?.leadTypeId ?? contact.pipelineStage?.id) === stage.id
                          ? "bg-gray-50 font-medium"
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
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-500">Tags</h2>
              {availableTags.length > 0 && (
                <button
                  onClick={() => setShowTagPicker(!showTagPicker)}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <AnimatePresence>
            {showTagPicker && (
              <motion.div
                className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2"
                variants={dropdownVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <p className="mb-2 text-xs font-medium text-gray-500">Add a tag</p>
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
              <p className="text-sm text-gray-400">No tags</p>
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
    </PageTransition>
  );
}
