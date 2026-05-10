import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { AnimatePresence, motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { format } from "date-fns";
import clsx from "clsx";
import {
  X,
  ExternalLink,
  MessageCircle,
  Mail,
  Phone,
  Building2,
  MapPin,
  FileText,
  StickyNote,
} from "lucide-react";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import { filterTagsForDisplay } from "@/lib/tagDisplay";

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

interface ContactDetail {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  profilePictureUrl: string | null;
  optedIn: boolean;
  lifecycleStage: string | null;
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
  actorUser: { id: string; name: string; displayName: string | null } | null;
  conversation: {
    id: string;
    inbox: { channelType: string; name: string } | null;
  };
}

function metaPick(metadata: unknown, keys: string[]): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const o = metadata as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function channelGlyph(channelType: string) {
  const c = channelType.toUpperCase();
  if (c === "WHATSAPP") return <WhatsAppBrandIcon className="h-3.5 w-3.5 shrink-0" />;
  if (c === "EMAIL") return <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
  return <MessageCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
}

export function ContactProfileDrawer({
  contactId,
  open,
  onClose,
  onQuickMessage,
  tChannel,
}: {
  contactId: string | null;
  open: boolean;
  onClose: () => void;
  onQuickMessage: (c: { id: string; name: string; phone: string }) => void;
  tChannel: (type: string) => string;
}) {
  const { t, dateLocale } = useI18n();
  const [tab, setTab] = useState<"general" | "chats">("general");
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !contactId) {
      setContact(null);
      setMessages([]);
      return;
    }
    setTab("general");
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [c, msg] = await Promise.all([
          api.get<ContactDetail>(`/contacts/${contactId}`),
          api.get<ThreadMessage[]>(`/contacts/${contactId}/messages`).catch(() => [] as ThreadMessage[]),
        ]);
        if (!cancelled) {
          setContact(c);
          setMessages(Array.isArray(msg) ? msg : []);
        }
      } catch {
        if (!cancelled) {
          setContact(null);
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  const doc = contact ? metaPick(contact.account?.metadata ?? null, ["documento", "document", "cpf", "cnpj", "taxId"]) : null;
  const city = contact ? metaPick(contact.account?.metadata ?? null, ["cidade", "city", "municipio"]) : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col border-l border-slate-200/80 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-950"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="flex items-start gap-3 border-b border-slate-100 p-4 dark:border-ink-800">
              {contact ? (
                <div className="flex h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 text-lg font-bold text-brand-800 dark:from-brand-900/50 dark:to-brand-800/30 dark:text-brand-100">
                  {contact.profilePictureUrl ? (
                    <img src={contact.profilePictureUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">{contact.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-2xl bg-slate-100 dark:bg-ink-800" />
              )}
              <div className="min-w-0 flex-1">
                {loading && !contact ? (
                  <div className="h-6 w-40 animate-pulse rounded bg-slate-100 dark:bg-ink-800" />
                ) : contact ? (
                  <>
                    <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-ink-50">{contact.name}</h2>
                    <p className="truncate text-sm text-slate-500 dark:text-ink-400">
                      {contact.account?.name ?? t("contacts.noCompany")}
                      {contact.lifecycleStage ? ` · ${contact.lifecycleStage}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">{t("contactDrawer.notFound")}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {contact ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onQuickMessage({ id: contact.id, name: contact.name, phone: contact.phone })}
                      className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
                    >
                      {t("contacts.quickMessage")}
                    </button>
                    <Link
                      to={`/contacts/${contact.id}`}
                      className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-900"
                      title={t("contacts.openFullPage")}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-800 dark:hover:text-ink-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {contact ? (
              <div className="flex border-b border-slate-100 dark:border-ink-800">
                {(["general", "chats"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className={clsx(
                      "flex-1 px-4 py-3 text-sm font-medium transition",
                      tab === k
                        ? "border-b-2 border-brand-500 text-brand-600 dark:text-brand-400"
                        : "text-slate-500 hover:text-slate-800 dark:text-ink-400 dark:hover:text-ink-200",
                    )}
                  >
                    {k === "general" ? t("contactDrawer.tabGeneral") : t("contactDrawer.tabConversations")}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto p-4">
              {loading && !contact ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-ink-800" />
                  ))}
                </div>
              ) : null}

              {contact && tab === "general" ? (
                <div className="space-y-5">
                  <dl className="space-y-3 text-sm">
                    <div className="flex gap-2">
                      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-slate-400 dark:text-ink-500">
                        <Phone className="h-3.5 w-3.5" />
                        {t("contactDrawer.phone")}
                      </dt>
                      <dd className="font-medium text-slate-900 dark:text-ink-100">{contact.phone}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-slate-400 dark:text-ink-500">
                        <Mail className="h-3.5 w-3.5" />
                        {t("contactDrawer.email")}
                      </dt>
                      <dd className="text-slate-800 dark:text-ink-200">{contact.email ?? "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-slate-400 dark:text-ink-500">
                        <Building2 className="h-3.5 w-3.5" />
                        {t("contactDrawer.company")}
                      </dt>
                      <dd className="text-slate-800 dark:text-ink-200">{contact.account?.name ?? "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-slate-400 dark:text-ink-500">
                        <FileText className="h-3.5 w-3.5" />
                        {t("contactDrawer.document")}
                      </dt>
                      <dd className="text-slate-800 dark:text-ink-200">{doc ?? "—"}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-slate-400 dark:text-ink-500">
                        <MapPin className="h-3.5 w-3.5" />
                        {t("contactDrawer.city")}
                      </dt>
                      <dd className="text-slate-800 dark:text-ink-200">{city ?? "—"}</dd>
                    </div>
                    {contact.assignedTo ? (
                      <div className="flex gap-2">
                        <dt className="w-28 shrink-0 text-slate-400 dark:text-ink-500">{t("contacts.colOwner")}</dt>
                        <dd className="text-slate-800 dark:text-ink-200">{contact.assignedTo.name}</dd>
                      </div>
                    ) : null}
                    {contact.pipelineStage ? (
                      <div className="flex gap-2">
                        <dt className="w-28 shrink-0 text-slate-400 dark:text-ink-500">{t("contacts.colPipeline")}</dt>
                        <dd>
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: `${contact.pipelineStage.color}22`,
                              color: contact.pipelineStage.color,
                            }}
                          >
                            {contact.pipelineStage.name}
                          </span>
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {contact.notes ? (
                    <div>
                      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-ink-500">
                        <StickyNote className="h-3.5 w-3.5" />
                        {t("contactDrawer.observations")}
                      </h3>
                      <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-ink-900/60 dark:text-ink-200">
                        {contact.notes}
                      </p>
                    </div>
                  ) : null}

                  {filterTagsForDisplay(contact.tags).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {filterTagsForDisplay(contact.tags).map(({ tag }) => (
                        <span
                          key={tag.id}
                          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {contact && tab === "chats" ? (
                <div className="space-y-4">
                  {contact.conversations.length > 0 ? (
                    <ul className="space-y-2">
                      {contact.conversations.map((conv) => (
                        <li key={conv.id}>
                          <Link
                            to={`/conversations/${conv.id}`}
                            className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm hover:border-brand-200 hover:bg-brand-50/50 dark:border-ink-800 dark:bg-ink-900/40 dark:hover:border-brand-800/60"
                          >
                            {channelGlyph(conv.inbox?.channelType ?? "API")}
                            <span className="flex-1 font-medium text-slate-800 dark:text-ink-100">
                              {conv.inbox?.name ?? tChannel(conv.inbox?.channelType ?? "API")}
                            </span>
                            <span className="text-xs text-slate-400">
                              {format(new Date(conv.updatedAt), "PP", { locale: dateLocale })}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-ink-400">{t("contactDetail.noConversations")}</p>
                  )}

                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-ink-500">
                      {t("contactDrawer.threadTitle")}
                    </h3>
                    {messages.filter((m) => !m.isPrivate).length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-ink-400">{t("contactDrawer.noMessagesThread")}</p>
                    ) : (
                      <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-3 dark:border-ink-800 dark:bg-ink-900/30">
                        {messages
                          .filter((m) => !m.isPrivate)
                          .map((msg) => {
                            const inbound = msg.direction === "INBOUND";
                            return (
                              <div
                                key={msg.id}
                                className={clsx("flex", inbound ? "justify-start" : "justify-end")}
                              >
                                <div
                                  className={clsx(
                                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                                    inbound
                                      ? "rounded-bl-md border border-white bg-white text-slate-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                                      : "rounded-br-md bg-gradient-to-br from-brand-500 to-brand-600 text-white",
                                  )}
                                >
                                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium opacity-80">
                                    {channelGlyph(msg.conversation.inbox?.channelType ?? "API")}
                                    <span>{msg.conversation.inbox?.name ?? tChannel(msg.conversation.inbox?.channelType ?? "")}</span>
                                    <span>·</span>
                                    <time dateTime={msg.createdAt}>
                                      {format(new Date(msg.createdAt), "p", { locale: dateLocale })}
                                    </time>
                                  </div>
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
                </div>
              ) : null}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
