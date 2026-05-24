import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  Building2,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  Globe,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, ApiError } from "@/lib/api";
import {
  filterTemplatesForWhatsappInbox,
  isEvolutionWhatsappProvider,
  templateOptionStatusSuffix,
  whatsappProviderForInbox,
} from "@/lib/campaignTemplates";
import type { InboxOption, TagOption, TemplateOption } from "./campaignTypes";
import {
  buildFollowUpSchedulePayload,
  defaultFollowUpScheduleState,
  FollowUpScheduleFields,
  type FollowUpScheduleState,
} from "./FollowUpScheduleFields";
import { LeadFinderAutomationsPanel } from "./LeadFinderAutomationsPanel";

export interface LeadFinderResult {
  placeId: string | null;
  title: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  rating: number | null;
  reviews: number | null;
  type: string | null;
  openState: string | null;
  unclaimedListing: boolean;
}

export interface LeadFinderSegmentRow {
  id: string;
  name: string;
  niche: string;
  city: string;
  isPreset: boolean;
}

interface LeadTypeOption {
  id: string;
  name: string;
}

interface Props {
  tags: TagOption[];
  leadTypes: LeadTypeOption[];
  inboxes: InboxOption[];
  templates: TemplateOption[];
  templatesLoading?: boolean;
  onInboxChange: (inboxId: string) => void;
  onOpenSettings?: () => void;
}

