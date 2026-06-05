import { decrypt } from "./encryption.js";
import { fetchWabaIdFromPhoneNumberId } from "./metaWabaTemplates.js";
import {
  isInboxWhatsappConfigured,
  isMetaCloudWhatsappProvider,
  parseInboxWhatsappFromChannelConfig,
  resolveInboxWhatsappCredentials,
  whatsappWebhookMetaFromConfig,
} from "./inboxWhatsappConfig.js";
import { metaWebhookDiagnosticsFromConfig } from "./whatsappWebhookRouting.js";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type WhatsappHealthCheckId =
  | "number_quality"
  | "display_name"
  | "payment_active"
  | "business_verified"
  | "inbound_webhook";

export type WhatsappHealthCheck = {
  id: WhatsappHealthCheckId;
  ok: boolean;
  /** Valores auxiliares para i18n no cliente (ex.: qualityLevel). */
  meta?: Record<string, string>;
};

export type WhatsappAccountHealthPayload = {
  connected: boolean;
  provider: "meta" | "360dialog";
  verifiedName: string | null;
  displayPhone: string | null;
  connectedSince: string | null;
  qualityRating: string | null;
  qualityLevel: "high" | "medium" | "low" | "unknown";
  phoneStatus: string | null;
  checks: WhatsappHealthCheck[];
  lastCheckedAt: string;
  webhook?: {
    url: string;
    verifyTokenConfigured: boolean;
    appSecretConfigured: boolean;
    lastInboundWebhookAt: string | null;
    receivingOk: boolean;
  };
  error?: string;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function mapQualityLevel(rating: string | undefined): WhatsappAccountHealthPayload["qualityLevel"] {
  const u = (rating ?? "UNKNOWN").toUpperCase();
  if (u === "GREEN") return "high";
  if (u === "YELLOW") return "medium";
  if (u === "RED") return "low";
  return "unknown";
}

function nameStatusOk(status: string | undefined): boolean {
  const u = (status ?? "").toUpperCase();
  return u === "APPROVED" || u === "AVAILABLE_WITHOUT_REVIEW";
}

function businessVerifiedOk(status: string | undefined): boolean {
  const u = (status ?? "").toLowerCase();
  return u === "verified" || u === "approved";
}

function paymentOk(waba: {
  account_review_status?: string;
  primary_funding_id?: string;
}): boolean {
  if (waba.primary_funding_id?.trim()) return true;
  return (waba.account_review_status ?? "").toUpperCase() === "APPROVED";
}

async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const url = `${GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? `Meta API ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export async function fetchMetaWhatsappAccountHealth(input: {
  organizationId: string;
  inbox: { id: string; channelConfig: unknown; updatedAt?: Date };
}): Promise<WhatsappAccountHealthPayload> {
  const lastCheckedAt = new Date().toISOString();
  const parsed = parseInboxWhatsappFromChannelConfig(input.inbox.channelConfig);
  const provider = parsed.whatsappProvider;

  if (!provider || !isMetaCloudWhatsappProvider(provider)) {
    return {
      connected: false,
      provider: "meta",
      verifiedName: null,
      displayPhone: parsed.whatsappDisplayPhone ?? null,
      connectedSince: null,
      qualityRating: null,
      qualityLevel: "unknown",
      phoneStatus: null,
      checks: [],
      lastCheckedAt,
      error: "not_cloud_api",
    };
  }

  if (!isInboxWhatsappConfigured(parsed)) {
    return {
      connected: false,
      provider: provider === "360dialog" ? "360dialog" : "meta",
      verifiedName: null,
      displayPhone: parsed.whatsappDisplayPhone ?? null,
      connectedSince: null,
      qualityRating: null,
      qualityLevel: "unknown",
      phoneStatus: null,
      checks: [],
      lastCheckedAt,
      error: "not_configured",
    };
  }

  const creds = await resolveInboxWhatsappCredentials(input.organizationId, input.inbox);
  const phoneNumberId = creds?.whatsappPhoneNumberId?.trim();
  const apiKeyEnc = creds?.whatsappApiKey;
  const accessToken = apiKeyEnc ? decrypt(apiKeyEnc) : null;

  if (!phoneNumberId || !accessToken) {
    return {
      connected: false,
      provider: provider === "360dialog" ? "360dialog" : "meta",
      verifiedName: null,
      displayPhone: parsed.whatsappDisplayPhone ?? null,
      connectedSince: null,
      qualityRating: null,
      qualityLevel: "unknown",
      phoneStatus: null,
      checks: [],
      lastCheckedAt,
      error: "credentials_incomplete",
    };
  }

  const cfg = input.inbox.channelConfig;
  const connectedSince =
    cfg && typeof cfg === "object" && !Array.isArray(cfg)
      ? str((cfg as Record<string, unknown>).whatsappConnectedAt) ??
        input.inbox.updatedAt?.toISOString() ??
        null
      : input.inbox.updatedAt?.toISOString() ?? null;

  const webhookMeta = whatsappWebhookMetaFromConfig(cfg, input.organizationId, input.inbox.id);
  const webhookDiag = metaWebhookDiagnosticsFromConfig(cfg);
  const lastInboundMs = webhookDiag.lastInboundWebhookAt
    ? new Date(webhookDiag.lastInboundWebhookAt).getTime()
    : null;
  const receivingOk =
    lastInboundMs != null && !Number.isNaN(lastInboundMs) && Date.now() - lastInboundMs < 7 * 24 * 60 * 60 * 1000;
  const webhookBlock = {
    url: webhookMeta.webhookUrl,
    verifyTokenConfigured: webhookDiag.webhookVerifyTokenConfigured,
    appSecretConfigured: webhookDiag.webhookSecretConfigured,
    lastInboundWebhookAt: webhookDiag.lastInboundWebhookAt,
    receivingOk,
  };

  try {
    const phone = await graphGet<{
      verified_name?: string;
      display_phone_number?: string;
      quality_rating?: string;
      name_status?: string;
      status?: string;
    }>(
      `/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,name_status,status`,
      accessToken,
    );

    const wabaId =
      parsed.whatsappBusinessAccountId?.trim() ??
      (await fetchWabaIdFromPhoneNumberId(phoneNumberId, accessToken));

    let waba: {
      account_review_status?: string;
      business_verification_status?: string;
      primary_funding_id?: string;
    } = {};

    if (wabaId) {
      try {
        waba = await graphGet(
          `/${wabaId}?fields=account_review_status,business_verification_status,primary_funding_id`,
          accessToken,
        );
      } catch {
        /* WABA fields opcionais — checks de pagamento/empresa ficam conservadores */
      }
    }

    const qualityRating = phone.quality_rating ?? null;
    const qualityLevel = mapQualityLevel(qualityRating ?? undefined);
    const phoneConnected = (phone.status ?? "CONNECTED").toUpperCase() === "CONNECTED";

    const checks: WhatsappHealthCheck[] = [
      {
        id: "number_quality",
        ok: qualityLevel === "high" || qualityLevel === "medium",
        meta: { qualityLevel, qualityRating: qualityRating ?? "UNKNOWN" },
      },
      {
        id: "display_name",
        ok: nameStatusOk(phone.name_status),
        meta: { nameStatus: phone.name_status ?? "UNKNOWN" },
      },
      {
        id: "payment_active",
        ok: paymentOk(waba),
        meta: {
          accountReviewStatus: waba.account_review_status ?? "UNKNOWN",
        },
      },
      {
        id: "business_verified",
        ok: businessVerifiedOk(waba.business_verification_status),
        meta: {
          verificationStatus: waba.business_verification_status ?? "UNKNOWN",
        },
      },
      {
        id: "inbound_webhook",
        ok: receivingOk,
        meta: {
          lastInboundWebhookAt: webhookDiag.lastInboundWebhookAt ?? "never",
        },
      },
    ];

    return {
      connected: phoneConnected,
      provider: provider === "360dialog" ? "360dialog" : "meta",
      verifiedName: phone.verified_name ?? null,
      displayPhone: phone.display_phone_number ?? parsed.whatsappDisplayPhone ?? null,
      connectedSince,
      qualityRating,
      qualityLevel,
      phoneStatus: phone.status ?? null,
      checks,
      lastCheckedAt,
      webhook: webhookBlock,
    };
  } catch (err) {
    return {
      connected: false,
      provider: provider === "360dialog" ? "360dialog" : "meta",
      verifiedName: null,
      displayPhone: parsed.whatsappDisplayPhone ?? null,
      connectedSince,
      qualityRating: null,
      qualityLevel: "unknown",
      phoneStatus: null,
      checks: [
        {
          id: "inbound_webhook",
          ok: receivingOk,
          meta: { lastInboundWebhookAt: webhookDiag.lastInboundWebhookAt ?? "never" },
        },
      ],
      lastCheckedAt,
      webhook: webhookBlock,
      error: err instanceof Error ? err.message : "meta_api_error",
    };
  }
}
