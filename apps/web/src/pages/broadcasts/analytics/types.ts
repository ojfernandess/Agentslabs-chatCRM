export type AnalyticsCampaignKind = "all" | "followup" | "broadcast" | "ai" | "flow";
export type AnalyticsRecipientStatus = "ALL" | "PENDING" | "SENT" | "FAILED";

export type BroadcastErrorCategory =
  | "invalid_number"
  | "carrier_block"
  | "gateway"
  | "whatsapp_window"
  | "template"
  | "flow_skip"
  | "voice"
  | "email"
  | "rate_limit"
  | "unknown";

export interface CampaignAnalyticsFilters {
  from: string;
  to: string;
  campaignKind: AnalyticsCampaignKind;
  status: AnalyticsRecipientStatus;
  channel: string;
  search: string;
  page: number;
  pageSize: number;
}

export interface BroadcastCampaignAnalytics {
  summary: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    deliveryRate: number | null;
    errorRate: number | null;
    engagementRate: number | null;
    responded: number;
    opened: number;
  };
  filters: {
    from: string;
    to: string;
    campaignKind: string;
    status: string;
    channel: string | null;
    search: string | null;
    campaignId: string | null;
  };
  sendByDay: { date: string; sent: number; failed: number }[];
  ratesByDay: {
    date: string;
    deliveryRate: number | null;
    errorRate: number | null;
    engagementRate: number | null;
  }[];
  topCampaigns: {
    id: string;
    name: string;
    status: string;
    channel: string;
    campaignKind: string | null;
    sentCount: number;
    failedCount: number;
    totalRecipients: number;
    deliveryRate: number | null;
  }[];
  errorSpikeAlert: {
    active: boolean;
    failedLast24h: number;
    baselineDaily: number;
    messageKey: string;
  } | null;
  errorsByCategory: {
    category: BroadcastErrorCategory;
    count: number;
    sampleMessage: string | null;
    affectedPhones: string[];
  }[];
  sendLog: {
    items: {
      id: string;
      sentAt: string | null;
      createdAt: string;
      status: string;
      channel: string;
      campaignId: string;
      campaignName: string;
      campaignKind: string | null;
      contactId: string;
      contactName: string | null;
      phone: string | null;
      email: string | null;
      error: string | null;
      errorCategory: BroadcastErrorCategory | null;
      openedAt: string | null;
      respondedAt: string | null;
    }[];
    total: number;
    page: number;
    pageSize: number;
  };
}

export const DEFAULT_ANALYTICS_FILTERS: CampaignAnalyticsFilters = {
  from: "",
  to: "",
  campaignKind: "all",
  status: "ALL",
  channel: "",
  search: "",
  page: 1,
  pageSize: 50,
};

export function defaultAnalyticsDateInputs(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
