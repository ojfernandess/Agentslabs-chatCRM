import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { EmojiPickerPopover } from "@/components/EmojiPickerPopover";
import { insertTextAtSelection } from "@/lib/insertTextAtSelection";
import type { EmojiCategoryId } from "@/lib/emojiPickerData";
import {
  Send,
  ArrowLeft,
  User,
  AlertTriangle,
  CheckCircle,
  PauseCircle,
  RotateCcw,
  Mic,
  Square,
  Paperclip,
  ImagePlus,
  Lock,
  Check,
  CheckCheck,
  ArrowRightLeft,
  Smile,
  Sparkles,
  LayoutGrid,
  Kanban,
  Clock,
  ChevronLeft,
  ChevronRight,
  Tag,
  Plus,
  Pencil,
  X,
  Trash2,
  Maximize2,
  Minimize2,
  PenLine,
  FileText,
  Star,
  Bot,
  Headset,
  MessageSquare,
  Briefcase,
  Circle,
  Loader2,
  Brain,
  Mail,
  MoreHorizontal,
} from "lucide-react";
import clsx from "clsx";
import { format, differenceInHours, differenceInMinutes, formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence, backdropVariants, modalVariants } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedConversationUpdated } from "@/hooks/useDebouncedConversationUpdated";
import { localDueToIso, tomorrowLocalYmd } from "@/lib/reminderDue";
import { isTenantAdmin } from "@/lib/authRole";
import { readSendShortcutPref } from "@/lib/profilePrefs";
import { formatCurrencyUnits } from "@/lib/currency";
import {
  isPipelineClosureActiveForRollup,
  shouldDisplayClosureValueBadge,
} from "@/lib/closureValueRollup";
import { TemplateSendModal } from "@/components/TemplateSendModal";
import { ConversationListAvatar } from "@/components/ConversationListAvatar";
import { ContactAvatar } from "@/components/ContactAvatar";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import {
  ConversationPriorityBadge,
  ConversationPriorityPicker,
} from "@/components/ConversationPriorityBadge";
import type { ConversationPriority } from "@/lib/conversationPriority";
import {
  ChatImageThumbnail,
  DocumentAttachmentCard,
  isLikelyDocumentCaption,
} from "@/components/conversation/MessageAttachmentViews";
import { ImageLightboxModal } from "@/components/conversation/ImageLightboxModal";
import {
  timelineChannelLabel,
  timelineEventSummary,
  timelineEventTitle,
  type TimelinePayload,
} from "@/lib/contactTimeline";

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
  actorUser?: { id: string; name: string; displayName: string | null; showAgentNameInChat?: boolean } | null;
}

interface LeadTypeRow {
  id: string;
  name: string;
  color: string;
  valueRollup?: string;
}

type CopilotInsights = {
  summary: string;
  intent: string;
  sentiment: "positive" | "neutral" | "negative" | "frustrated";
  suggestedActions: string[];
  conversionOutlook: string;
  alerts: string[];
};

interface ContactTimelineEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  channel: string | null;
  payload: unknown;
  actorUser?: { id: string; name: string; email?: string } | null;
}

interface MessageTemplateRow {
  id: string;
  name: string;
  body: string;
  bodyVariableCount: number;
  providerTemplateId?: string | null;
  metaCategory?: string | null;
  templateLanguage?: string;
}

interface CannedResponseRow {
  id: string;
  shortcut: string;
  content: string;
}

interface OrgTagRow {
  id: string;
  name: string;
  color: string;
}

interface ClosureRecordRow {
  id: string;
  sessionIndex: number;
  resolvedAt: string;
  reopenedAt: string | null;
  isNewAttendance: boolean;
  closureReason: string | null;
  closureValue: number | null;
  csatScore: number | null;
  csatComment: string | null;
  csatRecordedAt: string | null;
  resolvedBy: { id: string; name: string; email?: string } | null;
  reopenedBy: { id: string; name: string; email?: string } | null;
  assignedTo: { id: string; name: string; email?: string } | null;
  team: { id: string; name: string } | null;
  leadType: LeadTypeRow | null;
}

interface ConversationDetail {
  id: string;
  status: string;
  priority?: ConversationPriority | null;
  createdAt: string;
  closureReason: string | null;
  closureValue?: number | null;
  csatScore?: number | null;
  csatComment?: string | null;
  csatRecordedAt?: string | null;
  csatSurveyPending?: boolean;
  leadType: LeadTypeRow | null;
  closureRecords?: ClosureRecordRow[];
  reopenClosureDefaults?: {
    leadTypeId: string | null;
    closureValue: number | null;
    afterWonSale: boolean;
  } | null;
  assignedTo?: { id: string; name: string } | null;
  /** Presente na API — caixa e flag do bot por canal. */
  inbox?: { id: string; name: string; isDefault?: boolean; channelType?: string } | null;
  agentBotTriageActive?: boolean;
  awaitingHumanHandoff?: boolean;
  contact: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    notes?: string | null;
    lifecycleStage?: string | null;
    profilePictureUrl?: string | null;
    hasAvatar?: boolean;
    thumbnail?: string | null;
    assignedTo?: { id: string; name: string } | null;
    createdBy?: { id: string; name: string } | null;
    tags?: { tag: { id: string; name: string; color: string } }[];
    pipelineStage?: {
      id: string;
      name: string;
      color: string;
      pipeline?: { id: string; name: string };
    } | null;
  };
  team: { id: string; name: string } | null;
  messages?: Message[];
  contactTimeline?: ContactTimelineEvent[];
}

const MSG_GROUP_MINUTES = 5;
const PRESENCE_RECENT_MINUTES = 15;

function messageGroupedWithPrevious(messages: Message[], index: number): boolean {
  if (index <= 0) return false;
  const prev = messages[index - 1];
  const cur = messages[index];
  if (prev.direction !== cur.direction || !!prev.isPrivate !== !!cur.isPrivate) return false;
  return differenceInMinutes(new Date(cur.createdAt), new Date(prev.createdAt)) <= MSG_GROUP_MINUTES;
}

function messageGroupedWithNext(messages: Message[], index: number): boolean {
  if (index >= messages.length - 1) return false;
  const cur = messages[index];
  const next = messages[index + 1];
  if (next.direction !== cur.direction || !!next.isPrivate !== !!cur.isPrivate) return false;
  return differenceInMinutes(new Date(next.createdAt), new Date(cur.createdAt)) <= MSG_GROUP_MINUTES;
}

