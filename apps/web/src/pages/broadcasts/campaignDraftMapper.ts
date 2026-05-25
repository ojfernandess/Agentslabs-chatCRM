import type { CampaignChannel } from "./campaignTypes";
import type { CreatorDraft } from "./CampaignCreatorPanel";
import { defaultAdvancedOptions } from "./CampaignAdvancedOptions";
import type { FollowUpRecurrence, FollowUpRecurrenceFrequency } from "@/lib/broadcastRecurrence";
export type FollowUpScheduleMode = "now" | "scheduled" | "recurring";
export type FollowUpTagLogic = "ANY" | "ALL";
export type FollowUpAfterSendMode = "bot" | "human_handoff";

const CHANNEL_FROM_API: Record<string, CampaignChannel> = {
  WHATSAPP: "whatsapp",
  EMAIL: "email",
  SMS: "sms",
  TELEGRAM: "telegram",
  INSTAGRAM: "instagram",
  MESSENGER: "messenger",
  PUSH: "push",
  WEBHOOK: "webhook",
  VOICE: "voice",
};

export interface CampaignDetailRow {
  id: string;
  name: string;
  status: string;
  channel?: string;
  messageType: string;
  body: string | null;
  templateId: string | null;
  inboxId?: string | null;
  scheduleType?: string;
  scheduledAt?: string | null;
  cronExpression?: string | null;
  segmentRules?: unknown;
  flowDefinition?: unknown;
  tags: { tagId: string; tag: { id: string; name: string; color: string } }[];
}

export interface FollowUpEditInitial {
  campaignId: string;
  name: string;
  selectedTagIds: string[];
  tagLogic: FollowUpTagLogic;
  inboxId: string;
  messageType: "TEXT" | "TEMPLATE";
  body: string;
  templateId: string;
  scheduleMode: FollowUpScheduleMode;
  scheduledAt: string;
  recurrenceFrequency: FollowUpRecurrenceFrequency;
  recurrenceTime: string;
  recurrenceDayOfWeek: number;
  recurrenceDayOfMonth: number;
  followUpAfterSend: FollowUpAfterSendMode;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function campaignToCreatorDraft(row: CampaignDetailRow): Partial<CreatorDraft> {
  const channel = CHANNEL_FROM_API[(row.channel ?? "WHATSAPP").toUpperCase()] ?? "whatsapp";
  const rules =
    row.segmentRules && typeof row.segmentRules === "object"
      ? (row.segmentRules as Record<string, unknown>)
      : {};
  const adv = defaultAdvancedOptions();
  adv.channel = channel;
  adv.inboxId = row.inboxId ?? "";
  adv.scheduleType = (row.scheduleType as typeof adv.scheduleType) ?? "IMMEDIATE";
  adv.scheduledAt = toDatetimeLocal(row.scheduledAt);
  adv.cronExpression = row.cronExpression ?? adv.cronExpression;
  adv.segmentRules = {
    tagLogic: rules.tagLogic === "ALL" ? "ALL" : "ANY",
    ...(typeof rules === "object" ? rules : {}),
  };

  return {
    name: row.name,
    messageType: row.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
    body: row.body ?? "",
    templateId: row.templateId ?? "",
    selectedTagIds: row.tags.map((t) => t.tagId),
    advanced: adv,
    flowDefinition: (row.flowDefinition as CreatorDraft["flowDefinition"]) ?? null,
  };
}

export function campaignToFollowUpInitial(row: CampaignDetailRow): FollowUpEditInitial {
  const rules =
    row.segmentRules && typeof row.segmentRules === "object"
      ? (row.segmentRules as Record<string, unknown>)
      : {};
  const rec = rules.followUpRecurrence as FollowUpRecurrence | undefined;

  let scheduleMode: FollowUpScheduleMode = "now";
  if (row.scheduleType === "SCHEDULED") scheduleMode = "scheduled";
  else if (row.scheduleType === "RECURRING") scheduleMode = "recurring";
  else if (row.scheduleType === "IMMEDIATE") scheduleMode = "now";

  const recurrenceTime =
    rec && Number.isFinite(rec.hour) && Number.isFinite(rec.minute)
      ? `${pad2(rec.hour)}:${pad2(rec.minute)}`
      : "09:00";

  return {
    campaignId: row.id,
    name: row.name,
    selectedTagIds: row.tags.map((t) => t.tagId),
    tagLogic: rules.tagLogic === "ALL" ? "ALL" : "ANY",
    inboxId: row.inboxId ?? "",
    messageType: row.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
    body: row.body ?? "",
    templateId: row.templateId ?? "",
    scheduleMode,
    scheduledAt: toDatetimeLocal(row.scheduledAt) || toDatetimeLocal(new Date().toISOString()),
    recurrenceFrequency: rec?.frequency ?? "monthly",
    recurrenceTime,
    recurrenceDayOfWeek: rec?.dayOfWeek ?? 1,
    recurrenceDayOfMonth: rec?.dayOfMonth ?? 1,
    followUpAfterSend:
      rules.followUpAfterSend === "bot" || rules.followUpAfterSend === "human_handoff"
        ? rules.followUpAfterSend
        : "human_handoff",
  };
}
