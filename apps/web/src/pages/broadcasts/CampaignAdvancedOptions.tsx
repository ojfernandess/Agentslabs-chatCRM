import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import type { CampaignChannel } from "./campaignTypes";
import { OMNICHANNEL_CHANNELS } from "./campaignTypes";

export interface NvoipTorpedoDtmfRule {
  digit: string;
  label?: string;
  tagId?: string;
  pipelineStageId?: string;
}

export interface SegmentRules {
  tagLogic?: "ANY" | "ALL";
  pipelineStageIds?: string[];
  lifecycleStages?: string[];
  cities?: string[];
  optedInOnly?: boolean;
  minDealValue?: number;
  noResponseSinceDays?: number;
  nvoipTorpedo?: {
    caller?: string;
    dtmfRules?: NvoipTorpedoDtmfRule[];
  };
}

export interface AbConfig {
  enabled: boolean;
  splitPercentA: number;
  variantA: { body: string };
  variantB: { body: string };
}

export interface AdvancedCampaignOptions {
  channel: CampaignChannel;
  inboxId: string;
  scheduleType: "IMMEDIATE" | "SCHEDULED" | "RECURRING" | "EVENT";
  scheduledAt: string;
  cronExpression: string;
  eventTrigger: string;
  requiresApproval: boolean;
  useDistributedQueue: boolean;
  throttleMs: number;
  revenuePerConversion: string;
  subject: string;
  integrationToolId: string;
  segmentRules: SegmentRules;
  abConfig: AbConfig;
}

interface IntegrationTool {
  id: string;
  name: string;
  toolType: string;
}

interface PipelineStage {
  id: string;
  name: string;
}

interface TagOption {
  id: string;
  name: string;
}

interface Props {
  value: AdvancedCampaignOptions;
  onChange: (v: AdvancedCampaignOptions) => void;
  integrationTools: IntegrationTool[];
  pipelineStages: PipelineStage[];
  tags?: TagOption[];
}

const CHANNEL_API: Record<CampaignChannel, string> = {
  whatsapp: "WHATSAPP",
  email: "EMAIL",
  sms: "SMS",
  telegram: "TELEGRAM",
  instagram: "INSTAGRAM",
  messenger: "MESSENGER",
  push: "PUSH",
  webhook: "WEBHOOK",
  voice: "VOICE",
};

