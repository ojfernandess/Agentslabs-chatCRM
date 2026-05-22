import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { X, Sparkles, Blocks, Send, Wand2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { isWhatsAppCloudApiProvider, parseInboxWhatsappFromChannelConfig } from "@/lib/inboxWhatsappConfig";
import {
  segmentHasAudience,
  OMNICHANNEL_CHANNELS,
  CHANNEL_TO_INBOX_TYPE,
  channelNeedsInbox,
  type TagOption,
  type TemplateOption,
  type InboxOption,
  type CampaignChannel,
} from "./campaignTypes";
import {
  CampaignAdvancedOptions,
  type AdvancedCampaignOptions,
  defaultAdvancedOptions,
} from "./CampaignAdvancedOptions";
import { CampaignFlowBuilder, type FlowDefinition } from "./CampaignFlowBuilder";

export type CreatorTab = "quick" | "ai" | "flow";

export interface CreatorDraft {
  name: string;
  messageType: "TEXT" | "TEMPLATE";
  body: string;
  templateId: string;
  selectedTagIds: string[];
  advanced: AdvancedCampaignOptions;
  flowDefinition: FlowDefinition | null;
}

export { defaultAdvancedOptions };

interface Props {
  open: boolean;
  onClose: () => void;
  editCampaignId?: string | null;
  tags: TagOption[];
  templates: TemplateOption[];
  templatesLoading?: boolean;
  inboxes: InboxOption[];
  integrationTools: { id: string; name: string; toolType: string }[];
  pipelineStages: { id: string; name: string }[];
  initialTab?: CreatorTab;
  initialDraft?: Partial<CreatorDraft>;
  previewCount: number | null;
  previewBusy: boolean;
  submitting: boolean;
  formError: string;
  onPreview: (tagIds: string[], segmentRules: AdvancedCampaignOptions["segmentRules"]) => void;
  onInboxChange?: (inboxId: string) => void;
  onSubmit: (draft: CreatorDraft, editId?: string | null) => void;
}

const defaultDraft: CreatorDraft = {
  name: "",
  messageType: "TEMPLATE",
  body: "",
  templateId: "",
  selectedTagIds: [],
  advanced: defaultAdvancedOptions(),
  flowDefinition: null,
};

function generateAiDraft(prompt: string): Pick<CreatorDraft, "name" | "body" | "messageType"> {
  const trimmed = prompt.trim();
  const name = trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed || "Campanha IA";
  const body = `Olá {{nome}},\n\n${trimmed}\n\nFicamos à disposição. Responda esta mensagem se quiser avançar.`;
  return { name, body, messageType: "TEXT" };
}

function firstInboxForChannel(inboxes: InboxOption[], channel: CampaignChannel): string {
  const inboxType = CHANNEL_TO_INBOX_TYPE[channel];
  if (!inboxType) return "";
  const matches = inboxes.filter((i) => i.channelType === inboxType);
  const preferred = matches.find((i) => i.isDefault) ?? matches[0];
  return preferred?.id ?? "";
}

export function CampaignCreatorPanel({
  open,
  onClose,
  editCampaignId = null,
  tags,
  templates,
  templatesLoading = false,
  inboxes,
  integrationTools,
  pipelineStages,
  initialTab = "quick",
  initialDraft,
  previewCount,
  previewBusy,
  submitting,
  formError,
  onPreview,
  onInboxChange,
  onSubmit,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<CreatorTab>(initialTab);
  const [draft, setDraft] = useState<CreatorDraft>({ ...defaultDraft, ...initialDraft });
  const [aiPrompt, setAiPrompt] = useState("");
  const wasOpenRef = useRef(false);
  const userPickedInboxRef = useRef(false);
  const lastLoadedInboxRef = useRef("");

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      userPickedInboxRef.current = false;
      lastLoadedInboxRef.current = "";
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    userPickedInboxRef.current = false;
    lastLoadedInboxRef.current = "";
    setTab(initialTab);
    const merged: CreatorDraft = { ...defaultDraft, ...initialDraft };
    if (!merged.advanced.inboxId && merged.advanced.channel) {
      merged.advanced = {
        ...merged.advanced,
        inboxId: firstInboxForChannel(inboxes, merged.advanced.channel),
      };
    }
    setDraft(merged);
    setAiPrompt("");
  }, [open, initialTab, initialDraft, inboxes]);

  useEffect(() => {
    if (!open || userPickedInboxRef.current) return;
    setDraft((d) => {
      if (d.advanced.inboxId) return d;
      const inboxId = firstInboxForChannel(inboxes, d.advanced.channel);
      if (!inboxId) return d;
      return { ...d, advanced: { ...d.advanced, inboxId } };
    });
  }, [open, inboxes]);

  useEffect(() => {
    if (!open || !channelNeedsInbox(draft.advanced.channel)) return;
    const inboxId = draft.advanced.inboxId;
    if (!inboxId || inboxId === lastLoadedInboxRef.current) return;
    lastLoadedInboxRef.current = inboxId;
    onInboxChange?.(inboxId);
  }, [open, draft.advanced.inboxId, draft.advanced.channel, onInboxChange]);

  useEffect(() => {
    if (!open) return;
    onPreview(draft.selectedTagIds, draft.advanced.segmentRules);
  }, [open, draft.selectedTagIds.join(","), JSON.stringify(draft.advanced.segmentRules), onPreview]);

  const channelInboxes = useMemo(() => {
    const inboxType = CHANNEL_TO_INBOX_TYPE[draft.advanced.channel];
    if (!inboxType) return [];
    return inboxes.filter((i) => i.channelType === inboxType);
  }, [inboxes, draft.advanced.channel]);

  const selectedInbox = inboxes.find((i) => i.id === draft.advanced.inboxId);
  const selectedWaProvider = selectedInbox
    ? parseInboxWhatsappFromChannelConfig(selectedInbox.channelConfig).whatsappProvider
    : null;
  const isMetaWhatsapp =
    draft.advanced.channel === "whatsapp" &&
    selectedInbox?.channelType === "WHATSAPP" &&
    isWhatsAppCloudApiProvider(selectedWaProvider ?? "");

  const visibleTemplates = useMemo(() => {
    if (draft.messageType !== "TEMPLATE") return templates;
    if (!isMetaWhatsapp) return templates;
    return templates.filter((tpl) => Boolean(tpl.providerTemplateId?.trim()));
  }, [templates, draft.messageType, isMetaWhatsapp]);

  const patchAdvanced = (partial: Partial<AdvancedCampaignOptions>) => {
    setDraft((d) => ({ ...d, advanced: { ...d.advanced, ...partial } }));
  };

  const setChannel = (channel: CampaignChannel) => {
    userPickedInboxRef.current = false;
    lastLoadedInboxRef.current = "";
    const inboxId = firstInboxForChannel(inboxes, channel);
    setDraft((d) => ({
      ...d,
      templateId: "",
      messageType: channel === "email" ? "TEXT" : d.messageType,
      advanced: { ...d.advanced, channel, inboxId },
    }));
  };

  const setInboxId = (inboxId: string) => {
    userPickedInboxRef.current = true;
    lastLoadedInboxRef.current = "";
    patchAdvanced({ inboxId });
    setDraft((d) => ({ ...d, templateId: "" }));
  };

  if (!open) return null;

  const toggleTag = (id: string) => {
    setDraft((d) => ({
      ...d,
      selectedTagIds: d.selectedTagIds.includes(id)
        ? d.selectedTagIds.filter((x) => x !== id)
        : [...d.selectedTagIds, id],
    }));
  };

  const handleAiGenerate = () => {
    setDraft((d) => ({ ...d, ...generateAiDraft(aiPrompt) }));
    setTab("quick");
  };

  const needsInbox = channelNeedsInbox(draft.advanced.channel);
  const inboxOk = !needsInbox || Boolean(draft.advanced.inboxId);

  const canSubmit =
    Boolean(draft.name.trim()) &&
    segmentHasAudience(draft.selectedTagIds, draft.advanced.segmentRules) &&
    inboxOk &&
    (draft.advanced.channel === "email"
      ? Boolean(draft.body.trim() || draft.advanced.subject.trim())
      : draft.messageType === "TEXT"
        ? Boolean(draft.body.trim())
        : Boolean(draft.templateId));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0" aria-label={t("common.close")} onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-ink-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#0f1728]">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">
              {editCampaignId ? t("broadcastPage.editCampaignTitle") : t("broadcastPage.creatorTitle")}
            </h2>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {editCampaignId ? t("broadcastPage.editCampaignSubtitle") : t("broadcastPage.creatorSubtitle")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-ink-50 dark:hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-ink-100 px-4 dark:border-white/10">
          {(
            [
              { id: "quick" as const, label: t("broadcastPage.tabQuick"), icon: Send },
              { id: "ai" as const, label: t("broadcastPage.tabAi"), icon: Sparkles },
              { id: "flow" as const, label: t("broadcastPage.tabFlow"), icon: Blocks },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={clsx(
                "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors",
                tab === id
                  ? "border-brand-500 text-brand-700 dark:text-brand-300"
                  : "border-transparent text-ink-500 hover:text-ink-700",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "quick" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                  {t("broadcastPage.creatorChannel")}
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {OMNICHANNEL_CHANNELS.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      disabled={!ch.available}
                      onClick={() => ch.available && setChannel(ch.id)}
                      className={clsx(
                        "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                        draft.advanced.channel === ch.id
                          ? "bg-brand-500 text-white"
                          : ch.available
                            ? "border border-ink-200 text-ink-600 hover:border-brand-300 dark:border-white/10 dark:text-ink-300"
                            : "border border-ink-100 text-ink-400 opacity-50",
                      )}
                    >
                      {t(ch.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {needsInbox ? (
                <div>
                  <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                    {t("broadcastPage.creatorInbox")}
                  </label>
                  {channelInboxes.length === 0 ? (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t("broadcastPage.noInboxForChannel")}</p>
                  ) : (
                    <select
                      value={draft.advanced.inboxId}
                      onChange={(e) => setInboxId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
                    >
                      <option value="">{t("broadcastPage.selectInbox")}</option>
                      {channelInboxes.map((inbox) => (
                        <option key={inbox.id} value={inbox.id}>
                          {inbox.name}
                          {inbox.isDefault ? ` (${t("broadcastPage.inboxDefault")})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.name")}</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
                  maxLength={200}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                    {t("broadcastPage.messageType")}
                  </label>
                  <select
                    value={draft.messageType}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        messageType: e.target.value as "TEXT" | "TEMPLATE",
                        templateId: e.target.value === "TEMPLATE" ? d.templateId : "",
                      }))
                    }
                    disabled={draft.advanced.channel === "email"}
                    className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5 disabled:opacity-60"
                  >
                    <option value="TEMPLATE">{t("broadcastPage.typeTemplate")}</option>
                    <option value="TEXT">{t("broadcastPage.typeText")}</option>
                  </select>
                </div>
                <div>
                  {draft.messageType === "TEMPLATE" && draft.advanced.channel !== "email" ? (
                    <>
                      <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                        {t("broadcastPage.template")}
                      </label>
                      <select
                        value={draft.templateId}
                        onChange={(e) => setDraft((d) => ({ ...d, templateId: e.target.value }))}
                        disabled={templatesLoading || !inboxOk}
                        className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5 disabled:opacity-60"
                      >
                        <option value="">
                          {templatesLoading ? t("common.loading") : t("broadcastPage.selectTemplate")}
                        </option>
                        {visibleTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </option>
                        ))}
                      </select>
                      {isMetaWhatsapp ? (
                        <p className="mt-1 text-[11px] text-ink-500">{t("broadcastPage.metaTemplatesHint")}</p>
                      ) : (
                        <p className="mt-1 text-[11px] text-ink-500">{t("broadcastPage.templatesCampaignHint")}</p>
                      )}
                      {isMetaWhatsapp && !templatesLoading && visibleTemplates.length === 0 && inboxOk ? (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          {t("broadcastPage.noMetaTemplates")}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.body")}</label>
                      <textarea
                        value={draft.body}
                        onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                        rows={4}
                        className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
                        maxLength={4096}
                        placeholder={t("broadcastPage.dynamicVarsHint")}
                      />
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.tags")}</label>
                <p className="mt-0.5 text-[11px] text-ink-500">{t("broadcastPage.tagsHint")}</p>
                <p className="mt-0.5 text-[11px] text-brand-600 dark:text-brand-300">{t("broadcastPage.segmentationHint")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const on = draft.selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={clsx(
                          "rounded-full border px-3 py-1 text-xs font-medium",
                          on
                            ? "border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-950/40"
                            : "border-ink-200 text-ink-600 dark:border-white/10",
                        )}
                        style={on ? { borderColor: tag.color } : undefined}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">
                  {previewBusy
                    ? t("broadcastPage.previewLoading")
                    : previewCount !== null
                      ? t("broadcastPage.audiencePreview").replace("{count}", String(previewCount))
                      : t("broadcastPage.audienceEmpty")}
                </p>
              </div>
              <CampaignAdvancedOptions
                value={draft.advanced}
                onChange={(advanced) => setDraft((d) => ({ ...d, advanced }))}
                integrationTools={integrationTools}
                pipelineStages={pipelineStages}
              />
            </div>
          ) : null}

          {tab === "ai" ? (
            <div className="space-y-4">
              <p className="text-sm text-ink-600 dark:text-ink-400">{t("broadcastPage.aiGeneratorHint")}</p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={5}
                placeholder={t("broadcastPage.aiGeneratorPlaceholder")}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
              />
              <button
                type="button"
                onClick={handleAiGenerate}
                disabled={!aiPrompt.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <Wand2 className="h-4 w-4" />
                {t("broadcastPage.aiGenerate")}
              </button>
              <p className="text-[11px] text-ink-500">{t("broadcastPage.aiGeneratorFootnote")}</p>
            </div>
          ) : null}

          {tab === "flow" ? (
            <CampaignFlowBuilder
              value={draft.flowDefinition}
              onChange={(flowDefinition) => setDraft((d) => ({ ...d, flowDefinition }))}
            />
          ) : null}
        </div>

        {tab === "quick" || tab === "flow" ? (
          <div className="border-t border-ink-100 p-4 dark:border-white/10">
            {formError ? (
              <p className="mb-3 text-sm text-red-600 dark:text-red-400" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={submitting || !canSubmit}
                onClick={() => onSubmit(draft, editCampaignId)}
                className="btn-primary flex-1"
              >
                {submitting
                  ? t("common.saving")
                  : editCampaignId
                    ? t("broadcastPage.saveChanges")
                    : t("broadcastPage.saveDraft")}
              </button>
              <button type="button" className="btn-secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
