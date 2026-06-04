import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Megaphone, Plus, RefreshCw, Sparkles, LayoutGrid, BookOpen, GitBranch, BarChart3, Tags, Search } from "lucide-react";
import { PageTransition } from "@/components/Motion";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { CampaignCenterMetrics } from "@/pages/broadcasts/CampaignCenterMetrics";
import { CampaignFiltersSidebar } from "@/pages/broadcasts/CampaignFiltersSidebar";
import { CampaignCard } from "@/pages/broadcasts/CampaignCard";
import {
  CampaignCreatorPanel,
  type CreatorDraft,
  type CreatorTab,
  defaultAdvancedOptions,
} from "@/pages/broadcasts/CampaignCreatorPanel";
import { CHANNEL_API, type SegmentRules } from "@/pages/broadcasts/CampaignAdvancedOptions";
import { segmentHasAudience } from "@/pages/broadcasts/campaignTypes";
import { CampaignTemplatesLibrary } from "@/pages/broadcasts/CampaignTemplatesLibrary";
import {
  FollowUpCampaignPanel,
  type FollowUpSubmitPayload,
  type FollowUpTagLogic,
} from "@/pages/broadcasts/FollowUpCampaignPanel";
import { resolveCampaignKind, segmentRulesWithKind } from "@/pages/broadcasts/campaignKind";
import {
  campaignToCreatorDraft,
  campaignToFollowUpInitial,
  type CampaignDetailRow,
} from "@/pages/broadcasts/campaignDraftMapper";
import { CampaignAnalyticsPanel } from "@/pages/broadcasts/CampaignAnalyticsPanel";
import { LeadFinderPanel } from "@/pages/broadcasts/LeadFinderPanel";
import {
  OMNICHANNEL_CHANNELS,
  type BroadcastDashboard,
  type CampaignCenterTab,
  type CampaignRow,
  type CampaignStatusFilter,
  type TagOption,
  type TemplateOption,
  type InboxOption,
} from "@/pages/broadcasts/campaignTypes";