export function CampaignAdvancedOptions({ value, onChange, integrationTools, pipelineStages, tags = [] }: Props) {
  const { t } = useI18n();

  const patch = (partial: Partial<AdvancedCampaignOptions>) => onChange({ ...value, ...partial });
  const patchSegment = (partial: Partial<SegmentRules>) =>
    onChange({ ...value, segmentRules: { ...value.segmentRules, ...partial } });
  const patchNvoip = (partial: NonNullable<SegmentRules["nvoipTorpedo"]>) =>
    patchSegment({ nvoipTorpedo: { ...value.segmentRules.nvoipTorpedo, ...partial } });
  const dtmfRules = value.segmentRules.nvoipTorpedo?.dtmfRules ?? [];

  return (
    <div className="space-y-4 border-t border-ink-100 pt-4 dark:border-white/10">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-500">{t("broadcastPage.advancedTitle")}</p>

      <div>
        <label className="text-[11px] font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.filterChannel")}</label>
        <div className="mt-1 flex flex-wrap gap-1">
          {OMNICHANNEL_CHANNELS.map((ch) => (
            <button
              key={ch.id}
              type="button"
              onClick={() => ch.available && patch({ channel: ch.id })}
              className={clsx(
                "rounded-lg px-2 py-1 text-[10px] font-semibold",
                value.channel === ch.id
                  ? "bg-brand-500 text-white"
                  : ch.available
                    ? "border border-ink-200 text-ink-600 dark:border-white/10"
                    : "border border-ink-100 text-ink-400 opacity-60",
              )}
            >
              {t(ch.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {value.channel === "email" ? (
        <div>
          <label className="text-[11px] font-medium">{t("broadcastPage.emailSubject")}</label>
          <input
            value={value.subject}
            onChange={(e) => patch({ subject: e.target.value })}
            className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
          />
        </div>
      ) : null}

      {value.channel === "voice" ? (
        <div className="space-y-3 rounded-lg border border-orange-200/60 bg-orange-50/50 p-3 dark:border-orange-900/40 dark:bg-orange-950/20">
          <p className="text-[11px] font-semibold text-orange-900 dark:text-orange-200">
            {t("broadcastPage.nvoipTorpedoTitle")}
          </p>
          <label className="block text-[11px] font-medium">
            {t("nvoip.field.defaultCaller")}
            <input
              value={value.segmentRules.nvoipTorpedo?.caller ?? ""}
              onChange={(e) => patchNvoip({ caller: e.target.value })}
              placeholder={t("broadcastPage.nvoipCallerPlaceholder")}
              className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
            />
          </label>
          <div>
            <p className="text-[11px] font-medium">{t("broadcastPage.nvoipDtmfTitle")}</p>
            <p className="text-[10px] text-slate-500 dark:text-ink-400">{t("broadcastPage.nvoipDtmfHint")}</p>
            <ul className="mt-2 space-y-2">
              {dtmfRules.map((rule, idx) => (
                <li key={idx} className="flex flex-wrap items-center gap-2">
                  <input
                    value={rule.digit}
                    onChange={(e) => {
                      const next = [...dtmfRules];
                      next[idx] = { ...rule, digit: e.target.value.replace(/\D/g, "").slice(0, 1) };
                      patchNvoip({ dtmfRules: next });
                    }}
                    className="w-12 rounded border border-ink-200 px-2 py-1 text-sm dark:border-white/10 dark:bg-white/5"
                    placeholder="1"
                  />
                  <select
                    value={rule.tagId ?? ""}
                    onChange={(e) => {
                      const next = [...dtmfRules];
                      next[idx] = { ...rule, tagId: e.target.value || undefined };
                      patchNvoip({ dtmfRules: next });
                    }}
                    className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <option value="">{t("broadcastPage.nvoipDtmfTagNone")}</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-xs text-red-600 dark:text-red-400"
                    onClick={() => patchNvoip({ dtmfRules: dtmfRules.filter((_, i) => i !== idx) })}
                  >
                    {t("common.remove")}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-2 text-xs font-medium text-brand-600 dark:text-brand-400"
              onClick={() =>
                patchNvoip({ dtmfRules: [...dtmfRules, { digit: String((dtmfRules.length % 9) + 1) }] })
              }
            >
              {t("broadcastPage.nvoipDtmfAdd")}
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <label className="text-[11px] font-medium">{t("broadcastPage.scheduleType")}</label>
        <select
          value={value.scheduleType}
          onChange={(e) => patch({ scheduleType: e.target.value as AdvancedCampaignOptions["scheduleType"] })}
          className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
        >
          <option value="IMMEDIATE">{t("broadcastPage.scheduleImmediate")}</option>
          <option value="SCHEDULED">{t("broadcastPage.scheduleScheduled")}</option>
          <option value="RECURRING">{t("broadcastPage.scheduleRecurring")}</option>
          <option value="EVENT">{t("broadcastPage.scheduleEvent")}</option>
        </select>
      </div>

      {value.scheduleType === "SCHEDULED" ? (
        <div>
          <label className="text-[11px] font-medium">{t("broadcastPage.scheduledAt")}</label>
          <input
            type="datetime-local"
            value={value.scheduledAt}
            onChange={(e) => patch({ scheduledAt: e.target.value })}
            className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
          />
        </div>
      ) : null}

      {value.scheduleType === "RECURRING" ? (
        <div>
          <label className="text-[11px] font-medium">{t("broadcastPage.cronExpression")}</label>
          <input
            value={value.cronExpression}
            onChange={(e) => patch({ cronExpression: e.target.value })}
            placeholder="0 9 * * *"
            className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
          />
        </div>
      ) : null}

      {value.scheduleType === "EVENT" ? (
        <div>
          <label className="text-[11px] font-medium">{t("broadcastPage.eventTrigger")}</label>
          <select
            value={value.eventTrigger}
            onChange={(e) => patch({ eventTrigger: e.target.value })}
            className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
          >
            <option value="">{t("broadcastPage.selectTemplate")}</option>
            <option value="NEW_LEAD">NEW_LEAD</option>
            <option value="LEAD_IDLE">LEAD_IDLE</option>
            <option value="DEAL_STAGE_CHANGED">DEAL_STAGE_CHANGED</option>
            <option value="DEAL_WON">DEAL_WON</option>
            <option value="TAG_ADDED">TAG_ADDED</option>
          </select>
        </div>
      ) : null}

      <div className="rounded-xl border border-ink-200/80 p-3 dark:border-white/10">
        <p className="text-[11px] font-semibold text-ink-700 dark:text-ink-200">{t("broadcastPage.segmentationTitle")}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={value.segmentRules.optedInOnly ?? false}
              onChange={(e) =>
                patch({ segmentRules: { ...value.segmentRules, optedInOnly: e.target.checked } })
              }
            />
            {t("broadcastPage.segmentOptedIn")}
          </label>
          <div>
            <label className="text-[10px] text-ink-500">{t("broadcastPage.segmentCity")}</label>
            <input
              value={(value.segmentRules.cities ?? []).join(", ")}
              onChange={(e) =>
                patch({
                  segmentRules: {
                    ...value.segmentRules,
                    cities: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                  },
                })
              }
              placeholder="São Paulo, Lisboa"
              className="mt-0.5 w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5"
            />
          </div>
          <div>
            <label className="text-[10px] text-ink-500">{t("broadcastPage.segmentPipeline")}</label>
            <select
              multiple
              value={value.segmentRules.pipelineStageIds ?? []}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                patch({ segmentRules: { ...value.segmentRules, pipelineStageIds: selected } });
              }}
              className="mt-0.5 h-16 w-full rounded border border-ink-200 text-xs dark:border-white/10 dark:bg-white/5"
            >
              {pipelineStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-ink-500">{t("broadcastPage.segmentNoResponse")}</label>
            <input
              type="number"
              min={0}
              value={value.segmentRules.noResponseSinceDays ?? ""}
              onChange={(e) =>
                patch({
                  segmentRules: {
                    ...value.segmentRules,
                    noResponseSinceDays: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
              className="mt-0.5 w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-violet-200/80 bg-violet-50/30 p-3 dark:border-violet-900/40 dark:bg-violet-950/20">
        <label className="flex items-center gap-2 text-xs font-semibold text-violet-900 dark:text-violet-200">
          <input
            type="checkbox"
            checked={value.abConfig.enabled}
            onChange={(e) => patch({ abConfig: { ...value.abConfig, enabled: e.target.checked } })}
          />
          {t("broadcastPage.abTestEnable")}
        </label>
        {value.abConfig.enabled ? (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-ink-500">A %</span>
              <input
                type="number"
                min={10}
                max={90}
                value={value.abConfig.splitPercentA}
                onChange={(e) =>
                  patch({ abConfig: { ...value.abConfig, splitPercentA: Number(e.target.value) } })
                }
                className="w-16 rounded border px-1 py-0.5 text-xs dark:border-white/10 dark:bg-white/5"
              />
            </div>
            <textarea
              rows={2}
              placeholder={t("broadcastPage.abVariantA")}
              value={value.abConfig.variantA.body}
              onChange={(e) =>
                patch({ abConfig: { ...value.abConfig, variantA: { body: e.target.value } } })
              }
              className="w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5"
            />
            <textarea
              rows={2}
              placeholder={t("broadcastPage.abVariantB")}
              value={value.abConfig.variantB.body}
              onChange={(e) =>
                patch({ abConfig: { ...value.abConfig, variantB: { body: e.target.value } } })
              }
              className="w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5"
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={value.requiresApproval}
            onChange={(e) => patch({ requiresApproval: e.target.checked })}
          />
          {t("broadcastPage.requiresApproval")}
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={value.useDistributedQueue}
            onChange={(e) => patch({ useDistributedQueue: e.target.checked })}
          />
          {t("broadcastPage.distributedQueue")}
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[10px] text-ink-500">{t("broadcastPage.throttleMs")}</label>
          <input
            type="number"
            min={200}
            max={60000}
            value={value.throttleMs}
            onChange={(e) => patch({ throttleMs: Number(e.target.value) })}
            className="mt-0.5 w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5"
          />
        </div>
        <div>
          <label className="text-[10px] text-ink-500">{t("broadcastPage.revenuePerConversion")}</label>
          <input
            type="number"
            min={0}
            value={value.revenuePerConversion}
            onChange={(e) => patch({ revenuePerConversion: e.target.value })}
            className="mt-0.5 w-full rounded border border-ink-200 px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5"
          />
        </div>
      </div>

      {(value.channel === "webhook" || value.channel === "push") && integrationTools.length > 0 ? (
        <div>
          <label className="text-[11px] font-medium">{t("broadcastPage.integrationTool")}</label>
          <select
            value={value.integrationToolId}
            onChange={(e) => patch({ integrationToolId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
          >
            <option value="">{t("broadcastPage.selectTemplate")}</option>
            {integrationTools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.name} ({tool.toolType})
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

export { CHANNEL_API };

export function defaultAdvancedOptions(): AdvancedCampaignOptions {
  return {
    channel: "whatsapp",
    inboxId: "",
    scheduleType: "IMMEDIATE",
    scheduledAt: "",
    cronExpression: "0 9 * * *",
    eventTrigger: "",
    requiresApproval: false,
    useDistributedQueue: true,
    throttleMs: 750,
    revenuePerConversion: "",
    subject: "",
    integrationToolId: "",
    segmentRules: {},
    abConfig: {
      enabled: false,
      splitPercentA: 50,
      variantA: { body: "" },
      variantB: { body: "" },
    },
  };
}
