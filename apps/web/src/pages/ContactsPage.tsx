import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import {
  Users,
  Plus,
  Search,
  Phone,
  Tag,
  ChevronDown,
  X,
  Sparkles,
  TrendingUp,
  MessageCircle,
  Send,
  Mail,
} from "lucide-react";
import clsx from "clsx";
import {
  PageTransition,
  motion,
  AnimatePresence,
  staggerContainer,
  staggerItem,
  backdropVariants,
  modalVariants,
  dropdownVariants,
} from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { filterTagsForDisplay } from "@/lib/tagDisplay";
import { format } from "date-fns";
import { ContactProfileDrawer } from "@/components/ContactProfileDrawer";
import { ContactAvatar } from "@/components/ContactAvatar";
import { ContactQuickMessageModal } from "@/components/ContactQuickMessageModal";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";

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

interface ContactListRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  profilePictureUrl: string | null;
  optedIn: boolean;
  lifecycleStage: string | null;
  updatedAt: string;
  tags: { tag: TagItem }[];
  pipelineStage: StageItem | null;
  assignedTo: { id: string; name: string } | null;
  account: { id: string; name: string; metadata: unknown } | null;
  lastMessage: {
    preview: string;
    createdAt: string;
    direction: string;
    type: string;
  } | null;
  primaryChannel: string | null;
  inboxName: string | null;
  openDealsTotalCents: number;
  openDealsCurrency: string;
  openDealCount: number;
  engagementScore: number;
  recentlyActive: boolean;
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

function ChannelIcon({ channel }: { channel: string | null }) {
  const c = (channel ?? "").toUpperCase();
  if (c === "WHATSAPP") return <WhatsAppBrandIcon className="h-4 w-4 shrink-0" />;
  if (c === "EMAIL") return <Mail className="h-4 w-4 shrink-0 text-slate-400" />;
  return <MessageCircle className="h-4 w-4 shrink-0 text-slate-400" />;
}

