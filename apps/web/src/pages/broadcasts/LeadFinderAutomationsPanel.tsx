import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarClock, Loader2, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, ApiError } from "@/lib/api";
import { browserTimeZone } from "@/lib/broadcastRecurrence";
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
import type { LeadFinderSegmentRow } from "./LeadFinderPanel";

interface LeadFinderScheduleRow {
  id: string;
  name: string;
  enabled: boolean;
  searchMode: string;
  niche: string | null;
  city: string | null;
  segmentId: string | null;
  scheduleType: "SCHEDULED" | "RECURRING";
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunResult: Record<string, unknown> | null;
  segment?: { id: string; name: string; niche: string; city: string } | null;
}

interface Props {
  segments: LeadFinderSegmentRow[];
  tags: TagOption[];
  leadTypes: { id: string; name: string }[];
  inboxes: InboxOption[];
  templates: TemplateOption[];
  templatesLoading?: boolean;
  onInboxChange: (inboxId: string) => void;
  onSegmentsChange: () => void;
}

export function LeadFinderAutomationsPanel({
  segments,
  tags,
  leadTypes,
  inboxes,
  templates,
  templatesLoading = false,
  onInboxChange,
  onSegmentsChange,
}: Props) {
  const { t } = useI18n();
  const [schedules, setSchedules] = useState<LeadFinderScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [name, setName] = useState("");
  const [searchMode, setSearchMode] = useState<"custom" | "segment">("segment");
  const [segmentId, setSegmentId] = useState("");
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("São Paulo, SP");
  const [importTagIds, setImportTagIds] = useState<string[]>([]);
  const [leadTypeId, setLeadTypeId] = useState("");
  const [createImportTag, setCreateImportTag] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [searchSchedule, setSearchSchedule] = useState<FollowUpScheduleState>(() => ({
    ...defaultFollowUpScheduleState(),
    scheduleMode: "scheduled",
  }));
  const [createFollowUp, setCreateFollowUp] = useState(true);
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

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ schedules: LeadFinderScheduleRow[] }>("/lead-finder/schedules");
      setSchedules(data.schedules ?? []);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    if (segments.length > 0 && !segmentId) setSegmentId(segments[0].id);
  }, [segments, segmentId]);

  const patchSearchSchedule = (patch: Partial<FollowUpScheduleState>) =>
    setSearchSchedule((prev) => ({ ...prev, ...patch }));
  const patchFollowUpSchedule = (patch: Partial<FollowUpScheduleState>) =>
    setFollowUpSchedule((prev) => ({ ...prev, ...patch }));

  const toggleTag = (id: string) => {
    setImportTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const buildSearchPayload = () => {
    const sched = buildFollowUpSchedulePayload(searchSchedule);
    const scheduleType = sched.scheduleType === "IMMEDIATE" ? "SCHEDULED" : sched.scheduleType;
    return {
      scheduleType: scheduleType as "SCHEDULED" | "RECURRING",
      scheduledAt: sched.scheduledAt,
      recurrence: sched.segmentRules?.followUpRecurrence,
      cronExpression: sched.cronExpression,
      timeZone: browserTimeZone(),
    };
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    if (searchMode === "segment" && !segmentId) return;
    if (searchMode === "custom" && !niche.trim() && !city.trim()) return;
    if (createFollowUp && !inboxId) return;
    if (createFollowUp && messageType === "TEXT" && !body.trim()) return;
    if (createFollowUp && messageType === "TEMPLATE" && !templateId) return;

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const searchPayload = buildSearchPayload();
      const followUpPayload = createFollowUp
        ? {
            ...buildFollowUpSchedulePayload(followUpSchedule),
            inboxId,
            messageType,
            body: messageType === "TEXT" ? body.trim() : undefined,
            templateId: messageType === "TEMPLATE" ? templateId : undefined,
            name: `Follow-up: ${name.trim()}`.slice(0, 200),
          }
        : null;

      await api.post("/lead-finder/schedules", {
        name: name.trim(),
        searchMode,
        segmentId: searchMode === "segment" ? segmentId : undefined,
        niche: searchMode === "custom" ? niche.trim() : undefined,
        city: searchMode === "custom" ? city.trim() : undefined,
        importConfig: {
          tagIds: importTagIds,
          leadTypeId: leadTypeId || null,
          createImportTag,
          updateExisting,
          importTagName: name.trim().slice(0, 100),
        },
        ...searchPayload,
        followUpConfig: followUpPayload,
      });
      setSuccess(t("leadFinder.autoCreateSuccess"));
      setShowForm(false);
      setName("");
      void loadSchedules();
      void onSegmentsChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("leadFinder.autoCreateError"));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (row: LeadFinderScheduleRow) => {
    try {
      await api.patch(`/lead-finder/schedules/${row.id}`, { enabled: !row.enabled });
      void loadSchedules();
    } catch {
      /* ignore */
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!window.confirm(t("leadFinder.autoDeleteConfirm"))) return;
    try {
      await api.delete(`/lead-finder/schedules/${id}`);
      void loadSchedules();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900 dark:text-ink-50">
            <CalendarClock className="h-5 w-5 text-brand-600" />
            {t("leadFinder.autoTitle")}
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("leadFinder.autoSubtitle")}</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4" />
          {t("leadFinder.autoNewBtn")}
        </button>
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

      {showForm ? (
        <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
          <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("leadFinder.autoFormTitle")}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-ink-600">{t("leadFinder.autoNameLabel")}</label>
              <input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("leadFinder.autoNamePlaceholder")} />
            </div>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              {(["segment", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSearchMode(mode)}
                  className={clsx(
                    "rounded-lg border px-3 py-2 text-xs font-semibold",
                    searchMode === mode ? "border-brand-400 bg-brand-50" : "border-ink-200",
                  )}
                >
                  {mode === "segment" ? t("leadFinder.modeSegment") : t("leadFinder.modeCustom")}
                </button>
              ))}
            </div>
            {searchMode === "segment" ? (
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-ink-600">{t("leadFinder.segmentLabel")}</label>
                <select className="input mt-1 w-full" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.niche} — {s.city})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs font-semibold text-ink-600">{t("leadFinder.nicheLabel")}</label>
                  <input className="input mt-1 w-full" value={niche} onChange={(e) => setNiche(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-600">{t("leadFinder.cityLabel")}</label>
                  <input className="input mt-1 w-full" value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <div className="mt-6 border-t border-ink-100 pt-5 dark:border-white/10">
            <FollowUpScheduleFields
              state={searchSchedule}
              onChange={patchSearchSchedule}
              title={t("leadFinder.autoSearchWhenTitle")}
              showNow={false}
            />
          </div>

          <div className="mt-6 border-t border-ink-100 pt-5 dark:border-white/10">
            <p className="text-xs font-semibold text-ink-600">{t("leadFinder.tagsLabel")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={clsx(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    importTagIds.includes(tag.id) ? "border-brand-400 bg-brand-100" : "border-ink-200 bg-ink-50",
                  )}
                >
                  {tag.name}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-600">
              <input type="checkbox" checked={createImportTag} onChange={(e) => setCreateImportTag(e.target.checked)} />
              {t("leadFinder.createImportTag")}
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs text-ink-600">
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              {t("leadFinder.updateExisting")}
            </label>
          </div>

          <div className="mt-6 border-t border-ink-100 pt-5 dark:border-white/10">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
              <input type="checkbox" checked={createFollowUp} onChange={(e) => setCreateFollowUp(e.target.checked)} />
              {t("leadFinder.autoCreateFollowUp")}
            </label>
            {createFollowUp ? (
              <div className="mt-4 space-y-4">
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
          </div>

          <button type="button" className="btn-primary mt-6 inline-flex items-center gap-2 text-sm" disabled={busy} onClick={() => void handleCreate()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("leadFinder.autoSaveBtn")}
          </button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("leadFinder.autoListTitle")}</h3>
        {loading ? (
          <p className="mt-4 text-sm text-ink-500">{t("common.loading")}</p>
        ) : schedules.length === 0 ? (
          <p className="mt-4 text-sm text-ink-500">{t("leadFinder.autoEmpty")}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {schedules.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 p-4 dark:border-white/10">
                <div>
                  <p className="font-semibold text-ink-900 dark:text-ink-50">{row.name}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {row.searchMode === "segment" && row.segment
                      ? `${row.segment.niche} — ${row.segment.city}`
                      : `${row.niche ?? ""} — ${row.city ?? ""}`}
                  </p>
                  {row.nextRunAt ? (
                    <p className="mt-1 text-xs text-brand-700 dark:text-brand-300">
                      {t("leadFinder.autoNextRun").replace("{date}", new Date(row.nextRunAt).toLocaleString())}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="text-ink-500 hover:text-brand-700" onClick={() => void toggleEnabled(row)}>
                    {row.enabled ? <ToggleRight className="h-6 w-6 text-brand-600" /> : <ToggleLeft className="h-6 w-6" />}
                  </button>
                  <button type="button" className="text-red-600 hover:text-red-800" onClick={() => void deleteSchedule(row.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