export function BroadcastCampaignsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const showLeadFinder = user?.organizationFeatures?.lead_finder ?? false;
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [dashboard, setDashboard] = useState<BroadcastDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashLoading, setDashLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [centerTab, setCenterTab] = useState<CampaignCenterTab>("campaigns");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>("ALL");
  const [channelFilter, setChannelFilter] = useState("all");

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorTab, setCreatorTab] = useState<CreatorTab>("quick");
  const [creatorInitial, setCreatorInitial] = useState<Partial<CreatorDraft> | undefined>();

  const [tags, setTags] = useState<TagOption[]>([]);
  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [integrationTools, setIntegrationTools] = useState<{ id: string; name: string; toolType: string }[]>([]);
  const [pipelineStages, setPipelineStages] = useState<{ id: string; name: string }[]>([]);
  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([]);
  const [segmentPreview, setSegmentPreview] = useState<SegmentRules>({});
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewTagIds, setPreviewTagIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [followUpPreviewCount, setFollowUpPreviewCount] = useState<number | null>(null);
  const [followUpPreviewBusy, setFollowUpPreviewBusy] = useState(false);
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
  const [followUpFormError, setFollowUpFormError] = useState("");
  const [followUpSuccess, setFollowUpSuccess] = useState("");
  const [followUpEditInitial, setFollowUpEditInitial] = useState<ReturnType<typeof campaignToFollowUpInitial> | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListError("");
    try {
      const data = await api.get<CampaignRow[]>("/broadcasts");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "";
      setListError(msg || t("broadcastPage.listError"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    try {
      const data = await api.get<BroadcastDashboard>("/broadcasts/dashboard");
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setDashLoading(false);
    }
  }, []);

  const templatesFetchRef = useRef<AbortController | null>(null);
  const templatesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchedInboxRef = useRef<string | undefined>(undefined);

  const loadTemplatesForInbox = useCallback((inboxId?: string, options?: { sync?: boolean }) => {
    const key = inboxId ?? "";
    if (lastFetchedInboxRef.current === key && !options?.sync) return;

    if (templatesDebounceRef.current) clearTimeout(templatesDebounceRef.current);
    templatesDebounceRef.current = setTimeout(() => {
      void (async () => {
        templatesFetchRef.current?.abort();
        const controller = new AbortController();
        templatesFetchRef.current = controller;
        setTemplatesLoading(true);
        try {
          const params = new URLSearchParams();
          if (inboxId) params.set("inboxId", inboxId);
          if (options?.sync) params.set("sync", "1");
          const qs = params.toString();
          const tplList = await api.get<TemplateOption[]>(`/templates${qs ? `?${qs}` : ""}`, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          lastFetchedInboxRef.current = key;
          setTemplates(Array.isArray(tplList) ? tplList : []);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setTemplates([]);
        } finally {
          if (!controller.signal.aborted) setTemplatesLoading(false);
        }
      })();
    }, 350);
  }, []);

  const handleInboxChange = useCallback(
    (inboxId: string) => {
      loadTemplatesForInbox(inboxId || undefined);
    },
    [loadTemplatesForInbox],
  );

  const loadMeta = useCallback(async () => {
    try {
      const [tagList, inboxesRes, tools, stages, leadTypeList] = await Promise.all([
        api.get<TagOption[]>("/tags"),
        api.get<{ data: InboxOption[] }>("/inboxes"),
        api.get<{ id: string; name: string; toolType: string }[]>("/broadcasts/integration-tools").catch(() => []),
        api.get<{ id: string; name: string }[]>("/crm/pipeline-stages").catch(() => []),
        api.get<{ id: string; name: string }[]>("/lead-types").catch(() => []),
      ]);
      setTags(Array.isArray(tagList) ? tagList : []);
      const inboxRows = [...(inboxesRes.data ?? [])].sort(
        (a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name),
      );
      setInboxes(inboxRows);
      setIntegrationTools(Array.isArray(tools) ? tools : []);
      setPipelineStages(Array.isArray(stages) ? stages : []);
      setLeadTypes(Array.isArray(leadTypeList) ? leadTypeList : []);
      const defaultWa =
        inboxRows.find((i) => i.channelType === "WHATSAPP" && i.isDefault) ??
        inboxRows.find((i) => i.channelType === "WHATSAPP");
      loadTemplatesForInbox(defaultWa?.id);
    } catch {
      setTags([]);
      setInboxes([]);
      setTemplates([]);
      setIntegrationTools([]);
      setPipelineStages([]);
      setLeadTypes([]);
    }
  }, [loadTemplatesForInbox]);

  useEffect(() => {
    void loadList();
    void loadDashboard();
    void loadMeta();
  }, [loadList, loadDashboard, loadMeta]);

  const hasRunning = rows.some((r) => r.status === "RUNNING");

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => {
      void loadList();
      void loadDashboard();
    }, 4000);
    return () => window.clearInterval(id);
  }, [hasRunning, loadList, loadDashboard]);

  const runPreview = useCallback(
    async (tagIds: string[], segmentRules: SegmentRules) => {
      if (!segmentHasAudience(tagIds, segmentRules)) {
        setPreviewCount(null);
        return;
      }
      setPreviewBusy(true);
      try {
        const res = await api.post<{ audienceCount: number }>("/broadcasts/audience-preview", {
          tagIds,
          segmentRules,
        });
        setPreviewCount(typeof res.audienceCount === "number" ? res.audienceCount : 0);
      } catch {
        setPreviewCount(null);
      } finally {
        setPreviewBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!creatorOpen) return;
    const h = window.setTimeout(() => void runPreview(previewTagIds, segmentPreview), 400);
    return () => window.clearTimeout(h);
  }, [creatorOpen, previewTagIds.join(","), JSON.stringify(segmentPreview), runPreview]);

  const openCreator = (tab: CreatorTab = "quick", initial?: Partial<CreatorDraft>) => {
    setFormError("");
    setCreatorTab(tab);
    setCreatorInitial(initial);
    setPreviewTagIds(initial?.selectedTagIds ?? []);
    setPreviewCount(null);
    setCreatorOpen(true);
  };

  const handlePreview = useCallback((tagIds: string[], segmentRules: SegmentRules) => {
    setPreviewTagIds(tagIds);
    setSegmentPreview(segmentRules);
  }, []);

  const runFollowUpPreview = useCallback(async (tagIds: string[], tagLogic: FollowUpTagLogic) => {
    if (tagIds.length === 0) {
      setFollowUpPreviewCount(null);
      return;
    }
    setFollowUpPreviewBusy(true);
    try {
      const res = await api.post<{ audienceCount: number }>("/broadcasts/audience-preview", {
        tagIds,
        segmentRules: { tagLogic },
      });
      setFollowUpPreviewCount(typeof res.audienceCount === "number" ? res.audienceCount : 0);
    } catch {
      setFollowUpPreviewCount(null);
    } finally {
      setFollowUpPreviewBusy(false);
    }
  }, []);

  const handleFollowUpPreview = useCallback((tagIds: string[], tagLogic: FollowUpTagLogic) => {
    void runFollowUpPreview(tagIds, tagLogic);
  }, [runFollowUpPreview]);

  const handleFollowUpSubmit = async (payload: FollowUpSubmitPayload) => {
    setFollowUpSubmitting(true);
    setFollowUpFormError("");
    setFollowUpSuccess("");
    try {
      const body = {
        name: payload.name,
        channel: "WHATSAPP",
        inboxId: payload.inboxId,
        messageType: payload.messageType,
        tagIds: payload.tagIds,
        segmentRules: payload.segmentRules,
        scheduleType: payload.scheduleType,
        scheduledAt: payload.scheduledAt,
        cronExpression: payload.cronExpression,
        body: payload.body,
        templateId: payload.templateId,
        autoStart: payload.autoStart,
      };

      if (payload.editCampaignId) {
        await api.patch(`/broadcasts/${payload.editCampaignId}`, body);
        setFollowUpSuccess(t("broadcastPage.editSuccess"));
        setFollowUpEditInitial(null);
        setEditingCampaignId(null);
      } else {
        const res = await api.post<{
          started?: boolean;
          startError?: string | null;
          status?: string;
        }>("/broadcasts", body);
        if (res.startError) {
          setFollowUpFormError(t("broadcastPage.followUpStartPartial"));
        } else if (payload.scheduleType === "IMMEDIATE" && res.started) {
          setFollowUpSuccess(t("broadcastPage.followUpSuccessStarted"));
        } else if (payload.scheduleType === "SCHEDULED") {
          setFollowUpSuccess(t("broadcastPage.followUpSuccessScheduled"));
        } else if (payload.scheduleType === "RECURRING") {
          setFollowUpSuccess(t("broadcastPage.followUpSuccessRecurring"));
        } else {
          setFollowUpSuccess(t("broadcastPage.followUpSuccessDraft"));
        }
      }
      void loadList();
      void loadDashboard();
      setCenterTab("campaigns");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.createError");
      setFollowUpFormError(msg || t("broadcastPage.createError"));
    } finally {
      setFollowUpSubmitting(false);
    }
  };

  const openEditCampaign = async (id: string) => {
    setActionBusy(id);
    setFormError("");
    try {
      const detail = await api.get<CampaignDetailRow>(`/broadcasts/${id}`);
      const kind = resolveCampaignKind(detail);
      setEditingCampaignId(id);
      if (kind === "followup") {
        setFollowUpEditInitial(campaignToFollowUpInitial(detail));
        setFollowUpFormError("");
        setCenterTab("followup");
      } else {
        setFollowUpEditInitial(null);
        const draft = campaignToCreatorDraft(detail);
        setCreatorInitial(draft);
        setCreatorTab(kind === "flow" ? "flow" : kind === "ai" ? "ai" : "quick");
        setCreatorOpen(true);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.loadCampaignError");
      alert(msg);
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreate = async (draft: CreatorDraft, editId?: string | null) => {
    const nameTrim = draft.name.trim();
    const adv = draft.advanced;
    if (!nameTrim || !segmentHasAudience(draft.selectedTagIds, adv.segmentRules)) return;

    setSubmitting(true);
    setFormError("");
    try {
      const channel = CHANNEL_API[adv.channel] ?? "WHATSAPP";
      const kind = creatorTab === "flow" ? "flow" : creatorTab === "ai" ? "ai" : "broadcast";
      const payload: Record<string, unknown> = {
        name: nameTrim,
        channel,
        messageType: channel === "EMAIL" ? "TEXT" : draft.messageType,
        tagIds: draft.selectedTagIds,
        segmentRules: segmentRulesWithKind(adv.segmentRules as Record<string, unknown>, kind),
        flowDefinition: draft.flowDefinition ?? undefined,
        scheduleType: adv.scheduleType,
        requiresApproval: adv.requiresApproval,
        useDistributedQueue: adv.useDistributedQueue,
        throttleMs: adv.throttleMs,
        revenuePerConversion: adv.revenuePerConversion ? Number(adv.revenuePerConversion) : undefined,
        subject: adv.subject || undefined,
        cronExpression: adv.cronExpression || undefined,
        eventTrigger: adv.eventTrigger || undefined,
      };
      if (adv.scheduleType === "SCHEDULED" && adv.scheduledAt) {
        payload.scheduledAt = new Date(adv.scheduledAt).toISOString();
      }
      if (adv.abConfig.enabled) {
        payload.abConfig = {
          enabled: true,
          splitPercentA: adv.abConfig.splitPercentA,
          variantA: { body: adv.abConfig.variantA.body || draft.body },
          variantB: { body: adv.abConfig.variantB.body || draft.body },
        };
      }
      if (adv.integrationToolId) payload.integrationToolId = adv.integrationToolId;
      if (adv.inboxId) payload.inboxId = adv.inboxId;
      if (draft.messageType === "TEXT" || channel === "EMAIL") payload.body = draft.body.trim();
      else if (draft.templateId) payload.templateId = draft.templateId;

      if (editId) {
        await api.patch(`/broadcasts/${editId}`, payload);
      } else {
        await api.post("/broadcasts", payload);
      }
      setCreatorOpen(false);
      setEditingCampaignId(null);
      void loadList();
      void loadDashboard();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.createError");
      setFormError(msg || t("broadcastPage.createError"));
    } finally {
      setSubmitting(false);
    }
  };

  const startCampaign = async (id: string) => {
    setActionBusy(id);
    try {
      await api.post(`/broadcasts/${id}/start`);
      void loadList();
      void loadDashboard();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.startError");
      alert(msg);
    } finally {
      setActionBusy(null);
    }
  };

  const approveCampaign = async (id: string, approve: boolean) => {
    setActionBusy(id);
    try {
      await api.post(`/broadcasts/${id}/approve`, { approve });
      void loadList();
    } finally {
      setActionBusy(null);
    }
  };

  const cancelCampaign = async (id: string) => {
    setActionBusy(id);
    try {
      await api.post(`/broadcasts/${id}/cancel`);
      void loadList();
      void loadDashboard();
    } finally {
      setActionBusy(null);
    }
  };

  const pauseCampaign = async (id: string) => {
    setActionBusy(id);
    try {
      await api.post(`/broadcasts/${id}/pause`);
      void loadList();
      void loadDashboard();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.pauseError");
      alert(msg);
    } finally {
      setActionBusy(null);
    }
  };

  const resumeCampaign = async (id: string) => {
    setActionBusy(id);
    try {
      await api.post(`/broadcasts/${id}/resume`);
      void loadList();
      void loadDashboard();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.resumeError");
      alert(msg);
    } finally {
      setActionBusy(null);
    }
  };

  const deleteDraft = async (id: string, status?: string) => {
    const msg =
      status === "COMPLETED" ? t("broadcastPage.deleteCompletedConfirm") : t("broadcastPage.deleteConfirm");
    if (!window.confirm(msg)) return;
    setActionBusy(id);
    try {
      await api.delete(`/broadcasts/${id}`);
      void loadList();
      void loadDashboard();
    } catch {
      /* ignore */
    } finally {
      setActionBusy(null);
    }
  };

  const statusLabel = (s: string) =>
    ({
      DRAFT: t("broadcastPage.statusDraft"),
      RUNNING: t("broadcastPage.statusRunning"),
      COMPLETED: t("broadcastPage.statusCompleted"),
      FAILED: t("broadcastPage.statusFailed"),
      CANCELLED: t("broadcastPage.statusCancelled"),
    })[s] ?? s;

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (channelFilter !== "all") {
        const ch = (r.channel ?? "WHATSAPP").toLowerCase();
        if (ch !== channelFilter) return false;
      }
      if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, statusFilter, channelFilter, search]);

  const centerTabs: { id: CampaignCenterTab; label: string; icon: typeof LayoutGrid }[] = [
    { id: "campaigns", label: t("broadcastPage.tabCampaigns"), icon: LayoutGrid },
    { id: "followup", label: t("broadcastPage.tabFollowUp"), icon: Tags },
    ...(showLeadFinder ? [{ id: "leadfinder" as const, label: t("broadcastPage.tabLeadFinder"), icon: Search }] : []),
    { id: "templates", label: t("broadcastPage.tabTemplates"), icon: BookOpen },
    { id: "flows", label: t("broadcastPage.tabFlows"), icon: GitBranch },
    { id: "analytics", label: t("broadcastPage.tabAnalytics"), icon: BarChart3 },
  ];

  const statusFunnel = dashboard?.statusBreakdown ?? {};

  return (
    <PageTransition>
      <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink-900 dark:text-ink-50">
            <Megaphone className="h-7 w-7 text-brand-600" />
            {t("broadcastPage.centerTitle")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-600 dark:text-ink-400">{t("broadcastPage.centerSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void loadList();
              void loadDashboard();
            }}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t("common.refresh")}
          </button>
          <button
            type="button"
            onClick={() => openCreator("ai")}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {t("broadcastPage.aiCampaign")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFollowUpSuccess("");
              setFollowUpFormError("");
              setFollowUpEditInitial(null);
              setEditingCampaignId(null);
              setCenterTab("followup");
            }}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Tags className="h-4 w-4" />
            {t("broadcastPage.followUpCta")}
          </button>
          <button type="button" onClick={() => openCreator("quick")} className="btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            {t("broadcastPage.newCampaign")}
          </button>
        </div>
      </header>

      <CampaignCenterMetrics dashboard={dashboard} loading={dashLoading} />

      <div className="flex flex-wrap gap-2">
        {OMNICHANNEL_CHANNELS.map((ch) => (
          <span
            key={ch.id}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold",
              ch.available
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200"
                : "border-ink-200 bg-ink-50 text-ink-500 dark:border-white/10 dark:bg-white/5 dark:text-ink-400",
            )}
          >
            {t(ch.labelKey)}
            {!ch.available ? (
              <span className="rounded bg-ink-200/80 px-1 py-0.5 text-[9px] uppercase dark:bg-white/10">{t("broadcastPage.soon")}</span>
            ) : null}
          </span>
        ))}
      </div>

      {Object.keys(statusFunnel).length > 0 ? (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-ink-200/80 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-white/5">
          <span className="w-full text-[10px] font-bold uppercase tracking-wider text-ink-500 sm:w-auto sm:py-1">
            {t("broadcastPage.funnelTitle")}
          </span>
          {(["DRAFT", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const).map((s) =>
            statusFunnel[s] ? (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={clsx(
                  "rounded-lg px-3 py-1 text-xs font-semibold tabular-nums",
                  statusFilter === s ? "bg-brand-500 text-white" : "bg-ink-100 text-ink-700 dark:bg-white/10 dark:text-ink-200",
                )}
              >
                {statusLabel(s)}: {statusFunnel[s]}
              </button>
            ) : null,
          )}
        </div>
      ) : null}

      <div className="flex gap-1 overflow-x-auto border-b border-ink-200 dark:border-white/10">
        {centerTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setCenterTab(id)}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              centerTab === id
                ? "border-brand-500 text-brand-700 dark:text-brand-300"
                : "border-transparent text-ink-500 hover:text-ink-700",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className={clsx("grid gap-6", centerTab === "followup" || centerTab === "leadfinder" ? "" : "lg:grid-cols-[240px_1fr]")}>
        {centerTab === "campaigns" ? (
          <CampaignFiltersSidebar
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            channelFilter={channelFilter}
            onChannelFilterChange={setChannelFilter}
          />
        ) : centerTab !== "followup" && centerTab !== "leadfinder" ? (
          <div className="hidden lg:block" />
        ) : null}

        <div className={clsx("min-w-0", centerTab === "followup" && "max-w-3xl")}>
          {centerTab === "leadfinder" && showLeadFinder ? (
            <LeadFinderPanel
              tags={tags}
              leadTypes={leadTypes}
              inboxes={inboxes}
              templates={templates}
              templatesLoading={templatesLoading}
              onInboxChange={handleInboxChange}
              onOpenSettings={() => navigate("/settings?section=leadFinder")}
            />
          ) : null}

          {centerTab === "followup" ? (
            <FollowUpCampaignPanel
              tags={tags}
              inboxes={inboxes}
              templates={templates}
              templatesLoading={templatesLoading}
              previewCount={followUpPreviewCount}
              previewBusy={followUpPreviewBusy}
              submitting={followUpSubmitting}
              formError={followUpFormError}
              successMessage={followUpSuccess}
              editInitial={followUpEditInitial}
              onCancelEdit={() => {
                setFollowUpEditInitial(null);
                setEditingCampaignId(null);
              }}
              onPreview={handleFollowUpPreview}
              onInboxChange={handleInboxChange}
              onSubmit={handleFollowUpSubmit}
              onTemplatesRefresh={(id) => loadTemplatesForInbox(id || undefined, { sync: true })}
            />
          ) : null}

          {centerTab === "campaigns" ? (
            <>
              {loading ? (
                <p className="text-sm text-ink-500">{t("common.loading")}</p>
              ) : listError ? (
                <p className="text-sm text-red-600" role="alert">
                  {listError}
                </p>
              ) : filteredRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-ink-200 p-12 text-center dark:border-white/10">
                  <p className="text-sm text-ink-500">{t("broadcastPage.empty")}</p>
                  <button type="button" className="btn-primary mt-4" onClick={() => openCreator("quick")}>
                    {t("broadcastPage.newCampaign")}
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredRows.map((r) => (
                    <CampaignCard
                      key={r.id}
                      row={r}
                      statusLabel={statusLabel}
                      actionBusy={actionBusy}
                      onStart={startCampaign}
                      onEdit={openEditCampaign}
                      onDelete={(id) => deleteDraft(id, r.status)}
                      onApprove={approveCampaign}
                      onCancel={cancelCampaign}
                      onPause={pauseCampaign}
                      onResume={resumeCampaign}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}

          {centerTab === "templates" ? (
            <CampaignTemplatesLibrary
              onUseTemplate={(_id, name, body) =>
                openCreator("quick", {
                  name,
                  messageType: "TEXT",
                  body,
                  selectedTagIds: [],
                  advanced: defaultAdvancedOptions(),
                  flowDefinition: null,
                })
              }
            />
          ) : null}

          {centerTab === "flows" ? (
            <div className="rounded-2xl border border-ink-200/80 bg-white/90 p-8 text-center dark:border-white/10 dark:bg-[#111C2B]/55">
              <GitBranch className="mx-auto h-12 w-12 text-brand-500 opacity-60" />
              <h3 className="mt-4 text-lg font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.flowsTitle")}</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm text-ink-600 dark:text-ink-400">{t("broadcastPage.flowsSubtitle")}</p>
              <button type="button" className="btn-primary mt-6" onClick={() => openCreator("flow")}>
                {t("broadcastPage.flowsCta")}
              </button>
            </div>
          ) : null}

          {centerTab === "analytics" ? <CampaignAnalyticsPanel /> : null}
        </div>
      </div>

      <p className="text-xs text-ink-500 dark:text-ink-500">{t("broadcastPage.footnote")}</p>

      <CampaignCreatorPanel
        open={creatorOpen}
        onClose={() => {
          setCreatorOpen(false);
          setEditingCampaignId(null);
        }}
        editCampaignId={editingCampaignId}
        tags={tags}
        inboxes={inboxes}
        templates={templates}
        templatesLoading={templatesLoading}
        initialTab={creatorTab}
        initialDraft={creatorInitial}
        previewCount={previewCount}
        previewBusy={previewBusy}
        submitting={submitting}
        formError={formError}
        integrationTools={integrationTools}
        pipelineStages={pipelineStages}
        onPreview={handlePreview}
        onInboxChange={handleInboxChange}
        onSubmit={(draft) => void handleCreate(draft, editingCampaignId)}
      />
      </div>
    </PageTransition>
  );
}