export function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();
  const { user } = useAuth();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const funnelEnabled = user?.organizationFeatures?.crm_kanban ?? true;
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
  const [resolveRequireClosureReason, setResolveRequireClosureReason] = useState(true);
  const [resolveRequireLeadType, setResolveRequireLeadType] = useState(true);
  const [resolveOfferReminder, setResolveOfferReminder] = useState(true);
  const [createReminderOnResolve, setCreateReminderOnResolve] = useState(false);
  const [reminderNote, setReminderNote] = useState("");
  const [reminderDueDate, setReminderDueDate] = useState("");
  const [reminderDueTime, setReminderDueTime] = useState("09:00");
  const showRemindersFeature = user?.organizationFeatures?.reminders !== false;
  const [flowError, setFlowError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [teamPickerId, setTeamPickerId] = useState("");
  const [evolutionRichChat, setEvolutionRichChat] = useState(false);
  const [whatsappProvider, setWhatsappProvider] = useState<string | null>(null);
  const [templateModalTemplate, setTemplateModalTemplate] = useState<MessageTemplateRow | null>(null);
  const [agentBotTriageActive, setAgentBotTriageActive] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [privateNote, setPrivateNote] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTeamId, setTransferTeamId] = useState("");
  const [transferAssigneeId, setTransferAssigneeId] = useState("");
  const [transferMembers, setTransferMembers] = useState<{ id: string; name: string }[]>([]);
  const [crmMobileOpen, setCrmMobileOpen] = useState(false);
  const [crmDesktopOpen, setCrmDesktopOpen] = useState(true);
  const [copilotMobileOpen, setCopilotMobileOpen] = useState(false);
  const [copilotDesktopOpen, setCopilotDesktopOpen] = useState(false);
  const [pilotFlags, setPilotFlags] = useState<{
    assistantAiEnabled: boolean;
    aiPilotAccessEnabled: boolean;
    openAiConfigured?: boolean;
  } | null>(null);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotError, setCopilotError] = useState("");
  const [copilotInsights, setCopilotInsights] = useState<CopilotInsights | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [cannedMenuOpen, setCannedMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplateRow[]>([]);
  const [cannedResponses, setCannedResponses] = useState<CannedResponseRow[]>([]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [suggestReplyBusy, setSuggestReplyBusy] = useState(false);
  const [voicePreview, setVoicePreview] = useState<{ blob: Blob; ext: string } | null>(null);
  const voicePreviewUrl = useMemo(
    () => (voicePreview ? URL.createObjectURL(voicePreview.blob) : null),
    [voicePreview],
  );
  const [orgTags, setOrgTags] = useState<OrgTagRow[]>([]);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagAddSelectId, setTagAddSelectId] = useState("");
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagModalPhase, setTagModalPhase] = useState<"list" | "form">("list");
  const [tagModalFormEditingId, setTagModalFormEditingId] = useState<string | null>(null);
  const [tagModalFormFromList, setTagModalFormFromList] = useState(false);
  const [tagFormName, setTagFormName] = useState("");
  const [tagFormColor, setTagFormColor] = useState("#6366f1");
  const [tagFormError, setTagFormError] = useState("");
  const [newContactNoteDraft, setNewContactNoteDraft] = useState("");
  const [contactNotesBusy, setContactNotesBusy] = useState(false);
  const [contactNotesError, setContactNotesError] = useState("");
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [priorityError, setPriorityError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resolveNextIdRef = useRef<string | null>(null);
  /** Evita repor lead/valor a cada poll da conversa enquanto o modal está aberto. */
  const resolveFormInitializedRef = useRef(false);

  const openResolveModal = useCallback((nextId: string | null) => {
    resolveNextIdRef.current = nextId;
    setResolveError("");
    setCreateReminderOnResolve(false);
    setReminderNote("");
    setReminderDueDate(tomorrowLocalYmd());
    setReminderDueTime("09:00");
    resolveFormInitializedRef.current = false;
    setResolveOpen(true);
  }, []);

  useEffect(() => {
    if (!resolveOpen) {
      resolveFormInitializedRef.current = false;
      return;
    }
    if (!conversation || resolveFormInitializedRef.current) return;
    resolveFormInitializedRef.current = true;

    const d = conversation.reopenClosureDefaults;
    if (d?.afterWonSale) {
      setClosureAmount("");
      setLeadTypeId("");
      setClosureReason("");
      return;
    }
    setLeadTypeId(d?.leadTypeId ?? "");
    if (d?.closureValue != null && d.closureValue > 0) {
      setClosureAmount(String(d.closureValue));
    } else {
      setClosureAmount("");
    }
    if (!d) {
      setClosureReason("");
    }
  }, [resolveOpen, conversation]);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const templateWrapRef = useRef<HTMLDivElement>(null);
  const cannedWrapRef = useRef<HTMLDivElement>(null);

  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** Só faz auto-scroll ao fundo se o utilizador já estava junto ao fundo (evita saltar ao fazer poll / ler histórico). */
  const stickToBottomRef = useRef(true);
  const seenMessageIds = useRef(new Set<string>());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    void api
      .get<{ assistantAiEnabled: boolean; aiPilotAccessEnabled: boolean; openAiConfigured?: boolean }>(
        "/settings/pilot",
      )
      .then((res) => {
        if (!cancelled) setPilotFlags(res);
      })
      .catch(() => {
        if (!cancelled) setPilotFlags({ assistantAiEnabled: true, aiPilotAccessEnabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { assistantAiEnabled: boolean; aiPilotAccessEnabled: boolean; openAiConfigured?: boolean }
        | undefined;
      if (!detail) return;
      setPilotFlags(detail);
    };
    window.addEventListener("openconduit:pilot-flags-updated", on as EventListener);
    return () => window.removeEventListener("openconduit:pilot-flags-updated", on as EventListener);
  }, []);

  const assistantAiEnabled = pilotFlags?.assistantAiEnabled ?? true;
  const aiPilotAccessEnabled = pilotFlags?.aiPilotAccessEnabled ?? false;
  const copilotEnabled = assistantAiEnabled && aiPilotAccessEnabled;

  useEffect(() => {
    if (copilotEnabled) return;
    setCopilotDesktopOpen(false);
    setCopilotMobileOpen(false);
    setCopilotBusy(false);
    setCopilotError("");
    setCopilotInsights(null);
  }, [copilotEnabled]);

  const toggleCopilotPanel = () => {
    if (!copilotEnabled) return;
    if (window.matchMedia && window.matchMedia("(min-width: 1280px)").matches) {
      setCopilotDesktopOpen((o) => !o);
      return;
    }
    setCopilotMobileOpen(true);
  };

  const loadCopilotInsights = useCallback(
    async (mode: "summary" | "evaluate") => {
      if (!id || !copilotEnabled) return;
      setCopilotBusy(true);
      setCopilotError("");
      try {
        const res = await api.post<{ insights: CopilotInsights }>(`/conversations/${id}/insights`, {});
        setCopilotInsights(res.insights);
        if (mode === "summary") return;
      } catch (e) {
        if (e instanceof ApiError && (e as unknown as { code?: string }).code === "ai_disabled") {
          setPilotFlags((prev) => (prev ? { ...prev, assistantAiEnabled: false } : { assistantAiEnabled: false, aiPilotAccessEnabled: false }));
          setCopilotError(t("aiInsightsPage.aiDisabled"));
        } else {
          setCopilotError(e instanceof ApiError ? e.message : t("aiInsightsPage.analyzeError"));
        }
        setCopilotInsights(null);
      } finally {
        setCopilotBusy(false);
      }
    },
    [id, copilotEnabled, t],
  );

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem("openconduit_conversation_last_opened_id", id);
    } catch {
    }
  }, [id]);

  const nextConversationId = useCallback(
    (direction: "next" | "prev") => {
      if (!id) return null;
      try {
        const raw = localStorage.getItem("openconduit_conversation_list_ids");
        if (!raw) return null;
        const list = JSON.parse(raw) as unknown;
        if (!Array.isArray(list)) return null;
        const ids = list.filter((x): x is string => typeof x === "string");
        const idx = ids.indexOf(id);
        if (idx < 0) return null;
        const nextIdx = direction === "next" ? idx + 1 : idx - 1;
        return ids[nextIdx] ?? null;
      } catch {
        return null;
      }
    },
    [id],
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!id) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || !!el?.isContentEditable;

      const k = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (e.altKey && k === "l") {
        e.preventDefault();
        setPrivateNote(false);
        return;
      }
      if (e.altKey && k === "p") {
        e.preventDefault();
        setPrivateNote(true);
        return;
      }

      if (e.altKey && k === "a") {
        e.preventDefault();
        if (!typing) fileInputRef.current?.click();
        return;
      }
      if (mod && k === "a") {
        e.preventDefault();
        if (!typing) fileInputRef.current?.click();
        return;
      }

      if (e.altKey && k === "e") {
        e.preventDefault();
        openResolveModal(null);
        return;
      }
      if (mod && k === "e") {
        e.preventDefault();
        openResolveModal(nextConversationId("next"));
        return;
      }

      if (e.altKey && k === "j") {
        const nextId = nextConversationId("next");
        if (!nextId) return;
        e.preventDefault();
        navigate(`/conversations/${nextId}`);
        return;
      }
      if (e.altKey && k === "k") {
        const prevId = nextConversationId("prev");
        if (!prevId) return;
        e.preventDefault();
        navigate(`/conversations/${prevId}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, navigate, nextConversationId, openResolveModal]);

  const onMessagesViewportScroll = useCallback(() => {
    const el = messagesViewportRef.current;
    if (!el) return;
    const threshold = 120;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    };
  }, [voicePreviewUrl]);

  const loadConversation = useCallback(async () => {
    try {
      const data = await api.get<ConversationDetail>(`/conversations/${id}`);
      setConversation(data);
      setTeamPickerId(data.team?.id ?? "");
      setAgentBotTriageActive(data.agentBotTriageActive ?? false);
      void api.post(`/conversations/${id}/read`).then(() => {
        window.dispatchEvent(new CustomEvent("openconduit:team-transfer-badges-refresh"));
      });
    } catch {
      /* failed */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setNewContactNoteDraft("");
    setContactNotesError("");
    setContactNotesBusy(false);
  }, [conversation?.contact.id]);

  useEffect(() => {
    async function loadChannel() {
      try {
        const inboxId = conversation?.inbox?.id;
        const path = inboxId
          ? `/settings/channel?inboxId=${encodeURIComponent(inboxId)}`
          : "/settings/channel";
        const ch = await api.get<{
          evolutionRichChat: boolean;
          whatsappProvider?: string | null;
        }>(path);
        setEvolutionRichChat(ch.evolutionRichChat);
        setWhatsappProvider(ch.whatsappProvider ?? null);
      } catch {
        setEvolutionRichChat(false);
        setWhatsappProvider(null);
      }
    }
    void loadChannel();
  }, [conversation?.inbox?.id]);

  useEffect(() => {
    void (async () => {
      try {
        const [rows, wf] = await Promise.all([
          api.get<LeadTypeRow[]>("/lead-types"),
          api.get<{
            resolveRequireClosureReason: boolean;
            resolveRequireLeadType: boolean;
            resolveOfferReminder: boolean;
          }>("/settings/conversation-workflow"),
        ]);
        setLeadTypes(rows);
        setResolveRequireClosureReason(wf.resolveRequireClosureReason ?? true);
        setResolveRequireLeadType(wf.resolveRequireLeadType ?? true);
        setResolveOfferReminder(wf.resolveOfferReminder ?? true);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    async function loadTeams() {
      try {
        const res = await api.get<{ data: { id: string; name: string }[] }>("/teams");
        setTeamOptions(res.data.map((x) => ({ id: x.id, name: x.name })));
      } catch {
        setTeamOptions([]);
      }
    }
    void loadTeams();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await api.get<OrgTagRow[]>("/tags");
        setOrgTags(rows);
      } catch {
        setOrgTags([]);
      }
    })();
  }, []);

  useEffect(() => {
    setTagAddSelectId("");
  }, [conversation?.contact.id]);

  useEffect(() => {
    let cancelled = false;
    const inboxId = conversation?.inbox?.id;
    void (async () => {
      try {
        const q = inboxId ? `?inboxId=${encodeURIComponent(inboxId)}` : "";
        const rows = await api.get<MessageTemplateRow[]>(`/templates${q}`);
        if (!cancelled) {
          let list = (Array.isArray(rows) ? rows : []).map((r) => ({
            ...r,
            bodyVariableCount: typeof r.bodyVariableCount === "number" ? r.bodyVariableCount : 0,
          }));
          if (whatsappProvider === "evolution" || whatsappProvider === "evolution_go") {
            list = list.filter((r) => !r.providerTemplateId?.trim());
          } else if (whatsappProvider === "meta" || whatsappProvider === "360dialog") {
            list = list.filter((r) => Boolean(r.metaCategory?.trim() || r.providerTemplateId?.trim()));
          }
          setMessageTemplates(list);
        }
      } catch {
        if (!cancelled) setMessageTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation?.inbox?.id, whatsappProvider]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.get<CannedResponseRow[]>("/canned-responses");
        if (!cancelled) setCannedResponses(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setCannedResponses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyCannedResponse = useCallback((row: CannedResponseRow) => {
    setNewMessage(row.content);
    setCannedMenuOpen(false);
    setTemplateMenuOpen(false);
    setEmojiOpen(false);
  }, []);

  const onComposerChange = useCallback(
    (value: string) => {
      const match = value.match(/\/([a-zA-Z0-9_-]+)\s$/);
      if (match) {
        const key = match[1].toLowerCase();
        const found = cannedResponses.find((c) => c.shortcut === key);
        if (found) {
          setNewMessage(value.replace(/\/[a-zA-Z0-9_-]+\s$/, found.content));
          return;
        }
      }
      setNewMessage(value);
    },
    [cannedResponses],
  );

  const cannedSlashFilter = useMemo(() => {
    const m = newMessage.match(/\/([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    const q = m[1].toLowerCase();
    return cannedResponses.filter((c) => c.shortcut.startsWith(q));
  }, [newMessage, cannedResponses]);

  useEffect(() => {
    if (!emojiOpen && !templateMenuOpen && !cannedMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (emojiOpen && emojiWrapRef.current && !emojiWrapRef.current.contains(node)) setEmojiOpen(false);
      if (templateMenuOpen && templateWrapRef.current && !templateWrapRef.current.contains(node)) setTemplateMenuOpen(false);
      if (cannedMenuOpen && cannedWrapRef.current && !cannedWrapRef.current.contains(node)) setCannedMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [emojiOpen, templateMenuOpen, cannedMenuOpen]);

  useEffect(() => {
    if (!transferOpen || !transferTeamId) {
      setTransferMembers([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const team = await api.get<{
          members: { userId: string; user: { id: string; name: string; email: string } }[];
        }>(`/teams/${transferTeamId}`);
        const rows = team.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
        }));
        if (!cancelled) setTransferMembers(rows);
      } catch {
        if (!cancelled) setTransferMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transferOpen, transferTeamId]);

  useEffect(() => {
    if (!transferAssigneeId || transferMembers.length === 0) return;
    if (!transferMembers.some((m) => m.id === transferAssigneeId)) {
      setTransferAssigneeId("");
    }
  }, [transferMembers, transferAssigneeId]);

  useEffect(() => {
    void loadConversation();
    const interval = setInterval(() => void loadConversation(), 5000);
    return () => clearInterval(interval);
  }, [loadConversation]);

  useDebouncedConversationUpdated(() => {
    void loadConversation();
  }, { conversationId: id });

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [conversation?.messages]);

  const lastInbound = conversation?.messages?.filter((m) => m.direction === "INBOUND").at(-1);

  const fmtMoney = (n: number) => formatCurrencyUnits(n);

  /** Corpo enviado ao cliente: anexa assinatura do perfil só em mensagens públicas. */
  const outboundBodyWithSignature = (text: string, isPrivate: boolean): string => {
    const trimmed = text.trim();
    if (isPrivate) return trimmed;
    const sig = user?.messageSignature?.trim();
    if (!sig) return trimmed;
    return trimmed ? `${trimmed}\n\n${sig}` : sig;
  };

  const composerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    const pref = readSendShortcutPref();
    const canSend =
      !!newMessage.trim() &&
      !!conversation &&
      !(isOutsideWindow && !privateNote) &&
      !recording &&
      !voicePreview &&
      !sending &&
      !attachBusy;
    if (pref === "mod_enter") {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (canSend) e.currentTarget.form?.requestSubmit();
      }
      return;
    }
    if (!e.shiftKey) {
      e.preventDefault();
      if (canSend) e.currentTarget.form?.requestSubmit();
    }
  };

  /** Meta / 360dialog / Twilio seguem janela de sessão de 24h; Evolution API não. */
  const applies24hSessionPolicy =
    whatsappProvider === "meta" ||
    whatsappProvider === "360dialog" ||
    whatsappProvider === "twilio" ||
    whatsappProvider == null;

  const isOutsideWindow =
    applies24hSessionPolicy &&
    (lastInbound ? differenceInHours(new Date(), new Date(lastInbound.createdAt)) > 24 : true);

  const isWaba = whatsappProvider === "meta" || whatsappProvider === "360dialog";

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

  async function sendVoiceFromPreview() {
    if (!conversation || !voicePreview) return;
    if (isOutsideWindow && !privateNote) return;
    setVoiceBusy(true);
    setFlowError("");
    const { blob, ext } = voicePreview;
    try {
      const { mediaUrl, mimeType } = await api.uploadMessageAudio(blob, `voice.${ext}`);
      const voiceBody = outboundBodyWithSignature("", privateNote);
      await api.post("/messages", {
        contactId: conversation.contact.id,
        conversationId: conversation.id,
        type: "AUDIO",
        mediaUrl,
        mediaType: mimeType,
        ...(voiceBody ? { body: voiceBody } : {}),
        isPrivate: privateNote || undefined,
      });
      setVoicePreview(null);
      stickToBottomRef.current = true;
      await loadConversation();
    } catch {
      setFlowError(t("conversationDetail.voiceSendFailed"));
    } finally {
      setVoiceBusy(false);
    }
  }

  async function handleVoiceToggle() {
    if (!conversation || voiceBusy) return;
    if (isOutsideWindow && !privateNote) return;

    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      return;
    }

    if (!canUseVoiceRecording()) {
      setFlowError(t("conversationDetail.voiceNeedsHttps"));
      return;
    }

    if (voicePreview) {
      setVoicePreview(null);
    }

    const contactId = conversation.contact.id;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = createVoiceMediaRecorder(stream);
      mediaChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setRecording(false);
        const blobType = mr.mimeType || "audio/webm";
        const ext = blobType.includes("mp4") || blobType.includes("aac") ? "m4a" : "webm";
        const blob = new Blob(mediaChunksRef.current, { type: blobType });
        mediaChunksRef.current = [];
        if (blob.size < 1) return;
        setVoicePreview({ blob, ext });
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
      const caption = outboundBodyWithSignature(newMessage, privateNote);
      await api.post("/messages", {
        contactId: conversation.contact.id,
        conversationId: conversation.id,
        type: kind,
        mediaUrl,
        mediaType: mimeType,
        ...(caption ? { body: caption } : {}),
        isPrivate: privateNote || undefined,
      });
      setNewMessage("");
      stickToBottomRef.current = true;
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
        conversationId: conversation.id,
        type: "TEXT",
        body: outboundBodyWithSignature(newMessage, privateNote),
        isPrivate: privateNote || undefined,
      });
      setNewMessage("");
      stickToBottomRef.current = true;
      await loadConversation();
    } catch {
      /* send failed */
    } finally {
      setSending(false);
    }
  };

  const handleAiSuggestReply = useCallback(async () => {
    if (!copilotEnabled) return;
    if (!id || privateNote || !conversation) return;
    setSuggestReplyBusy(true);
    setFlowError("");
    try {
      const draft = newMessage.trim();
      const { suggestion } = await api.post<{ suggestion: string }>(`/conversations/${id}/suggest-reply`, {
        currentDraft: draft || undefined,
      });
      const s = suggestion.trim();
      if (!s) {
        setFlowError(t("conversationDetail.generateReplyError"));
        return;
      }
      setNewMessage((prev) => (prev.trim() ? `${prev.trim()}\n\n` : "") + s);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("conversationDetail.generateReplyError");
      setFlowError(msg);
    } finally {
      setSuggestReplyBusy(false);
    }
  }, [copilotEnabled, id, privateNote, conversation, newMessage, t]);

  const applyStatus = async (
    status: "OPEN" | "PENDING" | "RESOLVED",
    extra?: {
      closureReason?: string | null;
      leadTypeId?: string | null;
      closureValue?: number | null;
      assignedToId?: string | null;
    },
  ) => {
    if (!conversation || !id) return;
    setActionLoading(true);
    setResolveError("");
    setFlowError("");
    try {
      const body: Record<string, unknown> = { status };
      if (extra && "closureReason" in extra && extra.closureReason !== undefined) {
        body.closureReason = extra.closureReason;
      }
      if (extra && "leadTypeId" in extra && extra.leadTypeId !== undefined) {
        body.leadTypeId = extra.leadTypeId;
      }
      if (extra && "closureValue" in extra) {
        body.closureValue = extra.closureValue;
      }
      if (extra && "assignedToId" in extra) {
        body.assignedToId = extra.assignedToId;
      }
      const data = await api.put<ConversationDetail>(`/conversations/${id}`, body);
      setConversation(data);
      setResolveOpen(false);
      setClosureReason("");
      setClosureAmount("");
      setLeadTypeId("");
      setCreateReminderOnResolve(false);
      setReminderNote("");
      setReminderDueDate("");
      setReminderDueTime("09:00");
      if (status === "RESOLVED" && resolveNextIdRef.current) {
        const nextId = resolveNextIdRef.current;
        resolveNextIdRef.current = null;
        navigate(`/conversations/${nextId}`);
      }
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

  const saveConversationPriority = async (priority: ConversationPriority | null) => {
    if (!conversation || !id) return;
    setPriorityBusy(true);
    setPriorityError("");
    try {
      const data = await api.put<ConversationDetail>(`/conversations/${id}`, { priority });
      setConversation(data);
      window.dispatchEvent(
        new CustomEvent("openconduit:conversation-updated", { detail: { conversationId: id } }),
      );
    } catch {
      setPriorityError(t("conversationDetail.prioritySaveFailed"));
    } finally {
      setPriorityBusy(false);
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

  const refreshOrgTags = async () => {
    try {
      const rows = await api.get<OrgTagRow[]>("/tags");
      setOrgTags(rows);
    } catch {
      setOrgTags([]);
    }
  };

  const addContactTag = async (tagId: string) => {
    if (!conversation || !tagId) return;
    setTagBusy(true);
    try {
      const updated = await api.post<{ tags: NonNullable<ConversationDetail["contact"]["tags"]> }>(
        `/contacts/${conversation.contact.id}/tags`,
        { tagIds: [tagId] },
      );
      setConversation((c) => (c ? { ...c, contact: { ...c.contact, tags: updated.tags } } : c));
      setTagAddSelectId("");
    } catch {
      /* ignore */
    } finally {
      setTagBusy(false);
    }
  };

  const removeContactTag = async (tagId: string) => {
    if (!conversation) return;
    setTagBusy(true);
    try {
      await api.delete(`/contacts/${conversation.contact.id}/tags/${tagId}`);
      setConversation((c) => {
        if (!c) return c;
        return {
          ...c,
          contact: {
            ...c.contact,
            tags: (c.contact.tags ?? []).filter((x) => x.tag.id !== tagId),
          },
        };
      });
    } catch {
      /* ignore */
    } finally {
      setTagBusy(false);
    }
  };

  const openTagModalCreate = (fromList: boolean) => {
    setTagFormError("");
    setTagFormName("");
    setTagFormColor("#6366f1");
    setTagModalFormEditingId(null);
    setTagModalFormFromList(fromList);
    setTagModalPhase("form");
    setTagModalOpen(true);
  };

  const openTagModalManage = () => {
    setTagFormError("");
    setTagModalPhase("list");
    setTagModalOpen(true);
  };

  const openTagModalEdit = (tag: OrgTagRow) => {
    setTagFormError("");
    setTagFormName(tag.name);
    setTagFormColor(tag.color);
    setTagModalFormEditingId(tag.id);
    setTagModalFormFromList(true);
    setTagModalPhase("form");
    setTagModalOpen(true);
  };

  const closeTagModal = () => {
    setTagModalOpen(false);
    setTagFormError("");
    setTagModalPhase("list");
    setTagModalFormEditingId(null);
    setTagModalFormFromList(false);
  };

  const tagFormGoBack = () => {
    setTagFormError("");
    if (tagModalFormFromList) {
      setTagModalPhase("list");
      setTagModalFormEditingId(null);
    } else {
      closeTagModal();
    }
  };

  const submitTagForm = async (e: FormEvent) => {
    e.preventDefault();
    setTagFormError("");
    const name = tagFormName.trim();
    if (name.length < 1 || name.length > 50) {
      setTagFormError(t("conversationDetail.tagNameInvalid"));
      return;
    }
    const color = tagFormColor.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      setTagFormError(t("conversationDetail.tagColorInvalid"));
      return;
    }
    setTagBusy(true);
    try {
      if (tagModalFormEditingId) {
        const updated = await api.put<OrgTagRow>(`/tags/${tagModalFormEditingId}`, { name, color });
        setOrgTags((prev) =>
          [...prev.filter((x) => x.id !== updated.id), updated].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
        setConversation((c) => {
          if (!c) return c;
          return {
            ...c,
            contact: {
              ...c.contact,
              tags: (c.contact.tags ?? []).map((ct) =>
                ct.tag.id === updated.id ? { tag: updated } : ct,
              ),
            },
          };
        });
      } else {
        const created = await api.post<OrgTagRow>("/tags", { name, color });
        await refreshOrgTags();
        void created;
      }
      if (tagModalFormFromList) {
        setTagModalPhase("list");
        setTagModalFormEditingId(null);
      } else {
        closeTagModal();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setTagFormError(msg || t("conversationDetail.tagSaveFailed"));
    } finally {
      setTagBusy(false);
    }
  };

  const deleteOrgTag = async (tag: OrgTagRow) => {
    if (!window.confirm(t("conversationDetail.tagDeleteConfirm"))) return;
    setTagBusy(true);
    try {
      await api.delete(`/tags/${tag.id}`);
      await refreshOrgTags();
      setConversation((c) => {
        if (!c) return c;
        return {
          ...c,
          contact: {
            ...c.contact,
            tags: (c.contact.tags ?? []).filter((x) => x.tag.id !== tag.id),
          },
        };
      });
    } catch {
      /* ignore */
    } finally {
      setTagBusy(false);
    }
  };

  const submitTransfer = async () => {
    if (!conversation || !id || !transferTeamId) return;
    setActionLoading(true);
    setFlowError("");
    try {
      const data = await api.put<ConversationDetail>(`/conversations/${id}`, {
        teamId: transferTeamId,
        assignedToId: transferAssigneeId || null,
      });
      setConversation(data);
      setTeamPickerId(data.team?.id ?? "");
      setTransferOpen(false);
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
    const wantReminder =
      showRemindersFeature && resolveOfferReminder && createReminderOnResolve && conversation;
    if (wantReminder) {
      if (!reminderNote.trim() || !reminderDueDate) {
        setResolveError(t("conversationDetail.resolveReminderFieldsRequired"));
        return;
      }
    }
    if (resolveRequireClosureReason && closureReason.trim().length < 3) {
      setResolveError(t("conversationDetail.closureReasonHint"));
      return;
    }
    if (resolveRequireLeadType && !leadTypeId) {
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
    const extra: {
      closureReason?: string | null;
      leadTypeId?: string | null;
      closureValue?: number | null;
    } = { closureValue };
    if (resolveRequireClosureReason) {
      extra.closureReason = closureReason.trim();
    } else {
      extra.closureReason = closureReason.trim().length > 0 ? closureReason.trim() : null;
    }
    if (resolveRequireLeadType) {
      extra.leadTypeId = leadTypeId;
    } else {
      extra.leadTypeId = leadTypeId || null;
    }

    let reminderPayload: { contactId: string; note: string; dueDate: string; dueTime: string } | null =
      null;
    if (wantReminder && conversation) {
      reminderPayload = {
        contactId: conversation.contact.id,
        note: reminderNote.trim(),
        dueDate: reminderDueDate,
        dueTime: reminderDueTime,
      };
    }

    await applyStatus("RESOLVED", extra);

    if (reminderPayload) {
      try {
        const dueAt = localDueToIso(reminderPayload.dueDate, reminderPayload.dueTime);
        await api.post("/reminders", {
          contactId: reminderPayload.contactId,
          note: reminderPayload.note,
          dueAt,
        });
      } catch {
        setFlowError(t("conversationDetail.resolveReminderCreateFailed"));
      }
    }
  };

  const statusLabel = (s: string) => {
    if (s === "OPEN") return t("conversationDetail.statusOpen");
    if (s === "PENDING") return t("conversationDetail.statusPending");
    if (s === "RESOLVED") return t("conversationDetail.statusResolved");
    return s;
  };

  const contactTimelinePreview = useMemo((): ContactTimelineEvent[] => {
    const c = conversation;
    if (!c) return [];
    const channelType = c.inbox?.channelType;
    const channelLabel =
      channelType === "WHATSAPP"
        ? t("conversationDetail.channelLabelWhatsapp")
        : channelType
          ? String(channelType)
          : null;
    const synthetic: ContactTimelineEvent = {
      id: `local:conv-started:${c.id}`,
      occurredAt: c.createdAt || c.messages?.[0]?.createdAt || new Date().toISOString(),
      eventType: "conversation.started",
      channel: channelType === "WHATSAPP" ? "whatsapp" : null,
      payload: {
        inboxName: c.inbox?.name ?? null,
        channelLabel,
      },
      actorUser: null,
    };
    const merged = [...(c.contactTimeline ?? []), synthetic];
    merged.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    return merged.slice(-18);
  }, [conversation, t]);

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
        <p className="text-ink-500 dark:text-ink-400">{t("conversationDetail.notFound")}</p>
      </div>
    );
  }

  const assigneeId = conversation.assignedTo?.id;
  const hasHumanAssignee = typeof assigneeId === "string" && assigneeId.length > 0;
  const hasNoHumanAssignee = !hasHumanAssignee;
  const canResolve =
    (conversation.status === "OPEN" || conversation.status === "PENDING") && hasHumanAssignee;
  const canTransfer = canResolve && teamOptions.length > 0;
  const inBotQueueOnly =
    (conversation.status === "OPEN" || conversation.status === "PENDING") &&
    hasNoHumanAssignee &&
    agentBotTriageActive &&
    !conversation.awaitingHumanHandoff;
  const showTransferToBot =
    agentBotTriageActive &&
    (conversation.status === "OPEN" || conversation.status === "PENDING") &&
    hasHumanAssignee;
  const isWhatsappInbox = conversation.inbox?.channelType === "WHATSAPP";
  const canStartAttendance =
    Boolean(user?.id) && hasNoHumanAssignee && (conversation.status === "OPEN" || conversation.status === "PENDING");
  const transferUnchanged =
    transferTeamId === (conversation.team?.id ?? "") &&
    (transferAssigneeId || null) === (conversation.assignedTo?.id ?? null);

  const messages = conversation.messages ?? [];
  const lastMsg = messages.length ? messages[messages.length - 1] : null;
  const minutesSinceActivity = lastMsg ? differenceInMinutes(new Date(), new Date(lastMsg.createdAt)) : 999;
  const presenceRecent = minutesSinceActivity < PRESENCE_RECENT_MINUTES;
  const clientWaiting =
    (conversation.status === "OPEN" || conversation.status === "PENDING") &&
    lastMsg &&
    lastMsg.direction === "INBOUND" &&
    !lastMsg.isPrivate;
  const clientWaitLabel =
    clientWaiting && lastInbound
      ? formatDistanceToNow(new Date(lastInbound.createdAt), { locale: dateLocale, addSuffix: true })
      : null;

  const addContactNote = async () => {
    if (!conversation) return;
    const text = newContactNoteDraft.trim();
    if (!text) return;
    setContactNotesBusy(true);
    setContactNotesError("");
    try {
      const when = format(new Date(), "dd/MM/yyyy HH:mm", { locale: dateLocale });
      const who = user?.displayName?.trim() || user?.name || "—";
      const block = `---\n${when} · ${who}\n${text}`;
      const existing = (conversation.contact.notes ?? "").trim();
      const nextNotes = existing ? `${existing}\n\n${block}` : block;
      await api.put(`/contacts/${conversation.contact.id}`, { notes: nextNotes });
      setConversation((c) => (c ? { ...c, contact: { ...c.contact, notes: nextNotes } } : c));
      setNewContactNoteDraft("");
    } catch {
      setContactNotesError(t("conversationDetail.contactNotesSaveFailed"));
    } finally {
      setContactNotesBusy(false);
    }
  };

  const renderCrmPanel = (opts?: { showMobileClose?: boolean }) => (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-2 border-b border-ink-100 pb-3 dark:border-white/10">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
          {t("conversationDetail.crmPanelTitle")}
        </p>
        {opts?.showMobileClose ? (
          <button
            type="button"
            className="shrink-0 rounded-xl border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 shadow-sm hover:bg-ink-50 dark:border-white/10 dark:bg-white/5 dark:text-ink-200 dark:shadow-none dark:hover:bg-white/10"
            onClick={() => setCrmMobileOpen(false)}
          >
            {t("common.close")}
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-ink-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[#111C2B]/55 dark:shadow-none">
        <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{conversation.contact.name}</p>
        {(() => {
          const phone = conversation.contact.phone ?? "";
          const phoneDigits = phone.replace(/\D/g, "");
          const hasPhone = phoneDigits.length > 0;
          return (
            <div className="mt-1 flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300">
              <span>{phone}</span>
              {hasPhone ? (
                <a
                  href={`https://wa.me/${phoneDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-ink-200 bg-white/80 text-ink-700 shadow-sm hover:bg-ink-50 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:shadow-none dark:hover:bg-white/10"
                  aria-label="WhatsApp"
                  title="WhatsApp"
                >
                  <WhatsAppBrandIcon className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          );
        })()}
        {conversation.contact.email ? (
          <p className="mt-1 text-xs text-ink-600 dark:text-ink-300">
            <span className="font-medium text-ink-700 dark:text-ink-200">{t("conversationDetail.email")}:</span>{" "}
            {conversation.contact.email}
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-500 dark:text-ink-500">
            <span className="font-medium">{t("conversationDetail.email")}:</span> {t("conversationDetail.noDealValue")}
          </p>
        )}
        {(() => {
          const hasEmail = Boolean(conversation.contact.email?.trim());
          const btnClass =
            "flex h-9 w-9 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-700 shadow-sm transition hover:bg-ink-50 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:shadow-none dark:hover:bg-white/10";
          const disabledClass = "pointer-events-none opacity-40";
          return (
            <div className="mt-3 flex items-center gap-2">
              <a
                href={hasEmail ? `mailto:${conversation.contact.email}` : undefined}
                className={clsx(btnClass, !hasEmail && disabledClass)}
                aria-label={t("conversationDetail.email")}
                title={t("conversationDetail.email")}
              >
                <Mail className="h-4 w-4" />
              </a>
              <Link
                to={`/contacts/${conversation.contact.id}`}
                onClick={() => opts?.showMobileClose && setCrmMobileOpen(false)}
                className={btnClass}
                aria-label={t("conversationDetail.openContactCrm")}
                title={t("conversationDetail.openContactCrm")}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Link>
            </div>
          );
        })()}
        <div className="mt-3 border-t border-ink-200/80 pt-3 dark:border-ink-700">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {t("conversationDetail.prioritySection")}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-ink-500 dark:text-ink-500">
            {t("conversationDetail.priorityHint")}
          </p>
          <div className="mt-2">
            <ConversationPriorityPicker
              value={conversation.priority}
              disabled={priorityBusy}
              onChange={(p) => void saveConversationPriority(p)}
            />
          </div>
          {priorityError ? (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{priorityError}</p>
          ) : null}
        </div>
        {(() => {
          const assigned = conversation.contact.tags ?? [];
          const assignedIds = new Set(assigned.map((x) => x.tag.id));
          const availableToAdd = orgTags.filter((x) => !assignedIds.has(x.id));
          return (
            <div className="mt-3 border-t border-ink-200/80 pt-3 dark:border-ink-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  {t("conversationDetail.tagsSection")}
                </p>
                {tenantAdmin ? (
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={tagBusy}
                      onClick={() => {
                        void refreshOrgTags();
                        openTagModalCreate(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[10px] font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                    >
                      <Plus className="h-3 w-3" />
                      {t("conversationDetail.tagNew")}
                    </button>
                    <button
                      type="button"
                      disabled={tagBusy}
                      onClick={() => {
                        void refreshOrgTags();
                        openTagModalManage();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[10px] font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                    >
                      <Pencil className="h-3 w-3" />
                      {t("conversationDetail.tagManage")}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {assigned.length === 0 ? (
                  <p className="text-[11px] text-ink-500 dark:text-ink-400">{t("conversationDetail.tagsEmpty")}</p>
                ) : (
                  assigned.map((ct) => (
                    <span
                      key={ct.tag.id}
                      className="group inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ backgroundColor: ct.tag.color }}
                    >
                      <Tag className="h-2.5 w-2.5 shrink-0 opacity-90" />
                      {ct.tag.name}
                      <button
                        type="button"
                        disabled={tagBusy}
                        title={t("conversationDetail.tagRemove")}
                        className="rounded-full p-0.5 opacity-80 hover:bg-white/20 hover:opacity-100 disabled:opacity-40"
                        onClick={() => void removeContactTag(ct.tag.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-stretch gap-2">
                <select
                  value={tagAddSelectId}
                  onChange={(e) => setTagAddSelectId(e.target.value)}
                  disabled={tagBusy || availableToAdd.length === 0}
                  className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-800 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
                  aria-label={t("conversationDetail.tagSelectPlaceholder")}
                >
                  <option value="">{t("conversationDetail.tagSelectPlaceholder")}</option>
                  {availableToAdd.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={tagBusy || !tagAddSelectId}
                  onClick={() => void addContactTag(tagAddSelectId)}
                  className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
                >
                  {t("conversationDetail.tagAdd")}
                </button>
              </div>
              {orgTags.length > 0 && availableToAdd.length === 0 && assigned.length > 0 ? (
                <p className="mt-1 text-[10px] text-ink-500 dark:text-ink-400">
                  {t("conversationDetail.tagNoneAvailable")}
                </p>
              ) : null}
            </div>
          );
        })()}
        <p className="mt-2 text-[11px] text-ink-600 dark:text-ink-400">
          <span className="font-medium text-ink-700 dark:text-ink-300">{t("conversationDetail.leadSource")}:</span>{" "}
          {conversation.contact.createdBy?.name ?? t("audit.sourceInbound")}
        </p>
        <p className="mt-1 text-[11px] text-ink-600 dark:text-ink-400">
          <span className="font-medium text-ink-700 dark:text-ink-300">{t("audit.contactOwner")}:</span>{" "}
          {conversation.contact.assignedTo?.name ?? t("conversationDetail.handoffUnassigned")}
        </p>
        <div className="mt-3 border-t border-ink-200/80 pt-3 dark:border-white/10">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            {t("conversationDetail.contactNotes")}
          </p>
          <p className="mt-1 text-[10px] text-ink-500 dark:text-ink-400">{t("conversationDetail.contactNotesAddHint")}</p>
          <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-ink-200/80 bg-ink-50/80 px-3 py-2 dark:border-white/10 dark:bg-white/5">
            {conversation.contact.notes?.trim() ? (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-700 dark:text-ink-200">
                {conversation.contact.notes}
              </p>
            ) : (
              <p className="text-xs text-ink-500 dark:text-ink-400">{t("conversationDetail.contactNotesEmpty")}</p>
            )}
          </div>
          <textarea
            value={newContactNoteDraft}
            onChange={(e) => setNewContactNoteDraft(e.target.value)}
            rows={3}
            placeholder={t("conversationDetail.contactNotesComposePlaceholder")}
            className="mt-2 w-full resize-y rounded-xl border border-ink-200 bg-white/90 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 shadow-sm focus:border-brand-400/40 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-ink-50 dark:placeholder:text-ink-500 dark:shadow-none"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void addContactNote()}
              disabled={contactNotesBusy || !newContactNoteDraft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
            >
              <Plus className="h-3.5 w-3.5" />
              {contactNotesBusy ? t("common.saving") : t("conversationDetail.contactNotesAdd")}
            </button>
          </div>
          {contactNotesError ? (
            <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/35 dark:text-rose-100">
              {contactNotesError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-ink-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[#111C2B]/55 dark:shadow-none">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
          {t("conversationDetail.dealValue")} / {t("conversationDetail.pipelineStage")}
        </p>
        {funnelEnabled ? (
          <>
            {conversation.contact.pipelineStage ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center rounded-lg px-2 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: conversation.contact.pipelineStage.color }}
                >
                  {conversation.contact.pipelineStage.name}
                </span>
                {conversation.contact.pipelineStage.pipeline?.name ? (
                  <span className="text-xs text-ink-500 dark:text-ink-400">
                    {t("conversationDetail.pipelineLabel")}: {conversation.contact.pipelineStage.pipeline.name}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-500 dark:text-ink-500">{t("conversationDetail.noPipelineStage")}</p>
            )}
            <p className="mt-2 text-sm font-medium text-ink-800 dark:text-ink-200">
              {conversation.status === "RESOLVED" && conversation.closureValue != null && conversation.closureValue > 0
                ? fmtMoney(conversation.closureValue)
                : t("conversationDetail.noDealValue")}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500 dark:text-ink-400">
              {t("conversationDetail.dragDropKanbanHint")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/contacts/${conversation.contact.id}`}
                onClick={() => opts?.showMobileClose && setCrmMobileOpen(false)}
                className="btn-secondary rounded-lg px-3 py-1.5 text-xs"
              >
                {t("conversationDetail.openContactCrm")}
              </Link>
              <Link
                to="/crm"
                onClick={() => opts?.showMobileClose && setCrmMobileOpen(false)}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-800 shadow-sm hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
              >
                <Kanban className="h-3.5 w-3.5" />
                {t("conversationDetail.openKanban")}
              </Link>
            </div>
            <p className="mt-2 text-[11px] text-ink-500 dark:text-ink-500">{t("conversationDetail.actionMoveFunnelHint")}</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-ink-600 dark:text-ink-400">
              {t("conversationDetail.funnelDisabledHint")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`/contacts/${conversation.contact.id}`}
                onClick={() => opts?.showMobileClose && setCrmMobileOpen(false)}
                className="btn-secondary rounded-lg px-3 py-1.5 text-xs"
              >
                {t("conversationDetail.openContactCrm")}
              </Link>
            </div>
          </>
        )}
      </div>

      {tenantAdmin ? (
        <div className="rounded-2xl border border-ink-200/80 bg-white/70 p-4 backdrop-blur-sm dark:border-ink-800 dark:bg-ink-950/20">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{t("conversationDetail.team")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="conv-team-aside" className="sr-only">
              {t("conversationDetail.assignTeam")}
            </label>
            <select
              id="conv-team-aside"
              value={teamPickerId}
              onChange={(e) => setTeamPickerId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-800 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100"
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
              className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
            >
              {t("conversationDetail.saveTeam")}
            </button>
          </div>
        </div>
      ) : null}

      {conversation.closureRecords && conversation.closureRecords.length > 0 ? (
        <details className="rounded-xl border border-ink-200/70 bg-ink-50/40 dark:border-white/10 dark:bg-white/[0.03]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 [&::-webkit-details-marker]:hidden">
            <span>{t("conversationDetail.attendanceHistoryTitle")}</span>
            <span className="rounded-full bg-ink-200/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ink-600 dark:bg-white/10 dark:text-ink-300">
              {conversation.closureRecords.length}
            </span>
          </summary>
          <div className="divide-y divide-ink-200/60 border-t border-ink-200/60 dark:divide-white/10 dark:border-white/10">
            {conversation.closureRecords.map((rec) => {
              const historyRollupRows = conversation.closureRecords!.map((r) => ({
                conversationId: conversation.id,
                sessionIndex: r.sessionIndex,
                closureValue: r.closureValue,
                leadType: r.leadType,
              }));
              const rowRollup = {
                conversationId: conversation.id,
                sessionIndex: rec.sessionIndex,
                closureValue: rec.closureValue,
                leadType: rec.leadType,
              };
              const showValue = shouldDisplayClosureValueBadge(rowRollup, historyRollupRows);
              const pipelineSuperseded =
                rec.leadType?.valueRollup === "PIPELINE" &&
                (rec.closureValue ?? 0) > 0 &&
                !isPipelineClosureActiveForRollup(rowRollup, historyRollupRows);
              return (
              <details
                key={rec.id}
                open={rec.sessionIndex === 1}
                className="group/att px-3 py-1.5"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 py-1 text-[10px] text-ink-700 dark:text-ink-300 [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold text-ink-800 dark:text-ink-200">
                    #{rec.sessionIndex}
                  </span>
                  <span className="text-ink-500 dark:text-ink-400">
                    {format(new Date(rec.resolvedAt), "P · HH:mm", { locale: dateLocale })}
                  </span>
                  {rec.sessionIndex === 1 ? (
                    <span className="rounded bg-brand-100/90 px-1 py-px text-[9px] font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                      {t("conversationDetail.attendanceFirst")}
                    </span>
                  ) : null}
                  {rec.isNewAttendance ? (
                    <span className="rounded bg-violet-100/90 px-1 py-px text-[9px] font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                      {t("conversationDetail.attendanceNew")}
                    </span>
                  ) : null}
                  {rec.leadType ? (
                    <span
                      className="max-w-[8rem] truncate rounded px-1 py-px text-[9px] font-medium text-white"
                      style={{ backgroundColor: rec.leadType.color }}
                      title={rec.leadType.name}
                    >
                      {rec.leadType.name}
                    </span>
                  ) : null}
                  {rec.reopenedAt ? (
                    <span className="text-[9px] font-medium text-amber-700 dark:text-amber-300">
                      {t("audit.statusReopened")}
                    </span>
                  ) : null}
                </summary>
                <dl className="mb-2 space-y-1 border-l border-ink-200/80 pl-2 text-[10px] leading-snug text-ink-600 dark:border-white/10 dark:text-ink-400">
                  {rec.resolvedBy ? (
                    <dd>
                      {t("conversationDetail.attendanceResolvedBy").replace("{name}", rec.resolvedBy.name)}
                    </dd>
                  ) : null}
                  {rec.leadType ? (
                    <div>
                      <dt className="font-medium text-ink-700 dark:text-ink-300">{t("conversationDetail.leadLabel")}</dt>
                      <dd style={{ color: rec.leadType.color }}>{rec.leadType.name}</dd>
                    </div>
                  ) : null}
                  {rec.closureReason ? (
                    <div>
                      <dt className="font-medium text-ink-700 dark:text-ink-300">
                        {t("conversationDetail.closureReason")}
                      </dt>
                      <dd className="whitespace-pre-wrap text-ink-600 dark:text-ink-400">{rec.closureReason}</dd>
                    </div>
                  ) : null}
                  {showValue ? (
                    <div>
                      <dt className="font-medium text-ink-700 dark:text-ink-300">
                        {t("conversationDetail.closureValueLabel")}
                      </dt>
                      <dd>{fmtMoney(rec.closureValue!)}</dd>
                    </div>
                  ) : pipelineSuperseded ? (
                    <div>
                      <dt className="font-medium text-ink-500 dark:text-ink-500">
                        {t("conversationDetail.closureValueLabel")}
                      </dt>
                      <dd className="text-ink-400 line-through dark:text-ink-500">
                        {fmtMoney(rec.closureValue!)}
                      </dd>
                      <dd className="mt-0.5 text-[9px] text-ink-400 dark:text-ink-500">
                        {t("attendance.pipelineSupersededHint")}
                      </dd>
                    </div>
                  ) : null}
                  {rec.csatScore != null ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <dt className="font-medium text-ink-700 dark:text-ink-300">
                        {t("conversationDetail.csatRecordedPrefix")}
                      </dt>
                      <dd className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Star
                            key={i}
                            className={clsx(
                              "h-3 w-3",
                              i <= rec.csatScore! ? "fill-amber-400 text-amber-400" : "text-ink-300 dark:text-ink-600",
                            )}
                          />
                        ))}
                        <span className="font-semibold tabular-nums">{rec.csatScore}/5</span>
                      </dd>
                    </div>
                  ) : null}
                  {rec.csatComment ? (
                    <div>
                      <dt className="font-medium text-ink-700 dark:text-ink-300">CSAT</dt>
                      <dd className="whitespace-pre-wrap">{rec.csatComment}</dd>
                    </div>
                  ) : null}
                  {rec.reopenedAt ? (
                    <div>
                      <dt className="font-medium text-amber-800 dark:text-amber-300">{t("audit.statusReopened")}</dt>
                      <dd>
                        {t("conversationDetail.attendanceReopened")
                          .replace("{date}", format(new Date(rec.reopenedAt), "PPp", { locale: dateLocale }))
                          .replace("{name}", rec.reopenedBy?.name ?? "—")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </details>
              );
            })}
          </div>
        </details>
      ) : null}

      {conversation.status === "RESOLVED" &&
      !(conversation.closureRecords && conversation.closureRecords.length > 0) &&
      (conversation.closureReason ||
        conversation.leadType ||
        conversation.csatScore != null ||
        conversation.csatSurveyPending ||
        (conversation.closureValue != null && conversation.closureValue > 0)) ? (
        <div className="rounded-2xl border border-brand-200/60 bg-brand-50/40 p-4 dark:border-brand-900/40 dark:bg-brand-950/20">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-800 dark:text-brand-300">
            {t("conversationDetail.resolvedSummary")}
          </p>
          {conversation.leadType ? (
            <p className="mt-1 text-sm text-ink-800 dark:text-ink-200">
              <span className="font-medium">{t("conversationDetail.leadLabel")}:</span>{" "}
              <span style={{ color: conversation.leadType.color }} className="font-semibold">
                {conversation.leadType.name}
              </span>
            </p>
          ) : null}
          {conversation.closureReason ? (
            <p className="mt-1 whitespace-pre-wrap text-xs text-ink-700 dark:text-ink-300">{conversation.closureReason}</p>
          ) : null}
          {conversation.closureValue != null && conversation.closureValue > 0 ? (
            <p className="mt-2 text-xs text-ink-800 dark:text-ink-200">
              <span className="font-medium">{t("conversationDetail.closureValueLabel")}:</span> {fmtMoney(conversation.closureValue)}
            </p>
          ) : null}
          {conversation.csatScore != null ? (
            <div className="mt-3 border-t border-brand-200/50 pt-3 dark:border-brand-900/35">
              <p className="text-[11px] font-semibold text-brand-800 dark:text-brand-300">
                {t("conversationDetail.csatRecordedPrefix")}{" "}
                {conversation.csatRecordedAt
                  ? format(new Date(conversation.csatRecordedAt), "PPp", { locale: dateLocale })
                  : ""}
              </p>
              <div className="mt-1 flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    className={clsx(
                      "h-4 w-4",
                      i <= conversation.csatScore!
                        ? "fill-amber-400 text-amber-400"
                        : "text-ink-300 dark:text-ink-600",
                    )}
                  />
                ))}
                <span className="ml-2 text-sm font-semibold tabular-nums text-ink-800 dark:text-ink-200">
                  {conversation.csatScore}/5
                </span>
              </div>
              {conversation.csatComment ? (
                <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-700 dark:text-ink-300">{conversation.csatComment}</p>
              ) : null}
            </div>
          ) : conversation.csatSurveyPending ? (
            <p className="mt-3 border-t border-brand-200/50 pt-3 text-xs text-ink-600 dark:border-brand-900/35 dark:text-ink-400">
              {t("conversationDetail.csatPendingCustomer")}
            </p>
          ) : null}
        </div>
      ) : null}

      {conversation.status === "RESOLVED" &&
      conversation.csatSurveyPending &&
      conversation.closureRecords &&
      conversation.closureRecords.length > 0 ? (
        <p className="rounded-lg border border-brand-200/50 bg-brand-50/30 px-3 py-2 text-[10px] leading-snug text-brand-900/90 dark:border-brand-900/35 dark:bg-brand-950/20 dark:text-brand-100/90">
          {t("conversationDetail.csatPendingCustomer")}
        </p>
      ) : null}

      <div className="rounded-2xl border border-ink-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[#111C2B]/55 dark:shadow-none">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">
            {t("conversationDetail.recentHistoryTitle")}
          </p>
          <Link
            to={`/contacts/${conversation.contact.id}`}
            onClick={() => opts?.showMobileClose && setCrmMobileOpen(false)}
            className="shrink-0 text-[11px] font-semibold text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t("conversationDetail.recentHistorySeeAll")}
          </Link>
        </div>
        <p className="mt-1 text-[10px] text-ink-500 dark:text-ink-500">{t("conversationDetail.recentHistoryHint")}</p>
        {contactTimelinePreview.length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">{t("conversationDetail.handoffNoEntries")}</p>
        ) : (
          <div className="relative mt-3 max-h-72 overflow-y-auto pr-1">
            {contactTimelinePreview.map((ev, index) => {
              const title = timelineEventTitle(ev.eventType, t);
              const channel = timelineChannelLabel(ev.channel, t);
              const summary = timelineEventSummary(ev.eventType, ev.payload as TimelinePayload, t);
              const at = new Date(ev.occurredAt);
              const timeStr = format(at, "HH:mm", { locale: dateLocale });
              const iconWrap =
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink-200/90 bg-white shadow-sm dark:border-ink-600 dark:bg-ink-900";
              let icon: ReactNode = <Circle className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.5} />;
              if (ev.eventType === "conversation.handoff") {
                icon = <ArrowRightLeft className="h-4 w-4 text-violet-500" />;
              } else if (ev.eventType.startsWith("deal.")) {
                icon = <Briefcase className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
              } else if (ev.eventType === "message.inbound" || ev.eventType === "message.outbound") {
                const wa = (ev.channel ?? "").toLowerCase() === "whatsapp";
                icon = wa ? (
                  <WhatsAppBrandIcon className="h-4 w-4" />
                ) : (
                  <MessageSquare className="h-4 w-4 text-ink-500 dark:text-ink-400" />
                );
              } else if (ev.eventType === "conversation.started") {
                const waStart = (ev.channel ?? "").toLowerCase() === "whatsapp";
                icon = waStart ? (
                  <WhatsAppBrandIcon className="h-4 w-4" />
                ) : (
                  <MessageSquare className="h-4 w-4 text-ink-500 dark:text-ink-400" />
                );
              }
              const showLine = index < contactTimelinePreview.length - 1;
              return (
                <div key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {showLine ? (
                    <div
                      className="absolute top-8 bottom-0 left-[15px] w-px bg-ink-200 dark:bg-ink-600"
                      aria-hidden
                    />
                  ) : null}
                  <div className={iconWrap}>{icon}</div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <time dateTime={ev.occurredAt} className="text-xs font-semibold tabular-nums text-ink-500 dark:text-ink-400">
                        {timeStr}
                      </time>
                      <span className="text-xs font-semibold text-ink-900 dark:text-ink-100">{title}</span>
                      {channel ? (
                        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                          {channel}
                        </span>
                      ) : null}
                    </div>
                    {summary ? (
                      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-ink-600 dark:text-ink-400">
                        {summary}
                      </p>
                    ) : null}
                    {ev.actorUser ? (
                      <p className="mt-1 text-[10px] text-ink-500 dark:text-ink-500">
                        <span className="font-medium text-ink-600 dark:text-ink-400">
                          {t("contactDetail.timelineActor")}
                        </span>
                        : {ev.actorUser.name}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-ink-50 dark:bg-[#0E1624] lg:flex-row">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(103,52,255,0.08)_0%,_transparent_60%)] dark:bg-[radial-gradient(ellipse_90%_45%_at_50%_0%,rgba(99,102,241,0.16),transparent_60%)]" />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <motion.div
          className="shrink-0 border-b border-ink-200/70 bg-white/85 px-3 py-3 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-[#0F1B2B]/55 lg:px-5"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <div className="flex items-start gap-3">
            <Link
              to="/conversations"
              className="mt-1 rounded-xl p-2 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-200"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <ConversationListAvatar
              contactId={conversation.contact.id}
              contactName={conversation.contact.name}
              profilePictureUrl={conversation.contact.profilePictureUrl}
              hasAvatar={conversation.contact.hasAvatar}
              thumbnail={conversation.contact.thumbnail}
              channelType={isWhatsappInbox ? "WHATSAPP" : undefined}
              priority={conversation.priority}
              size="detail"
              presenceOnline={presenceRecent}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold tracking-tight text-ink-900 dark:text-ink-50">
                        {conversation.contact.name}
                      </h2>
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          conversation.status === "OPEN" &&
                            "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200",
                          conversation.status === "PENDING" &&
                            "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200",
                          conversation.status === "RESOLVED" &&
                            "bg-ink-200 text-ink-700 dark:bg-white/10 dark:text-ink-200",
                        )}
                      >
                        {statusLabel(conversation.status)}
                      </span>
                      <ConversationPriorityBadge priority={conversation.priority} />
                      {conversation.awaitingHumanHandoff ? (
                        <span
                          className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-900 dark:bg-red-950/60 dark:text-red-100"
                          title={t("conversationDetail.awaitingHumanBanner")}
                        >
                          {t("conversationDetail.awaitingHumanBadge")}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-ink-300">
                      <span className="inline-flex items-center gap-2">
                        <span className="truncate">{conversation.contact.phone}</span>
                        {isWhatsappInbox ? (
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5"
                            title="WhatsApp"
                            aria-hidden
                          >
                            <WhatsAppBrandIcon className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={clsx(
                            "h-1.5 w-1.5 rounded-full",
                            presenceRecent ? "bg-emerald-500" : "bg-ink-400 dark:bg-ink-600",
                          )}
                          aria-hidden
                        />
                        <span>{presenceRecent ? t("conversationDetail.presenceActive") : t("conversationDetail.presenceAway")}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-ink-400 dark:text-ink-500">•</span>
                        <span>
                          {t("conversationDetail.team")}: {conversation.team?.name ?? t("conversationDetail.noTeam")}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {copilotEnabled ? (
                      <Link
                        to={`/ai-insights?conversation=${encodeURIComponent(conversation.id)}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 shadow-sm hover:bg-ink-50 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:shadow-none dark:hover:bg-white/10"
                      >
                        <Brain className="h-4 w-4" />
                        {t("conversationDetail.linkAiInsights")}
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-xl border border-ink-200 bg-white p-2 text-ink-700 shadow-sm hover:bg-ink-50 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:shadow-none dark:hover:bg-white/10 xl:hidden"
                      onClick={() => setCrmMobileOpen(true)}
                      aria-label={t("conversationDetail.crmDrawerToggle")}
                    >
                      <LayoutGrid className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {conversation.contact.tags?.map((ct) => (
                    <span
                      key={ct.tag.id}
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                      style={{ backgroundColor: ct.tag.color }}
                    >
                      {ct.tag.name}
                    </span>
                  ))}
                  {conversation.status === "RESOLVED" && conversation.leadType ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ backgroundColor: conversation.leadType.color }}
                    >
                      {conversation.leadType.name}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-ink-600 dark:text-ink-400">
                    <span className="font-medium text-ink-700 dark:text-ink-300">{t("conversationDetail.conversationAssignee")}:</span>{" "}
                    {conversation.assignedTo?.name ?? t("conversationDetail.noConversationAssignee")}
                  </p>
                  {clientWaitLabel ? (
                    <p className="flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-200/90">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {t("conversationDetail.waitingSince")} {clientWaitLabel}
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 dark:border-white/10 lg:mt-4 lg:border-t-0 lg:pt-0">
            {agentBotTriageActive && hasNoHumanAssignee && !conversation.awaitingHumanHandoff ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-900 dark:border-violet-800/40 dark:bg-violet-950/35 dark:text-violet-200"
                title={t("conversationDetail.botTriageBanner")}
              >
                <Bot className="h-3.5 w-3.5" />
                {t("conversationDetail.botInAttendance")}
              </span>
            ) : null}
            {isOutsideWindow ? (
              <div className="flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("conversationDetail.outsideWindow")}
              </div>
            ) : null}
            {canStartAttendance ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => {
                  if (user?.id) void applyStatus("OPEN", { assignedToId: user.id });
                }}
                title={t("conversationDetail.startAttendanceHint")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-950 hover:bg-emerald-100/80 disabled:opacity-50 dark:border-emerald-800/45 dark:bg-emerald-950/35 dark:text-emerald-100 dark:hover:bg-emerald-900/40"
              >
                <Headset className="h-3.5 w-3.5" />
                {t("conversationDetail.startAttendance")}
              </button>
            ) : null}
            {canTransfer ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => {
                  setFlowError("");
                  setTransferTeamId(conversation.team?.id ?? teamOptions[0]?.id ?? "");
                  setTransferAssigneeId(conversation.assignedTo?.id ?? "");
                  setTransferOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                {t("conversationDetail.transferOpen")}
              </button>
            ) : null}
            {funnelEnabled ? (
              <Link
                to="/crm"
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-800 shadow-sm hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
              >
                <Kanban className="h-3.5 w-3.5" />
                {t("conversationDetail.actionMoveFunnel")}
              </Link>
            ) : null}
            {showTransferToBot ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void applyStatus("PENDING", { assignedToId: null })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-950 hover:bg-violet-100/80 disabled:opacity-50 dark:border-violet-800/50 dark:bg-violet-950/35 dark:text-violet-100 dark:hover:bg-violet-900/40"
              >
                <Bot className="h-3.5 w-3.5" />
                {t("conversationDetail.transferToBot")}
              </button>
            ) : null}
            {conversation.status === "OPEN" && !agentBotTriageActive ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void applyStatus("PENDING")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100/80 disabled:opacity-50 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
              >
                <PauseCircle className="h-3.5 w-3.5" />
                {t("conversationDetail.setPending")}
              </button>
            ) : null}
            {canResolve ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => openResolveModal(null)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                {t("conversationDetail.finalize")}
              </button>
            ) : null}
            {conversation.status === "RESOLVED" ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void applyStatus("OPEN")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("conversationDetail.reopen")}
              </button>
            ) : null}
            <Link
              to={`/contacts/${conversation.contact.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
            >
              <User className="h-3.5 w-3.5" />
              {t("conversationDetail.viewContact")}
            </Link>
          </div>
        </motion.div>

        {flowError && (
          <div className="border-b border-red-200/80 bg-red-50/95 px-5 py-2.5 text-center text-sm text-red-700 backdrop-blur-sm dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300">
            {flowError}
          </div>
        )}

        <div
          ref={messagesViewportRef}
          onScroll={onMessagesViewportScroll}
          className="relative min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-5"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(148,163,184,0.12)_0%,_transparent_55%)] dark:bg-[radial-gradient(ellipse_110%_55%_at_50%_0%,rgba(255,255,255,0.04),transparent_60%)]" />
          <div className="relative w-full min-w-0 space-y-0">
            {conversation.awaitingHumanHandoff ? (
              <div
                className="mb-4 flex items-start gap-2 rounded-xl border border-red-200/90 bg-red-50/95 px-3 py-2.5 text-xs text-red-950 shadow-sm dark:border-red-800/50 dark:bg-red-950/45 dark:text-red-100"
                role="status"
              >
                <Headset className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300" aria-hidden />
                <p className="leading-snug">{t("conversationDetail.awaitingHumanBanner")}</p>
              </div>
            ) : null}
            {inBotQueueOnly ? (
              <div
                className="mb-4 flex items-start gap-2 rounded-xl border border-violet-200/80 bg-violet-50/90 px-3 py-2.5 text-xs text-violet-950 shadow-sm dark:border-violet-800/40 dark:bg-violet-950/40 dark:text-violet-100"
                role="status"
              >
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden />
                <p className="leading-snug">{t("conversationDetail.botTriageBanner")}</p>
              </div>
            ) : null}
            {(conversation.messages ?? []).map((msg, i) => {
              const list = conversation.messages ?? [];
              const groupedPrev = messageGroupedWithPrevious(list, i);
              const groupedNext = messageGroupedWithNext(list, i);
              const isNew = !seenMessageIds.current.has(msg.id);
              if (isNew) seenMessageIds.current.add(msg.id);
              const showAvatar = !groupedPrev;
              const inbound = msg.direction === "INBOUND";
              /* Agrupamento: espaço visível entre balões do mesmo remetente; bloco maior ao mudar de remetente. */
              const rowSpacing = groupedNext ? "mb-2.5" : "mb-6";
              const bubbleRadius = clsx(
                "rounded-2xl",
                inbound ? groupedPrev && "rounded-tl-md" : groupedPrev && "rounded-tr-md",
                inbound ? groupedNext && "rounded-bl-md" : groupedNext && "rounded-br-md",
              );

              const avatarCol = (
                <div className="flex w-8 shrink-0 flex-col justify-end pb-1">
                  {showAvatar ? (
                    inbound ? (
                      <ContactAvatar
                        contactId={conversation.contact.id}
                        name={conversation.contact.name}
                        profilePictureUrl={conversation.contact.profilePictureUrl}
                        hasAvatar={conversation.contact.hasAvatar}
                        thumbnail={conversation.contact.thumbnail}
                        variant="message"
                      />
                    ) : (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold text-white shadow-sm"
                        title={user?.name ?? ""}
                      >
                        {(user?.name ?? "A").charAt(0).toUpperCase()}
                      </div>
                    )
                  ) : (
                    <span className="block h-8 w-8" aria-hidden />
                  )}
                </div>
              );

              const bubble = (
                <div
                  className={clsx(
                    "crm-bubble relative min-w-0 max-w-[min(calc(100%-2.5rem),28rem)] border px-3.5 py-2.5",
                    bubbleRadius,
                    isNew && "crm-bubble-unread",
                    msg.isPrivate ? "crm-bubble-private" : inbound ? "crm-bubble-in" : "crm-bubble-out",
                  )}
                >
                  {msg.direction === "OUTBOUND" && msg.actorUser?.showAgentNameInChat ? (
                    <p
                      className={clsx(
                        "mb-2.5 border-b pb-2 text-[11px] font-semibold leading-tight",
                        msg.isPrivate
                          ? "border-amber-400/40 text-amber-900/90 dark:border-amber-500/30 dark:text-amber-100/95"
                          : "border-ink-200/60 text-ink-700 dark:border-white/10 dark:text-ink-200",
                      )}
                    >
                      {msg.actorUser.displayName?.trim() || msg.actorUser.name}
                    </p>
                  ) : null}
                  {msg.isPrivate ? (
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                      <Lock className="h-3 w-3" />
                      {t("conversationDetail.internalNoteLabel")}
                    </p>
                  ) : null}
                  {msg.type === "IMAGE" && msg.mediaUrl ? (
                    <ChatImageThumbnail
                      src={msg.mediaUrl}
                      alt=""
                      outbound={msg.direction === "OUTBOUND" && !msg.isPrivate}
                      onOpen={() => setLightboxSrc(msg.mediaUrl!)}
                    />
                  ) : null}
                  {msg.type === "DOCUMENT" && msg.mediaUrl ? (
                    <DocumentAttachmentCard
                      href={msg.mediaUrl}
                      body={msg.body}
                      downloadLabel={t("conversationDetail.downloadAttachment")}
                      inbound={inbound}
                    />
                  ) : null}
                  {msg.body?.trim() && msg.type !== "DOCUMENT" ? (
                    <p
                      className={clsx(
                        "whitespace-pre-wrap break-words text-sm leading-snug [overflow-wrap:anywhere]",
                        msg.type === "IMAGE" && msg.mediaUrl && "mt-2",
                      )}
                    >
                      {msg.body}
                    </p>
                  ) : null}
                  {msg.type === "DOCUMENT" && msg.mediaUrl && msg.body?.trim() && isLikelyDocumentCaption(msg.body) ? (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-snug [overflow-wrap:anywhere]">
                      {msg.body}
                    </p>
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
                      key={`${msg.id}-${msg.mediaUrl}`}
                      controls
                      src={msg.mediaUrl}
                      className={clsx(
                        "mt-2 w-full min-w-[200px] max-w-[280px]",
                        msg.direction === "OUTBOUND" && !msg.isPrivate && "opacity-95",
                      )}
                      preload="auto"
                      playsInline
                    />
                  )}
                  <div
                    className={clsx(
                      "crm-bubble-meta mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums",
                    )}
                  >
                    <span>{format(new Date(msg.sentAt), "HH:mm")}</span>
                    {inbound && isNew ? (
                      <span className="ml-1 inline-flex h-2 w-2 items-center justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-500/80 dark:bg-brand-300/80" />
                      </span>
                    ) : null}
                    {msg.direction === "OUTBOUND" && !msg.isPrivate && (
                      <span className="inline-flex items-center" title={msg.status}>
                        {msg.status === "FAILED" ? (
                          <AlertTriangle className="h-3 w-3 text-red-500 dark:text-red-300" aria-hidden />
                        ) : msg.status === "READ" ? (
                          <CheckCheck className="h-3 w-3 text-sky-500 dark:text-sky-400" aria-hidden />
                        ) : msg.status === "DELIVERED" ? (
                          <CheckCheck className="h-3 w-3 text-ink-500/70 dark:text-ink-300/70" aria-hidden />
                        ) : (
                          <Check className="h-3 w-3 text-ink-500/80 dark:text-ink-300/80" aria-hidden />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );

              return (
                <motion.div
                  key={msg.id}
                  className={clsx("flex w-full gap-2", inbound ? "justify-start" : "justify-end", rowSpacing)}
                  initial={isNew ? { opacity: 0, y: 6 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.22,
                    delay: isNew ? Math.min(i * 0.02, 0.25) : 0,
                    ease: "easeOut",
                  }}
                >
                  {inbound ? (
                    <>
                      {avatarCol}
                      {bubble}
                    </>
                  ) : (
                    <>
                      {bubble}
                      {avatarCol}
                    </>
                  )}
                </motion.div>
              );
            })}
            {sending ? (
              <motion.div
                className="mb-2 mt-2 flex w-full justify-end gap-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="rounded-2xl border border-brand-500/30 bg-brand-500/15 px-4 py-3 dark:bg-brand-900/35">
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" />
                    <span className="ml-2 text-xs font-medium text-brand-800 dark:text-brand-200">
                      {t("conversationDetail.sendingMessage")}
                    </span>
                  </div>
                </div>
              </motion.div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <motion.div
          className="w-full min-w-0 shrink-0 border-t border-ink-200 bg-white/95 px-3 py-3 shadow-[0_-6px_20px_-12px_rgba(0,0,0,0.12)] backdrop-blur-sm dark:border-white/10 dark:bg-[#0F1B2B]/65 sm:px-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.08, ease: "easeOut" }}
        >
          <form onSubmit={handleSend} className="w-full min-w-0">
            <div className="w-full min-w-0 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#111C2B]/70">
              <div className="flex min-w-0 flex-wrap items-end gap-2 border-b border-ink-100 px-2 pt-2 dark:border-white/10">
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPrivateNote(false)}
                    className={clsx(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      !privateNote
                        ? "bg-ink-200 text-ink-900 dark:bg-white/10 dark:text-ink-50"
                        : "text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-ink-50",
                    )}
                  >
                    {t("conversationDetail.composerReplyTab")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrivateNote(true)}
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      privateNote
                        ? "bg-ink-200 text-ink-900 dark:bg-white/10 dark:text-ink-50"
                        : "text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-ink-50",
                    )}
                  >
                    <Lock className="h-3 w-3 opacity-70" />
                    {t("conversationDetail.composerPrivateTab")}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1 pb-0.5">
                  {copilotEnabled ? (
                    <motion.button
                      type="button"
                      disabled={
                        (isOutsideWindow && !privateNote) ||
                        recording ||
                        sending ||
                        !!voicePreview ||
                        suggestReplyBusy ||
                        privateNote
                      }
                      onClick={() => void handleAiSuggestReply()}
                      title={suggestReplyBusy ? t("conversationDetail.generateReplyBusy") : t("conversationDetail.generateReply")}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200/80 bg-violet-50 text-violet-800 hover:bg-violet-100/90 disabled:opacity-40 dark:border-violet-800/50 dark:bg-violet-950/60 dark:text-violet-200 dark:hover:bg-violet-900/50"
                      whileTap={{ scale: 0.94 }}
                    >
                      {suggestReplyBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                    </motion.button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setComposerExpanded((e) => !e)}
                    disabled={!!voicePreview || recording}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-600 hover:bg-ink-50 disabled:opacity-40 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-300 dark:hover:bg-ink-800"
                    title={composerExpanded ? t("conversationDetail.composerCollapse") : t("conversationDetail.composerExpand")}
                  >
                    {composerExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="min-w-0 px-3 pb-1 pt-2">
                {privateNote ? (
                  <p className="mb-2 text-xs text-ink-500 dark:text-ink-400">{t("conversationDetail.privateNoteHint")}</p>
                ) : copilotEnabled && pilotFlags?.openAiConfigured === false ? (
                  <p className="mb-2 text-[11px] text-ink-500 dark:text-ink-400">{t("conversationDetail.composerAiHint")}</p>
                ) : null}
                {!privateNote && !(user?.messageSignature?.trim()) ? (
                  <p className="mb-2 rounded-lg border border-sky-200/80 bg-sky-50/90 px-3 py-2 text-xs text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/40 dark:text-sky-100">
                    {t("conversationDetail.composerSignatureBanner")}{" "}
                    <Link to="/profile" className="font-semibold text-brand-600 underline hover:text-brand-500 dark:text-brand-400">
                      {t("conversationDetail.composerSignatureLink")}
                    </Link>
                  </p>
                ) : null}

                {voicePreview && voicePreviewUrl ? (
                  <div className="space-y-3 py-1">
                    <p className="text-xs font-medium text-ink-600 dark:text-ink-300">{t("conversationDetail.voicePreviewHint")}</p>
                    <audio key={voicePreviewUrl} controls src={voicePreviewUrl} className="h-10 w-full max-w-full" preload="metadata" />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={voiceBusy}
                        onClick={() => setVoicePreview(null)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-ink-800 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("conversationDetail.voicePreviewDiscard")}
                      </button>
                      <button
                        type="button"
                        disabled={voiceBusy || (isOutsideWindow && !privateNote)}
                        onClick={() => void sendVoiceFromPreview()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t("conversationDetail.voicePreviewSend")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {isOutsideWindow && isWaba && !privateNote ? (
                      <p className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                        {t("conversationDetail.outsideWindowTemplateHint")}
                      </p>
                    ) : null}
                    <textarea
                      ref={composerTextareaRef}
                      value={newMessage}
                      onChange={(e) => onComposerChange(e.target.value)}
                      onKeyDown={composerKeyDown}
                      rows={composerExpanded ? 7 : 3}
                      placeholder={
                        privateNote
                          ? t("conversationDetail.privateNotePlaceholder")
                          : isOutsideWindow
                            ? t("conversationDetail.placeholderTemplate")
                            : t("conversationDetail.placeholderNormal")
                      }
                      disabled={(isOutsideWindow && !privateNote) || recording}
                      className={clsx(
                        "w-full resize-y rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400/40 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:text-ink-400 dark:text-ink-50 dark:placeholder:text-ink-500 dark:focus:ring-brand-400/25 dark:disabled:text-ink-500",
                        composerExpanded ? "min-h-[11rem]" : "min-h-[4.75rem]",
                      )}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-400 dark:text-ink-500">
                      {readSendShortcutPref() === "mod_enter"
                        ? t("conversationDetail.composerShortcutModEnter")
                        : t("conversationDetail.composerShortcutEnter")}
                    </p>
                  </>
                )}
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

              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/60 px-2 py-2 dark:border-ink-800 dark:bg-ink-900/50">
                <div className="flex min-w-0 flex-wrap items-center gap-0.5">
                  {cannedResponses.length > 0 ? (
                    <div className="relative" ref={cannedWrapRef}>
                      <motion.button
                        type="button"
                        disabled={recording || !!voicePreview || (isOutsideWindow && !privateNote)}
                        onClick={() => {
                          setCannedMenuOpen((o) => !o);
                          setTemplateMenuOpen(false);
                          setEmojiOpen(false);
                        }}
                        title={t("conversationDetail.cannedResponses")}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200/80 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
                        whileTap={{ scale: 0.94 }}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </motion.button>
                      {cannedMenuOpen || (cannedSlashFilter && cannedSlashFilter.length > 0) ? (
                        <div className="absolute bottom-full left-0 z-30 mb-2 max-h-52 w-72 overflow-y-auto rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-600 dark:bg-ink-800">
                          {(cannedSlashFilter ?? cannedResponses).map((cr) => (
                            <button
                              key={cr.id}
                              type="button"
                              className="w-full px-3 py-2 text-left text-xs text-ink-800 hover:bg-ink-50 dark:text-ink-100 dark:hover:bg-ink-700"
                              onClick={() => applyCannedResponse(cr)}
                            >
                              <span className="font-mono font-semibold text-brand-700">/{cr.shortcut}</span>
                              <span className="mt-0.5 line-clamp-2 block text-[11px] font-normal text-ink-500 dark:text-ink-400">
                                {cr.content}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {messageTemplates.length > 0 ? (
                    <div className="relative" ref={templateWrapRef}>
                      <motion.button
                        type="button"
                        disabled={recording || !!voicePreview || (!isWaba && isOutsideWindow && !privateNote)}
                        onClick={() => {
                          setTemplateMenuOpen((o) => !o);
                          setCannedMenuOpen(false);
                          setEmojiOpen(false);
                        }}
                        title={t("conversationDetail.templates")}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200/80 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
                        whileTap={{ scale: 0.94 }}
                      >
                        <FileText className="h-4 w-4" />
                      </motion.button>
                      {templateMenuOpen ? (
                        <div className="absolute bottom-full left-0 z-30 mb-2 max-h-52 w-72 overflow-y-auto rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-600 dark:bg-ink-800">
                          {messageTemplates.map((tp) => (
                            <button
                              key={tp.id}
                              type="button"
                              className="w-full px-3 py-2 text-left text-xs text-ink-800 hover:bg-ink-50 dark:text-ink-100 dark:hover:bg-ink-700"
                              title={t("conversationDetail.pickTemplate")}
                              onClick={() => {
                                setTemplateMenuOpen(false);
                                const isEvolutionProvider =
                                  whatsappProvider === "evolution" || whatsappProvider === "evolution_go";
                                if (
                                  (isWaba && isOutsideWindow && !privateNote) ||
                                  (isEvolutionProvider && !privateNote)
                                ) {
                                  setTemplateModalTemplate({
                                    id: tp.id,
                                    name: tp.name,
                                    body: tp.body,
                                    bodyVariableCount: tp.bodyVariableCount ?? 0,
                                    metaCategory: tp.metaCategory,
                                  });
                                  return;
                                }
                                setNewMessage(tp.body);
                              }}
                            >
                              <span className="font-semibold">{tp.name}</span>
                              <span className="mt-0.5 line-clamp-2 block text-[11px] font-normal text-ink-500 dark:text-ink-400">
                                {tp.body}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="relative" ref={emojiWrapRef}>
                    <motion.button
                      type="button"
                      disabled={recording || !!voicePreview || (isOutsideWindow && !privateNote)}
                      onClick={() => {
                        setEmojiOpen((o) => !o);
                        setTemplateMenuOpen(false);
                      }}
                      title={t("conversationDetail.emoji")}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200/80 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
                      whileTap={{ scale: 0.94 }}
                    >
                      <Smile className="h-4 w-4" />
                    </motion.button>
                    <EmojiPickerPopover
                      open={emojiOpen}
                      onSelect={(em) => {
                        insertTextAtSelection(composerTextareaRef.current, newMessage, em, setNewMessage);
                        setEmojiOpen(false);
                      }}
                      categoryLabel={(id: EmojiCategoryId) => t(`common.emojiCategory.${id}`)}
                    />
                  </div>
                  {evolutionRichChat ? (
                    <>
                      <motion.button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={attachBusy || (!privateNote && isOutsideWindow) || recording || !!voicePreview}
                        title={t("conversationDetail.attachImage")}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200/80 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
                        whileTap={{ scale: 0.92 }}
                      >
                        <ImagePlus className="h-4 w-4" />
                      </motion.button>
                      <motion.button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={attachBusy || (!privateNote && isOutsideWindow) || recording || !!voicePreview}
                        title={t("conversationDetail.attachFile")}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200/80 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-800"
                        whileTap={{ scale: 0.92 }}
                      >
                        <Paperclip className="h-4 w-4" />
                      </motion.button>
                    </>
                  ) : null}
                  <motion.button
                    type="button"
                    onClick={() => void handleVoiceToggle()}
                    disabled={(isOutsideWindow && !privateNote) || voiceBusy || sending || attachBusy}
                    title={recording ? t("conversationDetail.stopRecording") : t("conversationDetail.recordVoice")}
                    className={clsx(
                      "flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-40",
                      recording
                        ? "bg-red-500 text-white hover:bg-red-600"
                        : "text-ink-600 hover:bg-ink-200/80 dark:text-ink-300 dark:hover:bg-ink-800",
                    )}
                    whileTap={{ scale: 0.92 }}
                    aria-pressed={recording}
                  >
                    {recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
                  </motion.button>
                  <Link
                    to="/profile"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-200/80 dark:text-ink-300 dark:hover:bg-ink-800"
                    title={t("conversationDetail.composerSignatureLink")}
                  >
                    <PenLine className="h-4 w-4" />
                  </Link>
                </div>
                <motion.button
                  type="submit"
                  disabled={
                    sending ||
                    !newMessage.trim() ||
                    (isOutsideWindow && !privateNote) ||
                    attachBusy ||
                    !!voicePreview ||
                    recording
                  }
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
                  whileTap={{ scale: 0.98 }}
                >
                  <Send className="h-4 w-4" />
                  {t("conversationDetail.composerSend")}
                </motion.button>
              </div>

              {(recording || voiceBusy || attachBusy) ? (
                <p className="border-t border-ink-100 px-3 py-2 text-center text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
                  {attachBusy
                    ? t("conversationDetail.sendingAttachment")
                    : voiceBusy
                      ? t("conversationDetail.voiceSending")
                      : t("conversationDetail.recording")}
                </p>
              ) : null}
            </div>
          </form>
        </motion.div>

        <div className="pointer-events-auto absolute right-3 top-28 z-30 hidden xl:block">
          <div className="flex flex-col gap-1 rounded-2xl border border-ink-200 bg-white/90 p-1 shadow-lg backdrop-blur dark:border-white/10 dark:bg-[#0F1B2B]/70 dark:shadow-black/30">
            <button
              type="button"
              onClick={() => setCrmDesktopOpen((o) => !o)}
              title={crmDesktopOpen ? t("conversationDetail.crmPanelCollapse") : t("conversationDetail.crmPanelExpand")}
              aria-label={crmDesktopOpen ? t("conversationDetail.crmPanelCollapse") : t("conversationDetail.crmPanelExpand")}
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                crmDesktopOpen
                  ? "bg-ink-100 text-ink-900 dark:bg-white/10 dark:text-ink-50"
                  : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-white/5",
              )}
            >
              <User className="h-5 w-5" />
            </button>
            {copilotEnabled ? (
              <button
                type="button"
                onClick={toggleCopilotPanel}
                title={t("conversationDetail.copilotToggle")}
                aria-label={t("conversationDetail.copilotToggle")}
                className={clsx(
                  "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                  copilotDesktopOpen
                    ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
                    : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-white/5",
                )}
              >
                <Sparkles className="h-5 w-5" />
              </button>
            ) : null}
            <Link
              to="/crm"
              title={t("conversationDetail.openKanban")}
              aria-label={t("conversationDetail.openKanban")}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-700 transition-colors hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-white/5"
            >
              <Kanban className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>

      <aside
        className={clsx(
          "hidden min-h-0 shrink-0 flex-col border-l border-ink-200/90 bg-white/95 transition-[width] duration-200 ease-out dark:border-white/10 dark:bg-[#0F1B2B]/70 xl:flex",
          crmDesktopOpen ? "w-[min(100%,380px)]" : "w-11 overflow-hidden",
        )}
      >
        <div
          className={clsx(
            "flex shrink-0 items-center border-b border-ink-100 dark:border-white/10",
            crmDesktopOpen ? "justify-end px-1 py-2" : "justify-center border-0 py-2",
          )}
        >
          <button
            type="button"
            onClick={() => setCrmDesktopOpen((o) => !o)}
            className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
            title={crmDesktopOpen ? t("conversationDetail.crmPanelCollapse") : t("conversationDetail.crmPanelExpand")}
            aria-expanded={crmDesktopOpen}
            aria-label={crmDesktopOpen ? t("conversationDetail.crmPanelCollapse") : t("conversationDetail.crmPanelExpand")}
          >
            {crmDesktopOpen ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>
        </div>
        {crmDesktopOpen ? <div className="min-h-0 flex-1 overflow-y-auto p-4">{renderCrmPanel()}</div> : null}
      </aside>

      {copilotDesktopOpen ? (
        <aside className="hidden min-h-0 w-[min(100%,360px)] shrink-0 flex-col border-l border-ink-200/90 bg-white/95 dark:border-white/10 dark:bg-[#0F1B2B]/70 xl:flex">
          <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-3 py-2 dark:border-white/10">
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("conversationDetail.copilotTitle")}</p>
            <button
              type="button"
              className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
              onClick={() => setCopilotDesktopOpen(false)}
              aria-label={t("common.close")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!assistantAiEnabled ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
                {t("aiInsightsPage.aiDisabled")}
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("conversationDetail.copilotStart")}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">{t("conversationDetail.copilotStartHint")}</p>
                <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-500">{t("conversationDetail.copilotTry")}</p>
                <div className="mt-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => void loadCopilotInsights("summary")}
                    disabled={copilotBusy}
                    className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white/80 px-3 py-2 text-left text-sm text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:hover:bg-white/10"
                  >
                    <span>{t("conversationDetail.copilotCmdSummarize")}</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrivateNote(false);
                      void handleAiSuggestReply();
                    }}
                    disabled={copilotBusy || suggestReplyBusy || privateNote}
                    className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white/80 px-3 py-2 text-left text-sm text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:hover:bg-white/10"
                  >
                    <span>{t("conversationDetail.copilotCmdSuggest")}</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadCopilotInsights("evaluate")}
                    disabled={copilotBusy}
                    className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white/80 px-3 py-2 text-left text-sm text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-ink-100 dark:hover:bg-white/10"
                  >
                    <span>{t("conversationDetail.copilotCmdEvaluate")}</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}

            {copilotError ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/35 dark:text-rose-100">
                {copilotError}
              </p>
            ) : null}

            {copilotBusy ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("aiInsightsPage.analyzing")}
              </div>
            ) : null}

            {copilotInsights ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-white/10 dark:bg-[#111C2B]/70">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-500">{t("aiInsightsPage.summary")}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-800 dark:text-ink-100">{copilotInsights.summary}</p>
                </div>
                <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-white/10 dark:bg-[#111C2B]/70">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-500">{t("aiInsightsPage.sentiment")}</p>
                  <p className="mt-2 text-sm text-ink-800 dark:text-ink-100">{copilotInsights.sentiment}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-500">{t("aiInsightsPage.intent")}</p>
                  <p className="mt-2 text-sm text-ink-800 dark:text-ink-100">{copilotInsights.intent}</p>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      <AnimatePresence>
        {crmMobileOpen ? (
          <motion.div
            className="fixed inset-0 z-40 flex justify-end bg-black/40 xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCrmMobileOpen(false)}
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.22 }}
              className="h-full w-full max-w-md overflow-y-auto border-l border-ink-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0F1B2B]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4">{renderCrmPanel({ showMobileClose: true })}</div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {copilotMobileOpen ? (
          <motion.div
            className="fixed inset-0 z-40 flex justify-end bg-black/40 xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCopilotMobileOpen(false)}
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.22 }}
              className="h-full w-full max-w-md overflow-y-auto border-l border-ink-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0F1B2B]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-white/10">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("conversationDetail.copilotTitle")}</p>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
                  onClick={() => setCopilotMobileOpen(false)}
                  aria-label={t("common.close")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-4">
                {!assistantAiEnabled ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
                    {t("aiInsightsPage.aiDisabled")}
                  </div>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("conversationDetail.copilotStart")}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">{t("conversationDetail.copilotStartHint")}</p>
                    <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-500">{t("conversationDetail.copilotTry")}</p>
                    <div className="mt-2 space-y-2">
                      <button
                        type="button"
                        onClick={() => void loadCopilotInsights("summary")}
                        disabled={copilotBusy}
                        className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white px-3 py-2 text-left text-sm text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-60 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
                      >
                        <span>{t("conversationDetail.copilotCmdSummarize")}</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPrivateNote(false);
                          void handleAiSuggestReply();
                        }}
                        disabled={copilotBusy || suggestReplyBusy || privateNote}
                        className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white px-3 py-2 text-left text-sm text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-60 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
                      >
                        <span>{t("conversationDetail.copilotCmdSuggest")}</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadCopilotInsights("evaluate")}
                        disabled={copilotBusy}
                        className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white px-3 py-2 text-left text-sm text-ink-800 shadow-sm hover:bg-ink-50 disabled:opacity-60 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 dark:hover:bg-ink-700"
                      >
                        <span>{t("conversationDetail.copilotCmdEvaluate")}</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}

                {copilotError ? (
                  <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/35 dark:text-rose-100">
                    {copilotError}
                  </p>
                ) : null}

                {copilotBusy ? (
                  <div className="mt-4 flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("aiInsightsPage.analyzing")}
                  </div>
                ) : null}

                {copilotInsights ? (
                  <div className="mt-6 space-y-4">
                    <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-800">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-500">{t("aiInsightsPage.summary")}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-800 dark:text-ink-100">{copilotInsights.summary}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
              className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-xl dark:border dark:border-ink-700 dark:bg-ink-900"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{t("conversationDetail.finalizeTitle")}</h3>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("conversationDetail.finalizeSubtitle")}</p>
              {conversation?.reopenClosureDefaults?.afterWonSale ? (
                <p className="mt-2 rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                  {t("conversationDetail.reopenAfterWonHint")}
                </p>
              ) : conversation?.reopenClosureDefaults?.closureValue != null &&
                conversation.reopenClosureDefaults.closureValue > 0 ? (
                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                  {t("conversationDetail.reopenCarryValueHint")}
                </p>
              ) : null}
              {(!resolveRequireClosureReason || !resolveRequireLeadType) && (
                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t("conversationDetail.finalizeRulesHint")}</p>
              )}
              <form onSubmit={submitResolve} className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                    {t("conversationDetail.leadType")}
                    {resolveRequireLeadType ? " *" : ` (${t("common.optional")})`}
                  </label>
                  <select
                    value={leadTypeId}
                    onChange={(e) => setLeadTypeId(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                    required={resolveRequireLeadType}
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
                  <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                    {t("conversationDetail.closureReason")}
                    {resolveRequireClosureReason ? " *" : ` (${t("common.optional")})`}
                  </label>
                  <textarea
                    value={closureReason}
                    onChange={(e) => setClosureReason(e.target.value)}
                    rows={4}
                    className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                    placeholder={t("conversationDetail.closureReasonHint")}
                    required={resolveRequireClosureReason}
                    minLength={resolveRequireClosureReason ? 3 : undefined}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                    {t("conversationDetail.closureValueOptional")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={closureAmount}
                    onChange={(e) => setClosureAmount(e.target.value)}
                    placeholder={t("conversationDetail.closureValuePlaceholder")}
                    className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                  />
                  <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t("conversationDetail.closureValueHint")}</p>
                </div>
                {showRemindersFeature && resolveOfferReminder ? (
                  <div className="rounded-xl border border-ink-200 bg-ink-50/80 p-4 dark:border-ink-700 dark:bg-ink-800/40">
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
                      {t("conversationDetail.resolveReminderTitle")}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                      {t("conversationDetail.resolveReminderHint")}
                    </p>
                    {conversation ? (
                      <p className="mt-2 text-xs text-ink-600 dark:text-ink-300">
                        {conversation.contact.name}
                        {conversation.contact.phone ? ` · ${conversation.contact.phone}` : ""}
                      </p>
                    ) : null}
                    <label className="mt-3 flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={createReminderOnResolve}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setCreateReminderOnResolve(checked);
                          if (checked && !reminderNote.trim() && closureReason.trim()) {
                            setReminderNote(closureReason.trim());
                          }
                        }}
                        className="h-4 w-4 rounded border-ink-300 text-brand-500 focus:ring-brand-500 dark:border-ink-600"
                      />
                      <span className="text-sm text-ink-700 dark:text-ink-200">
                        {t("conversationDetail.resolveReminderEnable")}
                      </span>
                    </label>
                    {createReminderOnResolve ? (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                            {t("conversationDetail.resolveReminderNote")}
                          </label>
                          <textarea
                            value={reminderNote}
                            onChange={(e) => setReminderNote(e.target.value)}
                            rows={2}
                            placeholder={t("conversationDetail.resolveReminderNotePlaceholder")}
                            className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                              {t("conversationDetail.resolveReminderDueDate")}
                            </label>
                            <input
                              type="date"
                              value={reminderDueDate}
                              onChange={(e) => setReminderDueDate(e.target.value)}
                              className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                              {t("conversationDetail.resolveReminderDueTime")}
                            </label>
                            <input
                              type="time"
                              value={reminderDueTime}
                              onChange={(e) => setReminderDueTime(e.target.value)}
                              className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {resolveError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{resolveError}</p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setResolveOpen(false)}
                    className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
                  >
                    {t("common.confirm")}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {transferOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            variants={backdropVariants}
            initial="hidden"
            animate="show"
            exit="hidden"
            onClick={() => !actionLoading && setTransferOpen(false)}
          >
            <motion.div
              variants={modalVariants}
              initial="hidden"
              animate="show"
              exit="hidden"
              className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-xl dark:border dark:border-ink-700 dark:bg-ink-900"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
                {t("conversationDetail.transferTitle")}
              </h3>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t("conversationDetail.transferSubtitle")}</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                    {t("conversationDetail.transferTeamLabel")}
                  </label>
                  <select
                    value={transferTeamId}
                    onChange={(e) => {
                      setTransferTeamId(e.target.value);
                      setTransferAssigneeId("");
                    }}
                    className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                  >
                    {teamOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                    {t("conversationDetail.transferAssigneeLabel")}
                  </label>
                  <select
                    value={transferAssigneeId}
                    onChange={(e) => setTransferAssigneeId(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                  >
                    <option value="">{t("conversationDetail.transferAssigneeNone")}</option>
                    {transferMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setTransferOpen(false)}
                    className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading || !transferTeamId || transferUnchanged}
                    onClick={() => void submitTransfer()}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
                  >
                    {t("conversationDetail.transferConfirm")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tagModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            variants={backdropVariants}
            initial="hidden"
            animate="show"
            exit="hidden"
            onClick={() => !tagBusy && closeTagModal()}
          >
            <motion.div
              variants={modalVariants}
              initial="hidden"
              animate="show"
              exit="hidden"
              className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-xl dark:border dark:border-ink-700 dark:bg-ink-900"
              onClick={(e) => e.stopPropagation()}
            >
              {tagModalPhase === "list" ? (
                <>
                  <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
                    {t("conversationDetail.tagManageTitle")}
                  </h3>
                  <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                    {t("conversationDetail.tagManageSubtitle")}
                  </p>
                  <ul className="mt-4 max-h-64 space-y-2 overflow-auto">
                    {orgTags.length === 0 ? (
                      <li className="text-sm text-ink-500 dark:text-ink-400">{t("conversationDetail.tagsEmptyOrg")}</li>
                    ) : (
                      orgTags.map((tag) => (
                        <li
                          key={tag.id}
                          className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/80 px-3 py-2 dark:border-ink-700 dark:bg-ink-800/50"
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full ring-1 ring-ink-200 dark:ring-ink-600"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                            {tag.name}
                          </span>
                          <button
                            type="button"
                            disabled={tagBusy}
                            onClick={() => openTagModalEdit(tag)}
                            className="rounded-lg p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-40 dark:text-ink-300 dark:hover:bg-ink-700"
                            aria-label={t("conversationDetail.tagEdit")}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={tagBusy}
                            onClick={() => void deleteOrgTag(tag)}
                            className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/40"
                            aria-label={t("conversationDetail.tagDelete")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={tagBusy}
                      onClick={() => openTagModalCreate(true)}
                      className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                    >
                      {t("conversationDetail.tagNew")}
                    </button>
                    <button
                      type="button"
                      disabled={tagBusy}
                      onClick={() => closeTagModal()}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500"
                    >
                      {t("common.close")}
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={(e) => void submitTagForm(e)}>
                  <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">
                    {tagModalFormEditingId
                      ? t("conversationDetail.tagEditTitle")
                      : t("conversationDetail.tagCreateTitle")}
                  </h3>
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                        {t("conversationDetail.tagNameLabel")}
                      </label>
                      <input
                        type="text"
                        value={tagFormName}
                        onChange={(e) => setTagFormName(e.target.value)}
                        maxLength={50}
                        className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                        {t("conversationDetail.tagColorLabel")}
                      </label>
                      <input
                        type="color"
                        value={tagFormColor}
                        onChange={(e) => setTagFormColor(e.target.value)}
                        className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-ink-300 bg-white dark:border-ink-600"
                      />
                    </div>
                    {tagFormError ? (
                      <p className="text-sm text-red-600 dark:text-red-400">{tagFormError}</p>
                    ) : null}
                  </div>
                  <div className="mt-6 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={tagBusy}
                      onClick={() => tagFormGoBack()}
                      className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
                    >
                      {tagModalFormFromList ? t("conversationDetail.tagBack") : t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={tagBusy}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
                    >
                      {t("conversationDetail.tagSave")}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {lightboxSrc ? (
          <ImageLightboxModal
            src={lightboxSrc}
            downloadLabel={t("conversationDetail.downloadImage")}
            closeLabel={t("common.close")}
            onClose={() => setLightboxSrc(null)}
          />
        ) : null}
      </AnimatePresence>
      <TemplateSendModal
        open={templateModalTemplate !== null}
        template={templateModalTemplate}
        contactId={conversation?.contact.id ?? ""}
        conversationId={conversation?.id}
        inboxId={conversation?.inbox?.id}
        onClose={() => setTemplateModalTemplate(null)}
        onSent={async () => {
          stickToBottomRef.current = true;
          await loadConversation();
        }}
      />
    </div>
  );
}