export function LeadFinderPanel({
  tags,
  leadTypes,
  inboxes,
  templates,
  templatesLoading = false,
  onInboxChange,
  onOpenSettings,
}: Props) {
  const { t } = useI18n();
  const [panelTab, setPanelTab] = useState<"search" | "automations">("search");
  const [statusLoading, setStatusLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [segments, setSegments] = useState<LeadFinderSegmentRow[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [showSegmentForm, setShowSegmentForm] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [segmentName, setSegmentName] = useState("");
  const [segmentNiche, setSegmentNiche] = useState("");
  const [segmentCity, setSegmentCity] = useState("");
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [searchMode, setSearchMode] = useState<"custom" | "segment">("custom");
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("São Paulo, SP");
  const [segmentId, setSegmentId] = useState("");
  const [results, setResults] = useState<LeadFinderResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [nextStart, setNextStart] = useState<number | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [importTagIds, setImportTagIds] = useState<string[]>([]);
  const [leadTypeId, setLeadTypeId] = useState("");
  const [createImportTag, setCreateImportTag] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [createFollowUp, setCreateFollowUp] = useState(false);
  const [followUpSchedule, setFollowUpSchedule] = useState<FollowUpScheduleState>(defaultFollowUpScheduleState);
  const [inboxId, setInboxId] = useState("");
  const [messageType, setMessageType] = useState<"TEXT" | "TEMPLATE">("TEMPLATE");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("");

  const waInboxes = useMemo(() => inboxes.filter((i) => i.channelType === "WHATSAPP"), [inboxes]);
  const selectedInbox = useMemo(() => waInboxes.find((i) => i.id === inboxId), [waInboxes, inboxId]);
  const selectedWaProvider = whatsappProviderForInbox(selectedInbox);
  const visibleTemplates = useMemo(
    () =>
      filterTemplatesForWhatsappInbox(templates, selectedInbox, {
        allowVariableTemplates: isEvolutionWhatsappProvider(selectedWaProvider),
      }),
    [templates, selectedInbox, selectedWaProvider],
  );
  const activeSegment = segments.find((s) => s.id === segmentId);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await api.get<{ configured: boolean }>("/lead-finder/status");
      setConfigured(Boolean(data.configured));
    } catch {
      setConfigured(false);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadSegments = useCallback(async () => {
    setSegmentsLoading(true);
    try {
      const data = await api.get<{ segments: LeadFinderSegmentRow[] }>("/lead-finder/segments");
      const list = data.segments ?? [];
      setSegments(list);
      if (list.length > 0) {
        setSegmentId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0].id));
      }
    } catch {
      setSegments([]);
    } finally {
      setSegmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadSegments();
  }, [loadStatus, loadSegments]);

  const patchFollowUpSchedule = (patch: Partial<FollowUpScheduleState>) =>
    setFollowUpSchedule((prev) => ({ ...prev, ...patch }));

  const resetSegmentForm = () => {
    setShowSegmentForm(false);
    setEditingSegmentId(null);
    setSegmentName("");
    setSegmentNiche("");
    setSegmentCity("");
  };

  const openCreateSegment = () => {
    resetSegmentForm();
    setSegmentName(niche.trim() && city.trim() ? `${niche.trim()} — ${city.trim()}`.slice(0, 120) : "");
    setSegmentNiche(niche.trim() || "");
    setSegmentCity(city.trim() || "São Paulo, SP");
    setShowSegmentForm(true);
  };

  const openEditSegment = (seg: LeadFinderSegmentRow) => {
    setEditingSegmentId(seg.id);
    setSegmentName(seg.name);
    setSegmentNiche(seg.niche);
    setSegmentCity(seg.city);
    setShowSegmentForm(true);
  };

  const saveSegment = async () => {
    if (!segmentName.trim() || !segmentNiche.trim() || !segmentCity.trim()) return;
    setSegmentBusy(true);
    setError("");
    try {
      if (editingSegmentId) {
        await api.patch(`/lead-finder/segments/${editingSegmentId}`, {
          name: segmentName.trim(),
          niche: segmentNiche.trim(),
          city: segmentCity.trim(),
        });
      } else {
        await api.post("/lead-finder/segments", {
          name: segmentName.trim(),
          niche: segmentNiche.trim(),
          city: segmentCity.trim(),
        });
      }
      resetSegmentForm();
      void loadSegments();
      setSuccess(t("leadFinder.segmentSaveSuccess"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("leadFinder.segmentSaveError"));
    } finally {
      setSegmentBusy(false);
    }
  };

  const deleteSegment = async (id: string) => {
    if (!window.confirm(t("leadFinder.segmentDeleteConfirm"))) return;
    try {
      await api.delete(`/lead-finder/segments/${id}`);
      void loadSegments();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("leadFinder.segmentSaveError"));
    }
  };

  const runSearch = async (start = 0, append = false) => {
    setSearchBusy(true);
    setError("");
    try {
      const payload =
        searchMode === "segment" && activeSegment
          ? { niche: activeSegment.niche, city: activeSegment.city, start }
          : { niche: niche.trim(), city: city.trim(), start };

      const data = await api.post<{
        query: string;
        results: LeadFinderResult[];
        nextStart: number | null;
      }>("/lead-finder/search", payload);

      setLastQuery(data.query);
      setNextStart(data.nextStart);
      if (append) {
        setResults((prev) => {
          const offset = prev.length;
          setSelected((sel) => {
            const next = new Set(sel);
            data.results.forEach((_, i) => next.add(offset + i));
            return next;
          });
          return [...prev, ...data.results];
        });
      } else {
        setResults(data.results);
        setSelected(new Set(data.results.map((_, i) => i)));
        setSuccess("");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("leadFinder.searchError"));
    } finally {
      setSearchBusy(false);
    }
  };

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleTag = (id: string) => {
    setImportTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectedLeads = useMemo(
    () => results.filter((_, i) => selected.has(i)),
    [results, selected],
  );

  const canImportFollowUp =
    !createFollowUp ||
    (inboxId &&
      (messageType === "TEXT" ? body.trim().length > 0 : Boolean(templateId)) &&
      (followUpSchedule.scheduleMode !== "scheduled" || Boolean(followUpSchedule.scheduledAt)));

  const handleImport = async () => {
    if (selectedLeads.length === 0 || !canImportFollowUp) return;
    setImportBusy(true);
    setError("");
    setSuccess("");
    try {
      const importTagName = lastQuery ? `Lead Finder: ${lastQuery}`.slice(0, 100) : undefined;
      const schedulePayload = createFollowUp ? buildFollowUpSchedulePayload(followUpSchedule) : null;

      const data = await api.post<{
        created: number;
        updated: number;
        skipped: number;
        tagIds: string[];
        followUp?: { campaignId: string; started: boolean };
      }>("/lead-finder/import", {
        leads: selectedLeads.map((l) => ({
          placeId: l.placeId,
          title: l.title,
          phone: l.phone,
          address: l.address,
          website: l.website,
          email: l.email,
          type: l.type,
          rating: l.rating,
        })),
        tagIds: importTagIds,
        leadTypeId: leadTypeId || null,
        createImportTag,
        importTagName,
        updateExisting,
        followUp: createFollowUp
          ? {
              name: t("leadFinder.followUpDefaultName").replace("{query}", lastQuery || t("leadFinder.title")),
              inboxId,
              messageType,
              body: messageType === "TEXT" ? body.trim() : undefined,
              templateId: messageType === "TEMPLATE" ? templateId : undefined,
              scheduleType: schedulePayload!.scheduleType,
              scheduledAt: schedulePayload!.scheduledAt,
              segmentRules: schedulePayload!.segmentRules,
              cronExpression: schedulePayload!.cronExpression,
              autoStart: schedulePayload!.autoStart,
            }
          : undefined,
      });

      let msg = t("leadFinder.importSuccess")
        .replace("{created}", String(data.created))
        .replace("{updated}", String(data.updated))
        .replace("{skipped}", String(data.skipped));
      if (data.followUp) msg += ` ${t("leadFinder.followUpSuccess")}`;
      setSuccess(msg);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("leadFinder.importError"));
    } finally {
      setImportBusy(false);
    }
  };

  if (statusLoading) {
    return <p className="text-sm text-ink-500">{t("common.loading")}</p>;
  }

  if (!configured) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800/50 dark:bg-amber-950/20">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{t("leadFinder.notConfigured")}</p>
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{t("leadFinder.notConfiguredHint")}</p>
        {onOpenSettings ? (
          <button type="button" className="btn-primary mt-4 text-sm" onClick={onOpenSettings}>
            {t("leadFinder.openSettings")}
          </button>
        ) : null}
        <a
          href="https://serpapi.com/google-maps-api"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
        >
          SerpApi Google Maps API
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50/80 to-white/90 p-5 dark:border-brand-800/40 dark:from-brand-950/25 dark:to-[#111C2B]/55">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900 dark:text-ink-50">
          <Building2 className="h-5 w-5 text-brand-600" />
          {t("leadFinder.title")}
        </h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("leadFinder.subtitle")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["search", "automations"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPanelTab(tab)}
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs font-semibold",
                panelTab === tab
                  ? "border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-950/40"
                  : "border-ink-200 text-ink-600 dark:border-white/10",
              )}
            >
              {tab === "search" ? t("leadFinder.tabSearch") : t("leadFinder.tabAutomations")}
            </button>
          ))}
        </div>
      </div>

      {success ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {panelTab === "automations" ? (
        <LeadFinderAutomationsPanel
          segments={segments}
          tags={tags}
          leadTypes={leadTypes}
          inboxes={inboxes}
          templates={templates}
          templatesLoading={templatesLoading}
          onInboxChange={onInboxChange}
          onSegmentsChange={loadSegments}
        />
      ) : (
        <>
          <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
            <div className="flex flex-wrap gap-2">
              {(["custom", "segment"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSearchMode(mode)}
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-xs font-semibold",
                    searchMode === mode
                      ? "border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-950/40"
                      : "border-ink-200 text-ink-600 dark:border-white/10",
                  )}
                >
                  {mode === "custom" ? t("leadFinder.modeCustom") : t("leadFinder.modeSegment")}
                </button>
              ))}
            </div>

            {searchMode === "segment" ? (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-ink-600">{t("leadFinder.segmentLabel")}</label>
                  <select
                    className="input mt-1 w-full"
                    value={segmentId}
                    onChange={(e) => setSegmentId(e.target.value)}
                    disabled={segmentsLoading}
                  >
                    {segments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.niche}, {s.city}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={openCreateSegment}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("leadFinder.segmentCreateBtn")}
                  </button>
                  {activeSegment ? (
                    <>
                      <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs" onClick={() => openEditSegment(activeSegment)}>
                        <Pencil className="h-3.5 w-3.5" />
                        {t("leadFinder.segmentEditBtn")}
                      </button>
                      {!activeSegment.isPreset ? (
                        <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => void deleteSegment(activeSegment.id)}>
                          <Trash2 className="inline h-3.5 w-3.5" />
                          {t("leadFinder.segmentDeleteBtn")}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {showSegmentForm ? (
                  <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-4 dark:border-white/10 dark:bg-white/5">
                    <p className="text-xs font-bold text-ink-700">{editingSegmentId ? t("leadFinder.segmentEditTitle") : t("leadFinder.segmentCreateTitle")}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <input className="input" placeholder={t("leadFinder.segmentNamePlaceholder")} value={segmentName} onChange={(e) => setSegmentName(e.target.value)} />
                      <input className="input" placeholder={t("leadFinder.nichePlaceholder")} value={segmentNiche} onChange={(e) => setSegmentNiche(e.target.value)} />
                      <input className="input" placeholder={t("leadFinder.cityPlaceholder")} value={segmentCity} onChange={(e) => setSegmentCity(e.target.value)} />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" className="btn-primary text-xs" disabled={segmentBusy} onClick={() => void saveSegment()}>
                        {segmentBusy ? t("common.loading") : t("leadFinder.segmentSaveBtn")}
                      </button>
                      <button type="button" className="btn-secondary text-xs" onClick={resetSegmentForm}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-ink-600">{t("leadFinder.nicheLabel")}</label>
                  <input className="input mt-1 w-full" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("leadFinder.nichePlaceholder")} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-600">{t("leadFinder.cityLabel")}</label>
                  <input className="input mt-1 w-full" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("leadFinder.cityPlaceholder")} />
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" disabled={searchBusy} onClick={() => void runSearch(0, false)}>
                {searchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {t("leadFinder.searchBtn")}
              </button>
              {nextStart != null ? (
                <button type="button" className="btn-secondary text-sm" disabled={searchBusy} onClick={() => void runSearch(nextStart, true)}>
                  {t("leadFinder.loadMore")}
                </button>
              ) : null}
              {searchMode === "custom" && niche.trim() && city.trim() ? (
                <button type="button" className="btn-secondary inline-flex items-center gap-1 text-sm" onClick={openCreateSegment}>
                  <Plus className="h-4 w-4" />
                  {t("leadFinder.saveAsSegmentBtn")}
                </button>
              ) : null}
            </div>
            {lastQuery ? <p className="mt-2 text-xs text-ink-500">{t("leadFinder.lastQuery").replace("{query}", lastQuery)}</p> : null}
          </section>

          {results.length > 0 ? (
            <>
              <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">
                    {t("leadFinder.resultsTitle").replace("{count}", String(results.length))}
                  </h3>
                  <span className="text-xs text-ink-500">{t("leadFinder.selectedCount").replace("{count}", String(selectedLeads.length))}</span>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 text-xs uppercase text-ink-500 dark:border-white/10">
                        <th className="px-2 py-2" />
                        <th className="px-2 py-2">{t("leadFinder.colName")}</th>
                        <th className="px-2 py-2">{t("leadFinder.colPhone")}</th>
                        <th className="px-2 py-2">{t("leadFinder.colAddress")}</th>
                        <th className="px-2 py-2">{t("leadFinder.colType")}</th>
                        <th className="px-2 py-2">{t("leadFinder.colRating")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((row, index) => (
                        <tr key={`${row.placeId ?? row.title}-${index}`} className="border-b border-ink-100 dark:border-white/5">
                          <td className="px-2 py-2">
                            <input type="checkbox" checked={selected.has(index)} onChange={() => toggleSelect(index)} />
                          </td>
                          <td className="px-2 py-2 font-medium text-ink-900 dark:text-ink-50">
                            <div>{row.title}</div>
                            {row.website ? (
                              <a href={row.website} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                                <Globe className="h-3 w-3" />
                                {t("leadFinder.website")}
                              </a>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 text-ink-600">
                            {row.phone ? (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="h-3.5 w-3.5" />
                                {row.phone}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="max-w-[220px] px-2 py-2 text-xs text-ink-600">
                            {row.address ? (
                              <span className="inline-flex items-start gap-1">
                                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {row.address}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs text-ink-600">{row.type ?? "—"}</td>
                          <td className="px-2 py-2 text-xs text-ink-600">
                            {row.rating != null ? (
                              <span className="inline-flex items-center gap-1">
                                <Star className="h-3.5 w-3.5 text-amber-500" />
                                {row.rating}
                                {row.reviews != null ? ` (${row.reviews})` : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-ink-500">{t("leadFinder.emailNote")}</p>
              </section>

              <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-ink-50">
                  <Download className="h-4 w-4" />
                  {t("leadFinder.importTitle")}
                </h3>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-ink-600">{t("leadFinder.tagsLabel")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={clsx(
                            "rounded-full border px-3 py-1 text-xs font-semibold",
                            importTagIds.includes(tag.id) ? "border-brand-400 bg-brand-100 text-brand-900" : "border-ink-200 bg-ink-50 text-ink-700",
                          )}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-600">{t("leadFinder.leadTypeLabel")}</label>
                    <select className="input mt-1 w-full" value={leadTypeId} onChange={(e) => setLeadTypeId(e.target.value)}>
                      <option value="">{t("leadFinder.leadTypeNone")}</option>
                      {leadTypes.map((lt) => (
                        <option key={lt.id} value={lt.id}>
                          {lt.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs text-ink-600">
                    <input type="checkbox" checked={createImportTag} onChange={(e) => setCreateImportTag(e.target.checked)} />
                    {t("leadFinder.createImportTag")}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-ink-600">
                    <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                    {t("leadFinder.updateExisting")}
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                    <input type="checkbox" checked={createFollowUp} onChange={(e) => setCreateFollowUp(e.target.checked)} />
                    {t("leadFinder.createFollowUpOnImport")}
                  </label>
                </div>

                {createFollowUp ? (
                  <div className="mt-4 space-y-4 rounded-xl border border-violet-200/80 bg-violet-50/40 p-4 dark:border-violet-800/40 dark:bg-violet-950/20">
                    <FollowUpScheduleFields state={followUpSchedule} onChange={patchFollowUpSchedule} title={t("leadFinder.followUpWhenTitle")} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-ink-600">{t("broadcastPage.creatorInbox")}</label>
                        <select
                          className="input mt-1 w-full"
                          value={inboxId}
                          onChange={(e) => {
                            setInboxId(e.target.value);
                            onInboxChange(e.target.value);
                          }}
                        >
                          <option value="">{t("broadcastPage.selectInbox")}</option>
                          {waInboxes.map((inbox) => (
                            <option key={inbox.id} value={inbox.id}>
                              {inbox.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2 sm:col-span-2">
                        {(["TEMPLATE", "TEXT"] as const).map((mt) => (
                          <button
                            key={mt}
                            type="button"
                            onClick={() => setMessageType(mt)}
                            className={clsx(
                              "rounded-lg border px-3 py-2 text-xs font-semibold",
                              messageType === mt ? "border-brand-400 bg-brand-50" : "border-ink-200",
                            )}
                          >
                            {mt === "TEMPLATE" ? t("broadcastPage.typeTemplate") : t("broadcastPage.typeText")}
                          </button>
                        ))}
                      </div>
                      {messageType === "TEMPLATE" ? (
                        <div className="sm:col-span-2">
                          <select className="input w-full" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={templatesLoading}>
                            <option value="">{templatesLoading ? t("common.loading") : t("broadcastPage.selectTemplate")}</option>
                            {visibleTemplates.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name}
                                {templateOptionStatusSuffix(tpl, t)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <textarea className="input min-h-[88px] sm:col-span-2" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("broadcastPage.body")} />
                      )}
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="btn-primary mt-4 inline-flex items-center gap-2 text-sm"
                  disabled={importBusy || selectedLeads.length === 0 || !canImportFollowUp}
                  onClick={() => void handleImport()}
                >
                  {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {t("leadFinder.importBtn").replace("{count}", String(selectedLeads.length))}
                </button>
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
