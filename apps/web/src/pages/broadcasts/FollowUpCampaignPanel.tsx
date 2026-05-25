import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Bot, CalendarClock, Headset, Loader2, Plus, Repeat, Send, Tags } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, ApiError } from "@/lib/api";
import {
  filterTemplatesForWhatsappInbox,
  isEvolutionWhatsappProvider,
  templateOptionStatusSuffix,
  whatsappProviderForInbox,
} from "@/lib/campaignTemplates";
import { parseInboxWhatsappFromChannelConfig } from "@/lib/inboxWhatsappConfig";
import {
  buildCronFromRecurrence,
  browserTimeZone,
  defaultRecurrenceTimeLocal,
  type FollowUpRecurrence,
  type FollowUpRecurrenceFrequency,
} from "@/lib/broadcastRecurrence";
import type { InboxOption, TagOption, TemplateOption } from "./campaignTypes";
import { segmentRulesWithKind } from "./campaignKind";
import type {
  FollowUpAfterSendMode,
  FollowUpEditInitial,
  FollowUpScheduleMode,
  FollowUpTagLogic,
} from "./campaignDraftMapper";

export type { FollowUpAfterSendMode, FollowUpScheduleMode, FollowUpTagLogic };

export interface FollowUpDraft {
  name: string;
  selectedTagIds: string[];
  tagLogic: FollowUpTagLogic;
  inboxId: string;
  messageType: "TEXT" | "TEMPLATE";
  body: string;
  templateId: string;
  scheduleMode: FollowUpScheduleMode;
  scheduledAt: string;
}

export interface FollowUpSubmitPayload {
  editCampaignId?: string;
  name: string;
  tagIds: string[];
  segmentRules: {
    tagLogic: FollowUpTagLogic;
    followUpRecurrence?: FollowUpRecurrence;
    followUpAfterSend?: FollowUpAfterSendMode;
    campaignKind?: "followup";
  };
  inboxId: string;
  messageType: "TEXT" | "TEMPLATE";
  body?: string;
  templateId?: string;
  scheduleType: "IMMEDIATE" | "SCHEDULED" | "RECURRING";
  scheduledAt?: string;
  cronExpression?: string;
  autoStart: boolean;
}

interface Props {
  tags: TagOption[];
  inboxes: InboxOption[];
  templates: TemplateOption[];
  templatesLoading?: boolean;
  previewCount: number | null;
  previewBusy: boolean;
  submitting: boolean;
  formError: string;
  successMessage: string;
  editInitial?: FollowUpEditInitial | null;
  onCancelEdit?: () => void;
  onPreview: (tagIds: string[], tagLogic: FollowUpTagLogic) => void;
  onInboxChange: (inboxId: string) => void;
  onSubmit: (payload: FollowUpSubmitPayload) => void;
  onTemplatesRefresh: (inboxId: string) => void;
}

function defaultScheduledLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function FollowUpCampaignPanel({
  tags,
  inboxes,
  templates,
  templatesLoading = false,
  previewCount,
  previewBusy,
  submitting,
  formError,
  successMessage,
  editInitial,
  onCancelEdit,
  onPreview,
  onInboxChange,
  onSubmit,
  onTemplatesRefresh,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagLogic, setTagLogic] = useState<FollowUpTagLogic>("ANY");
  const [inboxId, setInboxId] = useState("");
  const [messageType, setMessageType] = useState<"TEXT" | "TEMPLATE">("TEMPLATE");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [scheduleMode, setScheduleMode] = useState<FollowUpScheduleMode>("now");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledLocal);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<FollowUpRecurrenceFrequency>("monthly");
  const [recurrenceTime, setRecurrenceTime] = useState(defaultRecurrenceTimeLocal);
  const [recurrenceDayOfWeek, setRecurrenceDayOfWeek] = useState(1);
  const [recurrenceDayOfMonth, setRecurrenceDayOfMonth] = useState(1);
  const [followUpAfterSend, setFollowUpAfterSend] = useState<FollowUpAfterSendMode>("human_handoff");
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  const [newTplBody, setNewTplBody] = useState("");
  const [creatingTpl, setCreatingTpl] = useState(false);
  const [createTplError, setCreateTplError] = useState("");

  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(() => {
    if (selectedTagIds.length === 0) {
      onPreviewRef.current([], tagLogic);
      return;
    }
    const h = window.setTimeout(() => {
      onPreviewRef.current(selectedTagIds, tagLogic);
    }, 400);
    return () => window.clearTimeout(h);
  }, [selectedTagIds.join(","), tagLogic]);

  const waInboxes = useMemo(
    () => inboxes.filter((i) => i.channelType === "WHATSAPP"),
    [inboxes],
  );

  const selectedInbox = useMemo(
    () => waInboxes.find((i) => i.id === inboxId),
    [waInboxes, inboxId],
  );

  const selectedWaProvider = whatsappProviderForInbox(selectedInbox);

  const visibleTemplates = useMemo(
    () =>
      filterTemplatesForWhatsappInbox(templates, selectedInbox, {
        allowVariableTemplates: isEvolutionWhatsappProvider(selectedWaProvider),
      }),
    [templates, selectedInbox, selectedWaProvider],
  );

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const suggestedName = useMemo(() => {
    if (name.trim()) return name.trim();
    const tagNames = selectedTagIds
      .map((id) => tags.find((x) => x.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    if (!tagNames) return "";
    return t("broadcastPage.followUpDefaultName").replace("{tags}", tagNames);
  }, [name, selectedTagIds, tags, t]);

  const inboxRequired = waInboxes.length > 0;
  const inboxOk = inboxRequired && Boolean(inboxId);
  const audienceReady = previewCount != null && previewCount > 0;
  const canSubmit =
    selectedTagIds.length > 0 &&
    audienceReady &&
    inboxOk &&
    (messageType === "TEXT" ? body.trim().length > 0 : Boolean(templateId)) &&
    (scheduleMode !== "scheduled" || Boolean(scheduledAt)) &&
    (scheduleMode !== "recurring" || Boolean(recurrenceTime));

  const applyEditInitial = useCallback((data: FollowUpEditInitial) => {
    setName(data.name);
    setSelectedTagIds(data.selectedTagIds);
    setTagLogic(data.tagLogic);
    setInboxId(data.inboxId);
    setMessageType(data.messageType);
    setBody(data.body);
    setTemplateId(data.templateId);
    setScheduleMode(data.scheduleMode);
    setScheduledAt(data.scheduledAt);
    setRecurrenceFrequency(data.recurrenceFrequency);
    setRecurrenceTime(data.recurrenceTime);
    setRecurrenceDayOfWeek(data.recurrenceDayOfWeek);
    setRecurrenceDayOfMonth(data.recurrenceDayOfMonth);
    setFollowUpAfterSend(data.followUpAfterSend);
    if (data.inboxId) onInboxChange(data.inboxId);
  }, [onInboxChange]);

  useEffect(() => {
    if (editInitial) applyEditInitial(editInitial);
  }, [editInitial, applyEditInitial]);

  const handleCreateTemplate = async () => {
    const n = newTplName.trim();
    const b = newTplBody.trim();
    if (!n || !b || !inboxId) return;
    setCreatingTpl(true);
    setCreateTplError("");
    try {
      const provider = selectedWaProvider ?? parseInboxWhatsappFromChannelConfig(selectedInbox?.channelConfig).whatsappProvider;
      const row = isEvolutionWhatsappProvider(provider)
        ? await api.post<TemplateOption & { id: string }>("/templates/evolution", {
            inboxId,
            name: n,
            category: "UTILITY",
            language: "pt_BR",
            body: b,
          })
        : await api.post<TemplateOption>("/templates", {
            name: n,
            body: b,
            templateLanguage: "pt_BR",
            isApproved: false,
          });
      setMessageType("TEMPLATE");
      setTemplateId(row.id);
      setShowCreateTemplate(false);
      setNewTplName("");
      setNewTplBody("");
      onTemplatesRefresh(inboxId);
    } catch (e) {
      setCreateTplError(e instanceof ApiError ? e.message : t("broadcastPage.followUpCreateTplError"));
    } finally {
      setCreatingTpl(false);
    }
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const finalName = suggestedName || t("broadcastPage.followUpUntitled");
    const [hStr, mStr] = recurrenceTime.split(":");
    const hour = Number(hStr);
    const minute = Number(mStr);

    let scheduleType: FollowUpSubmitPayload["scheduleType"] = "IMMEDIATE";
    let scheduledAtIso: string | undefined;
    let cronExpression: string | undefined;
    let segmentRules: FollowUpSubmitPayload["segmentRules"] = segmentRulesWithKind(
      { tagLogic, followUpAfterSend },
      "followup",
    ) as FollowUpSubmitPayload["segmentRules"];

    if (scheduleMode === "scheduled" && scheduledAt) {
      scheduleType = "SCHEDULED";
      scheduledAtIso = new Date(scheduledAt).toISOString();
    } else if (scheduleMode === "recurring") {
      scheduleType = "RECURRING";
      const followUpRecurrence: FollowUpRecurrence = {
        frequency: recurrenceFrequency,
        hour: Number.isFinite(hour) ? hour : 9,
        minute: Number.isFinite(minute) ? minute : 0,
        timeZone: browserTimeZone(),
        ...(recurrenceFrequency === "weekly" ? { dayOfWeek: recurrenceDayOfWeek } : {}),
        ...(recurrenceFrequency === "monthly" ? { dayOfMonth: recurrenceDayOfMonth } : {}),
      };
      segmentRules = segmentRulesWithKind(
        { tagLogic, followUpRecurrence, followUpAfterSend },
        "followup",
      ) as FollowUpSubmitPayload["segmentRules"];
      cronExpression = buildCronFromRecurrence(followUpRecurrence);
    }

    onSubmit({
      editCampaignId: editInitial?.campaignId,
      name: finalName,
      tagIds: selectedTagIds,
      segmentRules,
      inboxId,
      messageType,
      body: messageType === "TEXT" ? body.trim() : undefined,
      templateId: messageType === "TEMPLATE" ? templateId : undefined,
      scheduleType,
      scheduledAt: scheduledAtIso,
      cronExpression,
      autoStart: !editInitial?.campaignId && scheduleMode === "now",
    });
  };

  const resetForm = useCallback(() => {
    setName("");
    setSelectedTagIds([]);
    setTagLogic("ANY");
    setBody("");
    setTemplateId("");
    setScheduleMode("now");
    setScheduledAt(defaultScheduledLocal());
    setRecurrenceFrequency("monthly");
    setRecurrenceTime(defaultRecurrenceTimeLocal());
    setRecurrenceDayOfWeek(1);
    setRecurrenceDayOfMonth(1);
    setFollowUpAfterSend("human_handoff");
    setShowCreateTemplate(false);
  }, []);

  const weekdayOptions = useMemo(
    () =>
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        value: d,
        label: t(`broadcastPage.followUpWeekday${d}` as "broadcastPage.followUpWeekday0"),
      })),
    [t],
  );

  useEffect(() => {
    if (successMessage) resetForm();
  }, [successMessage, resetForm]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50/80 to-white/90 p-5 dark:border-brand-800/40 dark:from-brand-950/25 dark:to-[#111C2B]/55">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900 dark:text-ink-50">
          <Tags className="h-5 w-5 text-brand-600" />
          {t("broadcastPage.followUpTitle")}
        </h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{t("broadcastPage.followUpSubtitle")}</p>
        {editInitial ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-900 dark:bg-violet-950/50 dark:text-violet-200">
              {t("broadcastPage.editingDraft")}
            </span>
            {onCancelEdit ? (
              <button type="button" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={onCancelEdit}>
                {t("broadcastPage.cancelEdit")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {successMessage ? (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      {formError ? (
        <p className="text-sm text-red-600" role="alert">
          {formError}
        </p>
      ) : null}

      <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
        <label className="text-xs font-bold uppercase tracking-wider text-ink-500">{t("broadcastPage.name")}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestedName || t("broadcastPage.followUpNamePlaceholder")}
          className="input mt-2 w-full"
          maxLength={200}
        />
      </section>

      <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.tags")}</h3>
            <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.followUpTagsHint")}</p>
          </div>
          <div className="flex rounded-lg border border-ink-200 p-0.5 dark:border-white/10">
            {(["ANY", "ALL"] as const).map((logic) => (
              <button
                key={logic}
                type="button"
                onClick={() => setTagLogic(logic)}
                className={clsx(
                  "rounded-md px-3 py-1 text-xs font-semibold",
                  tagLogic === logic
                    ? "bg-brand-500 text-white"
                    : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-white/5",
                )}
              >
                {logic === "ANY" ? t("broadcastPage.followUpTagAny") : t("broadcastPage.followUpTagAll")}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <p className="text-sm text-ink-500">{t("broadcastPage.followUpNoTags")}</p>
          ) : (
            tags.map((tag) => {
              const on = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    on
                      ? "border-brand-400 bg-brand-100 text-brand-900 dark:border-brand-600 dark:bg-brand-950/50 dark:text-brand-100"
                      : "border-ink-200 bg-ink-50 text-ink-700 hover:border-brand-300 dark:border-white/10 dark:bg-white/5 dark:text-ink-200",
                  )}
                >
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                    aria-hidden
                  />
                  {tag.name}
                </button>
              );
            })
          )}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          {previewBusy
            ? t("broadcastPage.previewLoading")
            : previewCount != null && selectedTagIds.length > 0
              ? t("broadcastPage.audiencePreview").replace("{count}", String(previewCount))
              : t("broadcastPage.audienceEmpty")}
        </p>
      </section>

      <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.followUpScheduleTitle")}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => setScheduleMode("now")}
            className={clsx(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              scheduleMode === "now"
                ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40"
                : "border-ink-200 hover:border-ink-300 dark:border-white/10",
            )}
          >
            <Send className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <span className="text-sm font-bold text-ink-900 dark:text-ink-50">
                {t("broadcastPage.followUpSendNow")}
              </span>
              <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.followUpSendNowHint")}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("scheduled")}
            className={clsx(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              scheduleMode === "scheduled"
                ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40"
                : "border-ink-200 hover:border-ink-300 dark:border-white/10",
            )}
          >
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <span className="text-sm font-bold text-ink-900 dark:text-ink-50">
                {t("broadcastPage.followUpScheduleLater")}
              </span>
              <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.followUpScheduleLaterHint")}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("recurring")}
            className={clsx(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              scheduleMode === "recurring"
                ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40"
                : "border-ink-200 hover:border-ink-300 dark:border-white/10",
            )}
          >
            <Repeat className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <span className="text-sm font-bold text-ink-900 dark:text-ink-50">
                {t("broadcastPage.followUpRecurring")}
              </span>
              <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.followUpRecurringHint")}</p>
            </div>
          </button>
        </div>
        {scheduleMode === "scheduled" ? (
          <div className="mt-4">
            <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
              {t("broadcastPage.followUpDateTime")}
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="input mt-1 w-full max-w-sm"
            />
          </div>
        ) : null}
        {scheduleMode === "recurring" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                {t("broadcastPage.followUpRecurrenceFreq")}
              </label>
              <select
                className="input mt-1 w-full"
                value={recurrenceFrequency}
                onChange={(e) => setRecurrenceFrequency(e.target.value as FollowUpRecurrenceFrequency)}
              >
                <option value="daily">{t("broadcastPage.followUpRecurrenceDaily")}</option>
                <option value="weekly">{t("broadcastPage.followUpRecurrenceWeekly")}</option>
                <option value="monthly">{t("broadcastPage.followUpRecurrenceMonthly")}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                {t("broadcastPage.followUpRecurrenceTime")}
              </label>
              <input
                type="time"
                value={recurrenceTime}
                onChange={(e) => setRecurrenceTime(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
            {recurrenceFrequency === "weekly" ? (
              <div>
                <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                  {t("broadcastPage.followUpRecurrenceWeekday")}
                </label>
                <select
                  className="input mt-1 w-full"
                  value={recurrenceDayOfWeek}
                  onChange={(e) => setRecurrenceDayOfWeek(Number(e.target.value))}
                >
                  {weekdayOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {recurrenceFrequency === "monthly" ? (
              <div>
                <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                  {t("broadcastPage.followUpRecurrenceMonthDay")}
                </label>
                <select
                  className="input mt-1 w-full"
                  value={recurrenceDayOfMonth}
                  onChange={(e) => setRecurrenceDayOfMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {t("broadcastPage.followUpRecurrenceDayN").replace("{day}", String(d))}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <p className="sm:col-span-2 text-xs text-ink-500">{t("broadcastPage.followUpRecurringNote")}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{t("broadcastPage.followUpAfterSendTitle")}</h3>
        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{t("broadcastPage.followUpAfterSendHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setFollowUpAfterSend("human_handoff")}
            className={clsx(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              followUpAfterSend === "human_handoff"
                ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40"
                : "border-ink-200 hover:border-ink-300 dark:border-white/10",
            )}
          >
            <Headset className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <span className="text-sm font-bold text-ink-900 dark:text-ink-50">
                {t("broadcastPage.followUpAfterSendHuman")}
              </span>
              <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.followUpAfterSendHumanHint")}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setFollowUpAfterSend("bot")}
            className={clsx(
              "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              followUpAfterSend === "bot"
                ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40"
                : "border-ink-200 hover:border-ink-300 dark:border-white/10",
            )}
          >
            <Bot className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div>
              <span className="text-sm font-bold text-ink-900 dark:text-ink-50">
                {t("broadcastPage.followUpAfterSendBot")}
              </span>
              <p className="mt-0.5 text-xs text-ink-500">{t("broadcastPage.followUpAfterSendBotHint")}</p>
            </div>
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-ink-200/80 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-[#111C2B]/55">
        <label className="text-xs font-bold uppercase tracking-wider text-ink-500">{t("broadcastPage.creatorInbox")}</label>
        <select
          className="input mt-2 w-full max-w-md"
          value={inboxId}
          required
          onChange={(e) => {
            setInboxId(e.target.value);
            setTemplateId("");
            onInboxChange(e.target.value);
          }}
        >
          <option value="">{t("broadcastPage.selectInbox")}</option>
          {waInboxes.length === 0 ? (
            <option value="" disabled>
              {t("broadcastPage.noInboxForChannel")}
            </option>
          ) : (
            waInboxes.map((inbox) => (
              <option key={inbox.id} value={inbox.id}>
                {inbox.name}
                {inbox.isDefault ? ` (${t("broadcastPage.inboxDefault")})` : ""}
              </option>
            ))
          )}
        </select>
        {!inboxOk ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" role="alert">
            {waInboxes.length === 0 ? t("broadcastPage.followUpInboxMissing") : t("broadcastPage.followUpInboxRequired")}
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          {(["TEMPLATE", "TEXT"] as const).map((mt) => (
            <button
              key={mt}
              type="button"
              onClick={() => setMessageType(mt)}
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs font-semibold",
                messageType === mt
                  ? "border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-600 dark:bg-brand-950/40 dark:text-brand-100"
                  : "border-ink-200 text-ink-600 dark:border-white/10",
              )}
            >
              {mt === "TEMPLATE" ? t("broadcastPage.typeTemplate") : t("broadcastPage.typeText")}
            </button>
          ))}
        </div>

        {messageType === "TEMPLATE" ? (
          <div className="mt-3 space-y-3">
            <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">{t("broadcastPage.template")}</label>
            <select
              className="input w-full max-w-lg"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={templatesLoading}
            >
              <option value="">{templatesLoading ? t("common.loading") : t("broadcastPage.selectTemplate")}</option>
              {visibleTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {templateOptionStatusSuffix(tpl, t)}
                  {(tpl.bodyVariableCount ?? 0) > 0
                    ? ` · ${t("broadcastPage.followUpTplHasVars").replace("{n}", String(tpl.bodyVariableCount))}`
                    : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-500">
              {isEvolutionWhatsappProvider(selectedWaProvider)
                ? t("broadcastPage.templatesEvolutionFollowUpHint")
                : t("broadcastPage.templatesCampaignHint")}
            </p>
            {!templatesLoading && inboxOk && visibleTemplates.length === 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
                {isEvolutionWhatsappProvider(selectedWaProvider)
                  ? t("broadcastPage.templatesEvolutionEmpty")
                  : t("broadcastPage.templatesMetaEmpty")}
              </p>
            ) : null}
            {!showCreateTemplate ? (
              <button
                type="button"
                onClick={() => setShowCreateTemplate(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("broadcastPage.followUpCreateTemplate")}
              </button>
            ) : (
              <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-4 dark:border-brand-800/50 dark:bg-brand-950/20">
                <p className="text-xs font-semibold text-ink-700 dark:text-ink-300">
                  {t("broadcastPage.followUpCreateTemplateTitle")}
                </p>
                <p className="mt-1 text-xs text-ink-500">{t("broadcastPage.followUpCreateTemplateHint")}</p>
                <input
                  type="text"
                  className="input mt-3 w-full"
                  placeholder={t("broadcastPage.followUpTplNamePh")}
                  value={newTplName}
                  onChange={(e) => setNewTplName(e.target.value)}
                  maxLength={100}
                />
                <textarea
                  className="input mt-2 min-h-[88px] w-full"
                  placeholder={t("broadcastPage.followUpTplBodyPh")}
                  value={newTplBody}
                  onChange={(e) => setNewTplBody(e.target.value)}
                  maxLength={4096}
                />
                {createTplError ? (
                  <p className="mt-2 text-xs text-red-600" role="alert">
                    {createTplError}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={creatingTpl || !newTplName.trim() || !newTplBody.trim()}
                    onClick={() => void handleCreateTemplate()}
                    className="btn-primary text-xs"
                  >
                    {creatingTpl ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null}
                    {t("broadcastPage.followUpSaveTemplate")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setShowCreateTemplate(false);
                      setCreateTplError("");
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <textarea
            className="input mt-3 min-h-[100px] w-full"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("broadcastPage.body")}
          />
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {editInitial
            ? t("broadcastPage.saveChanges")
            : scheduleMode === "now"
              ? t("broadcastPage.followUpLaunch")
              : scheduleMode === "recurring"
                ? t("broadcastPage.followUpRecurringBtn")
                : t("broadcastPage.followUpScheduleBtn")}
        </button>
      </div>
    </div>
  );
}
