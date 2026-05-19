export type CampaignChannel =
  | "whatsapp"
  | "email"
  | "sms"
  | "telegram"
  | "instagram"
  | "messenger"
  | "push"
  | "webhook"
  | "voice";

export type CampaignCenterTab = "campaigns" | "templates" | "flows" | "analytics";

export type CampaignStatusFilter = "ALL" | "DRAFT" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface CampaignTag {
  tagId: string;
  tag: { id: string; name: string; color: string };
}

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  channel?: string;
  messageType: string;
  body: string | null;
  templateId: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  responseCount?: number;
  conversionCount?: number;
  roiValue?: string | number | null;
  requiresApproval?: boolean;
  approvalStatus?: string;
  scheduleType?: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  tags: CampaignTag[];
  createdBy?: { id: string; name: string; displayName: string | null };
  _count?: { recipients: number };
  audienceCount?: number | null;
}

export interface BroadcastDashboard {
  metrics: {
    sentToday: number;
    deliveryRate: number | null;
    responseRate: number | null;
    conversions: number | null;
    leadsGenerated: number;
    activeCampaigns: number;
    failedMessages: number;
    roi: number | null;
    totalSent: number;
    totalRecipients: number;
  };
  statusBreakdown: Record<string, number>;
  topCampaigns: {
    id: string;
    name: string;
    status: string;
    sentCount: number;
    failedCount: number;
    totalRecipients: number;
    deliveryRate: number | null;
  }[];
  sendByDay: { date: string; sent: number; failed: number }[];
}

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

export interface TemplateOption {
  id: string;
  name: string;
  bodyVariableCount?: number;
}

export const OMNICHANNEL_CHANNELS: {
  id: CampaignChannel;
  labelKey: string;
  available: boolean;
}[] = [
  { id: "whatsapp", labelKey: "broadcastPage.channelWhatsapp", available: true },
  { id: "email", labelKey: "broadcastPage.channelEmail", available: true },
  { id: "sms", labelKey: "broadcastPage.channelSms", available: true },
  { id: "telegram", labelKey: "broadcastPage.channelTelegram", available: true },
  { id: "instagram", labelKey: "broadcastPage.channelInstagram", available: true },
  { id: "messenger", labelKey: "broadcastPage.channelMessenger", available: true },
  { id: "push", labelKey: "broadcastPage.channelPush", available: true },
  { id: "webhook", labelKey: "broadcastPage.channelWebhook", available: true },
  { id: "voice", labelKey: "broadcastPage.channelVoice", available: true },
];

export const CHANNEL_LABEL_KEYS: Record<string, string> = {
  WHATSAPP: "broadcastPage.channelWhatsapp",
  EMAIL: "broadcastPage.channelEmail",
  SMS: "broadcastPage.channelSms",
  TELEGRAM: "broadcastPage.channelTelegram",
  INSTAGRAM: "broadcastPage.channelInstagram",
  MESSENGER: "broadcastPage.channelMessenger",
  PUSH: "broadcastPage.channelPush",
  WEBHOOK: "broadcastPage.channelWebhook",
  VOICE: "broadcastPage.channelVoice",
};

export const CAMPAIGN_TEMPLATE_PRESETS: {
  id: string;
  titleKey: string;
  descKey: string;
  emoji: string;
  suggestedTags?: string[];
  messageHintKey: string;
}[] = [
  { id: "lead_recovery", titleKey: "broadcastPage.tplLeadRecovery", descKey: "broadcastPage.tplLeadRecoveryDesc", emoji: "🔥", messageHintKey: "broadcastPage.tplLeadRecoveryHint" },
  { id: "post_sale", titleKey: "broadcastPage.tplPostSale", descKey: "broadcastPage.tplPostSaleDesc", emoji: "✅", messageHintKey: "broadcastPage.tplPostSaleHint" },
  { id: "billing", titleKey: "broadcastPage.tplBilling", descKey: "broadcastPage.tplBillingDesc", emoji: "💳", messageHintKey: "broadcastPage.tplBillingHint" },
  { id: "scheduling", titleKey: "broadcastPage.tplScheduling", descKey: "broadcastPage.tplSchedulingDesc", emoji: "📅", messageHintKey: "broadcastPage.tplSchedulingHint" },
  { id: "reactivation", titleKey: "broadcastPage.tplReactivation", descKey: "broadcastPage.tplReactivationDesc", emoji: "⚡", messageHintKey: "broadcastPage.tplReactivationHint" },
  { id: "hospitality", titleKey: "broadcastPage.tplHospitality", descKey: "broadcastPage.tplHospitalityDesc", emoji: "🏨", messageHintKey: "broadcastPage.tplHospitalityHint" },
  { id: "real_estate", titleKey: "broadcastPage.tplRealEstate", descKey: "broadcastPage.tplRealEstateDesc", emoji: "🏠", messageHintKey: "broadcastPage.tplRealEstateHint" },
  { id: "clinic", titleKey: "broadcastPage.tplClinic", descKey: "broadcastPage.tplClinicDesc", emoji: "🩺", messageHintKey: "broadcastPage.tplClinicHint" },
  { id: "ecommerce", titleKey: "broadcastPage.tplEcommerce", descKey: "broadcastPage.tplEcommerceDesc", emoji: "🛒", messageHintKey: "broadcastPage.tplEcommerceHint" },
];

export const FLOW_BLOCK_KEYS = [
  "broadcastPage.flowSendMessage",
  "broadcastPage.flowWait",
  "broadcastPage.flowCondition",
  "broadcastPage.flowAiReply",
  "broadcastPage.flowCheckTag",
  "broadcastPage.flowCreateDeal",
  "broadcastPage.flowMovePipeline",
  "broadcastPage.flowReminder",
  "broadcastPage.flowWebhook",
  "broadcastPage.flowApi",
  "broadcastPage.flowEmail",
] as const;

export function campaignProgress(row: CampaignRow): number {
  if (row.status === "DRAFT") return 0;
  if (!row.totalRecipients) return row.status === "COMPLETED" ? 100 : 0;
  return Math.min(100, Math.round(((row.sentCount + row.failedCount) / row.totalRecipients) * 100));
}

export function campaignDeliveryRate(row: CampaignRow): number | null {
  const attempted = row.sentCount + row.failedCount;
  if (!attempted) return null;
  return Math.round((row.sentCount / attempted) * 1000) / 10;
}