export function ContactsPage() {
  const { t, dateLocale } = useI18n();
  const [contacts, setContacts] = useState<ContactListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<{ withOpenDeals: number; avgEngagementOnPage: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [createError, setCreateError] = useState("");

  const [drawerContactId, setDrawerContactId] = useState<string | null>(null);
  const [quickContact, setQuickContact] = useState<{ id: string; name: string; phone: string } | null>(null);

  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [allStages, setAllStages] = useState<StageItem[]>([]);

  const [tagPickerFor, setTagPickerFor] = useState<string | null>(null);
  const [stagePickerFor, setStagePickerFor] = useState<string | null>(null);
  const hasAnimated = useRef(false);

  const tChannel = useCallback(
    (type: string) => {
      const key = `contacts.channelTypes.${type}` as const;
      const label = t(key);
      return label === key ? type : label;
    },
    [t],
  );

  const loadContacts = async (searchQuery = "", showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (searchQuery) params.set("search", searchQuery);
      const res = await api.get<{
        data: ContactListRow[];
        total: number;
        stats?: { withOpenDeals: number; avgEngagementOnPage: number };
      }>(`/contacts?${params}`);
      setContacts(res.data);
      setTotal(res.total);
      setStats(res.stats ?? null);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    async function init() {
      try {
        await Promise.all([
          loadContacts("", true),
          api.get<TagItem[]>("/tags").then(setAllTags),
          api.get<StageItem[]>("/lead-types").then((stages) => setAllStages(stages.sort((a, b) => a.order - b.order))),
        ]);
      } catch {
        /* ignore */
      }
    }
    init();
  }, []);

  const handleSearch = () => {
    loadContacts(search);
  };

  const handleCreate = async () => {
    setCreateError("");
    try {
      await api.post("/contacts", { name: newName, phone: newPhone });
      setNewName("");
      setNewPhone("");
      setShowCreate(false);
      loadContacts(search);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create contact");
    }
  };

  const addTag = async (contactId: string, tagId: string) => {
    try {
      const updated = await api.post<{ tags: { tag: TagItem }[] }>(`/contacts/${contactId}/tags`, {
        tagIds: [tagId],
      });
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, tags: updated.tags } : c)),
      );
    } catch {
      /* ignore */
    }
    setTagPickerFor(null);
  };

  const removeTag = async (contactId: string, tagId: string) => {
    try {
      await api.delete(`/contacts/${contactId}/tags/${tagId}`);
      setContacts((prev) =>
        prev.map((c) =>
          c.id === contactId ? { ...c, tags: c.tags.filter((x) => x.tag.id !== tagId) } : c,
        ),
      );
    } catch {
      /* ignore */
    }
  };

  const setStage = async (contactId: string, leadTypeId: string | null) => {
    try {
      const updated = await api.put<{ pipelineStage: StageItem | null }>(`/contacts/${contactId}/stage`, {
        leadTypeId,
      });
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, pipelineStage: updated.pipelineStage } : c)),
      );
    } catch {
      /* ignore */
    }
    setStagePickerFor(null);
  };

  return (
    <PageTransition>
      <div className="min-h-full bg-gradient-to-b from-slate-50/90 to-white p-6 md:p-8 dark:from-ink-950 dark:to-ink-950">
        <motion.div
          className="mx-auto max-w-[1600px]"
          variants={staggerContainer}
          initial={hasAnimated.current ? false : "hidden"}
          animate="show"
          onAnimationComplete={() => {
            hasAnimated.current = true;
          }}
        >
          <motion.div variants={staggerItem} className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-brand-200/80 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-800 dark:border-brand-800/50 dark:bg-brand-950/40 dark:text-brand-200">
                <Sparkles className="h-3.5 w-3.5" />
                {t("contacts.hubCaption")}
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-ink-50 md:text-3xl">
                {t("contacts.title")}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-slate-600 dark:text-ink-400">{t("contacts.subtitle")}</p>
            </div>
            <motion.button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-600"
              whileTap={{ scale: 0.97 }}
            >
              <Plus className="h-4 w-4" />
              {t("contacts.addContact")}
            </motion.button>
          </motion.div>

          <motion.div variants={staggerItem} className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-ink-800 dark:bg-ink-900/50">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-ink-500">
                {t("contacts.metricTotalContacts")}
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-ink-50">{total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-ink-800 dark:bg-ink-900/50">
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-ink-500">
                <TrendingUp className="h-3.5 w-3.5" />
                {t("contacts.metricWithDeals")}
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-ink-50">
                {stats?.withOpenDeals ?? "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-ink-800 dark:bg-ink-900/50">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-ink-500">
                {t("contacts.metricAvgScore")}
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-ink-50">
                {stats?.avgEngagementOnPage != null ? stats.avgEngagementOnPage : "—"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400 dark:text-ink-500">{t("contacts.metricAvgScoreHint")}</p>
            </div>
          </motion.div>

          <motion.div variants={staggerItem} className="mb-5 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder={t("contacts.searchPlaceholder")}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
              />
            </div>
            <button
              onClick={handleSearch}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800"
            >
              {t("contacts.search")}
            </button>
          </motion.div>

          <AnimatePresence>
            {showCreate && (
              <motion.div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                variants={backdropVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <motion.div
                  className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-ink-700 dark:bg-ink-900"
                  variants={modalVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                >
                  <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-ink-50">{t("contacts.newContactTitle")}</h2>
                  {createError && (
                    <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      {createError}
                    </div>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-ink-300">
                        {t("contacts.fieldName")}
                      </label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-700 dark:bg-ink-950"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-ink-300">
                        {t("contacts.fieldPhone")}
                      </label>
                      <input
                        type="tel"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-700 dark:bg-ink-950"
                      />
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={() => setShowCreate(false)}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
                    >
                      {t("contacts.cancel")}
                    </button>
                    <motion.button
                      onClick={handleCreate}
                      disabled={!newName || !newPhone}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                      whileTap={{ scale: 0.97 }}
                    >
                      {t("contacts.create")}
                    </motion.button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
            </div>
          ) : contacts.length === 0 ? (
            <motion.div
              className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 dark:border-ink-700 dark:bg-ink-900/40"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <Users className="mb-3 h-12 w-12 text-slate-300 dark:text-ink-600" />
              <p className="text-sm text-slate-500 dark:text-ink-400">{t("contacts.empty")}</p>
            </motion.div>
          ) : (
            <motion.div
              variants={staggerItem}
              className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900/40"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/90 dark:border-ink-800 dark:bg-ink-900/80">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ink-400">
                        {t("contacts.colContact")}
                      </th>
                      <th className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell dark:text-ink-400">
                        {t("contacts.colCompany")}
                      </th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ink-400">
                        {t("contacts.colChannel")}
                      </th>
                      <th className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell dark:text-ink-400">
                        {t("contacts.colPipeline")}
                      </th>
                      <th className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 xl:table-cell dark:text-ink-400">
                        {t("contacts.colOwner")}
                      </th>
                      <th className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell dark:text-ink-400">
                        {t("contacts.colTags")}
                      </th>
                      <th className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 xl:table-cell dark:text-ink-400">
                        {t("contacts.colLastMessage")}
                      </th>
                      <th className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell dark:text-ink-400">
                        {t("contacts.colValue")}
                      </th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ink-400">
                        {t("contacts.colScore")}
                      </th>
                      <th className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell dark:text-ink-400">
                        {t("contacts.colSource")}
                      </th>
                      <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-ink-400">
                        {t("contacts.colActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-ink-800">
                    {contacts.map((contact) => {
                      const assignedTagIds = new Set(contact.tags.map((x) => x.tag.id));
                      const availableTags = allTags.filter((x) => !assignedTagIds.has(x.id));

                      return (
                        <tr
                          key={contact.id}
                          className="cursor-pointer transition-colors hover:bg-slate-50/90 dark:hover:bg-ink-900/70"
                          onClick={() => setDrawerContactId(contact.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative shrink-0">
                                <ContactAvatar
                                  contactId={contact.id}
                                  name={contact.name}
                                  profilePictureUrl={contact.profilePictureUrl}
                                  className="h-10 w-10 rounded-xl text-sm"
                                />
                                <span
                                  className={clsx(
                                    "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-ink-900",
                                    contact.recentlyActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-ink-600",
                                  )}
                                  title={
                                    contact.recentlyActive ? t("contacts.online") : t("contacts.offline")
                                  }
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-slate-900 dark:text-ink-50">{contact.name}</p>
                                <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-ink-400">
                                  <Phone className="h-3 w-3 shrink-0" />
                                  {contact.phone}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="hidden max-w-[140px] px-3 py-3 lg:table-cell">
                            <span className="line-clamp-2 text-slate-600 dark:text-ink-300">
                              {contact.account?.name ?? t("contacts.noCompany")}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 text-slate-600 dark:text-ink-300">
                              <ChannelIcon channel={contact.primaryChannel} />
                              <span className="max-w-[100px] truncate text-xs">
                                {contact.inboxName ?? tChannel(contact.primaryChannel ?? "API")}
                              </span>
                            </div>
                          </td>
                          <td className="hidden px-3 py-3 md:table-cell" onClick={(e) => e.stopPropagation()}>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setStagePickerFor(stagePickerFor === contact.id ? null : contact.id)
                                }
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium hover:opacity-90"
                                style={
                                  contact.pipelineStage
                                    ? {
                                        backgroundColor: `${contact.pipelineStage.color}20`,
                                        color: contact.pipelineStage.color,
                                      }
                                    : undefined
                                }
                              >
                                {contact.pipelineStage ? (
                                  <>
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: contact.pipelineStage.color }}
                                    />
                                    <span className="truncate">{contact.pipelineStage.name}</span>
                                    <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
                                  </>
                                ) : (
                                  <span className="flex items-center gap-1 border border-dashed border-slate-300 px-2 py-0.5 text-slate-400 dark:border-ink-600">
                                    <Plus className="h-3 w-3" />
                                    {t("contacts.stage")}
                                  </span>
                                )}
                              </button>
                              <AnimatePresence>
                                {stagePickerFor === contact.id && (
                                  <DropdownPortal onClose={() => setStagePickerFor(null)}>
                                    <motion.div
                                      className="w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900"
                                      variants={dropdownVariants}
                                      initial="hidden"
                                      animate="show"
                                      exit="exit"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => setStage(contact.id, null)}
                                        className="block w-full px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-50 dark:hover:bg-ink-800"
                                      >
                                        {t("contacts.noStage")}
                                      </button>
                                      {allStages.map((stage) => (
                                        <button
                                          key={stage.id}
                                          type="button"
                                          onClick={() => setStage(contact.id, stage.id)}
                                          className={clsx(
                                            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-ink-800",
                                            (contact.pipelineStage?.leadTypeId ?? contact.pipelineStage?.id) ===
                                              stage.id && "bg-slate-50 font-medium dark:bg-ink-800",
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
                                  </DropdownPortal>
                                )}
                              </AnimatePresence>
                            </div>
                          </td>
                          <td className="hidden max-w-[120px] px-3 py-3 xl:table-cell">
                            <span className="truncate text-slate-600 dark:text-ink-300">
                              {contact.assignedTo?.name ?? "—"}
                            </span>
                          </td>
                          <td className="hidden px-3 py-3 lg:table-cell" onClick={(e) => e.stopPropagation()}>
                            <div className="flex max-w-[180px] flex-wrap items-center gap-1">
                              <AnimatePresence mode="popLayout">
                                {filterTagsForDisplay(contact.tags).map(({ tag }) => (
                                  <motion.span
                                    key={tag.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ duration: 0.2 }}
                                    className="inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 pr-1 text-[10px] font-medium"
                                    style={{
                                      backgroundColor: `${tag.color}20`,
                                      color: tag.color,
                                    }}
                                  >
                                    <Tag className="h-2 w-2.5" />
                                    <span className="max-w-[72px] truncate">{tag.name}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeTag(contact.id, tag.id);
                                      }}
                                      className="ml-0.5 rounded-full p-0.5 opacity-50 hover:opacity-100"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  </motion.span>
                                ))}
                              </AnimatePresence>
                              {availableTags.length > 0 && (
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTagPickerFor(tagPickerFor === contact.id ? null : contact.id);
                                    }}
                                    className="rounded-full border border-dashed border-slate-300 p-0.5 text-slate-400 dark:border-ink-600"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                  <AnimatePresence>
                                    {tagPickerFor === contact.id && (
                                      <DropdownPortal onClose={() => setTagPickerFor(null)}>
                                        <motion.div
                                          className="w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900"
                                          variants={dropdownVariants}
                                          initial="hidden"
                                          animate="show"
                                          exit="exit"
                                        >
                                          <p className="px-3 py-1.5 text-xs font-medium text-slate-400">
                                            {t("contacts.addTag")}
                                          </p>
                                          {availableTags.map((tag) => (
                                            <button
                                              key={tag.id}
                                              type="button"
                                              onClick={() => addTag(contact.id, tag.id)}
                                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-ink-800"
                                            >
                                              <span
                                                className="h-2.5 w-2.5 rounded-full"
                                                style={{ backgroundColor: tag.color }}
                                              />
                                              {tag.name}
                                            </button>
                                          ))}
                                        </motion.div>
                                      </DropdownPortal>
                                    )}
                                  </AnimatePresence>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="hidden max-w-[200px] px-3 py-3 xl:table-cell">
                            {contact.lastMessage ? (
                              <div className="space-y-0.5">
                                <p className="line-clamp-2 text-xs text-slate-600 dark:text-ink-300">
                                  {contact.lastMessage.direction === "OUTBOUND" ? "↗ " : "↙ "}
                                  {contact.lastMessage.preview || `(${contact.lastMessage.type})`}
                                </p>
                                <time
                                  className="text-[10px] text-slate-400"
                                  dateTime={contact.lastMessage.createdAt}
                                >
                                  {format(new Date(contact.lastMessage.createdAt), "PPp", { locale: dateLocale })}
                                </time>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="hidden px-3 py-3 lg:table-cell">
                            {contact.openDealCount > 0 ? (
                              <span className="text-xs font-medium text-slate-800 dark:text-ink-200">
                                {formatMoney(contact.openDealsTotalCents, contact.openDealsCurrency)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-800">
                                <div
                                  className="h-full rounded-full bg-brand-500 transition-all"
                                  style={{ width: `${contact.engagementScore}%` }}
                                />
                              </div>
                              <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-ink-200">
                                {contact.engagementScore}
                              </span>
                            </div>
                          </td>
                          <td className="hidden px-3 py-3 md:table-cell">
                            <span className="line-clamp-2 text-xs text-slate-500 dark:text-ink-400">
                              {contact.lifecycleStage ?? t("contacts.sourceUnknown")}
                            </span>
                          </td>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() =>
                                setQuickContact({ id: contact.id, name: contact.name, phone: contact.phone })
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:hover:border-brand-700"
                            >
                              <Send className="h-3.5 w-3.5" />
                              {t("contacts.quickMessage")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-400 dark:border-ink-800 dark:text-ink-500">
                {t("contacts.footerHint")}{" "}
                <Link to="/crm" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {t("contacts.footerKanban")}
                </Link>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>

      <ContactProfileDrawer
        contactId={drawerContactId}
        open={drawerContactId != null}
        onClose={() => setDrawerContactId(null)}
        onQuickMessage={(c) => {
          setQuickContact(c);
          setDrawerContactId(null);
        }}
        tChannel={tChannel}
      />

      <ContactQuickMessageModal
        open={quickContact != null}
        onClose={() => setQuickContact(null)}
        contact={quickContact}
      />
    </PageTransition>
  );
}

function DropdownPortal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute left-0 top-full z-20 mt-1">
      {children}
    </div>
  );
}
