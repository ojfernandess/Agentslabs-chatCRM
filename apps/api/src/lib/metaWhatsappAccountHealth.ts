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
import { getWhatsAppEmbeddedConfig } from "./metaWhatsAppEmbedded.js";
import { metaEmbeddedWebhookUrl } from "../config.js";

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
    embeddedCallbackUrl: string | null;
    useEmbeddedCallback: boolean;
    verifyTokenConfigured: boolean;
    appSecretConfigured: boolean;
    lastInboundWebhookAt: string | null;
    lastWebhookAttemptAt: string | null;
    lastWebhookAttemptError: string | null;
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

type MetaHealthEntity = {
  entity_type?: string;
  can_send_message?: string;
  errors?: Array<{ error_code?: number }>;
};

type MetaHealthStatus = {
  can_send_message?: string;
  entities?: MetaHealthEntity[];
};

/** Meta enum values are lowercase; some responses return uppercase (e.g. VERIFIED). */
function normalizeMetaToken(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/-/g, "_");
}

function healthEntityHasErrorCode(
  health: MetaHealthStatus | undefined,
  codes: ReadonlySet<number>,
  entityTypes?: ReadonlySet<string>,
): boolean {
  if (!health?.entities?.length) return false;
  for (const entity of health.entities) {
    if (entityTypes && entity.entity_type && !entityTypes.has(entity.entity_type)) continue;
    for (const err of entity.errors ?? []) {
      if (typeof err.error_code === "number" && codes.has(err.error_code)) return true;
    }
  }
  return false;
}

const META_PAYMENT_ERROR_CODES = new Set([141006, 141007]);
const META_BUSINESS_VERIFICATION_ERROR_CODES = new Set([141010]);

export function nameStatusOk(
  status: string | undefined,
  fallback?: { verifiedName?: string | null; phoneConnected?: boolean },
): boolean {
  const normalized = normalizeMetaToken(status);
  if (normalized === "APPROVED" || normalized === "AVAILABLE_WITHOUT_REVIEW") return true;
  // name_status is beta and may be omitted even when verified_name is active.
  if (!status?.trim() && fallback?.verifiedName?.trim() && fallback.phoneConnected) return true;
  return false;
}

export function businessVerifiedOk(
  status: string | undefined,
  healthStatus?: MetaHealthStatus,
): boolean {
  if (normalizeMetaToken(status) === "VERIFIED") return true;
  if (
    healthStatus &&
    !healthEntityHasErrorCode(
      healthStatus,
      META_BUSINESS_VERIFICATION_ERROR_CODES,
      new Set(["BUSINESS"]),
    )
  ) {
    const business = healthStatus.entities?.find((entity) => entity.entity_type === "BUSINESS");
    if (business?.can_send_message === "AVAILABLE") return true;
  }
  return false;
}

export function paymentOk(input: {
  primaryFundingId?: string;
  accountReviewStatus?: string;
  healthStatus?: MetaHealthStatus;
  wabaStatus?: string;
  currency?: string;
}): boolean {
  if (
    input.healthStatus &&
    healthEntityHasErrorCode(input.healthStatus, META_PAYMENT_ERROR_CODES, new Set(["WABA", "BUSINESS"]))
  ) {
    return false;
  }
  if (input.primaryFundingId?.trim()) return true;
  if (normalizeMetaToken(input.accountReviewStatus) === "APPROVED") return true;
  if (normalizeMetaToken(input.wabaStatus) === "ACTIVE" && input.currency?.trim()) return true;
  return false;
}

async function fetchWabaAccountFields(
  wabaId: string,
  accessToken: string,
): Promise<{
  account_review_status?: string;
  business_verification_status?: string;
  status?: string;
  currency?: string;
  primary_funding_id?: string;
}> {
  const waba = await graphGet<{
    account_review_status?: string;
    business_verification_status?: string;
    status?: string;
    currency?: string;
  }>(
    `/${wabaId}?fields=account_review_status,business_verification_status,status,currency`,
    accessToken,
  );

  let primaryFundingId: string | undefined;
  try {
    const funding = await graphGet<{ primary_funding_id?: string }>(
      `/${wabaId}?fields=primary_funding_id`,
      accessToken,
    );
    primaryFundingId = funding.primary_funding_id;
  } catch {
    /* primary_funding_id exige permissões BSP em alguns apps — não bloqueia os demais campos */
  }

  return { ...waba, primary_funding_id: primaryFundingId };
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
  const embeddedCfg = await getWhatsAppEmbeddedConfig();
  const embeddedCallbackUrl = embeddedCfg ? metaEmbeddedWebhookUrl() : null;
  const lastInboundMs = webhookDiag.lastInboundWebhookAt
    ? new Date(webhookDiag.lastInboundWebhookAt).getTime()
    : null;
  const receivingOk =
    lastInboundMs != null && !Number.isNaN(lastInboundMs) && Date.now() - lastInboundMs < 7 * 24 * 60 * 60 * 1000;
  const webhookBlock = {
    url: webhookMeta.webhookUrl,
    embeddedCallbackUrl,
    useEmbeddedCallback: Boolean(embeddedCallbackUrl),
    verifyTokenConfigured: webhookDiag.webhookVerifyTokenConfigured,
    appSecretConfigured: webhookDiag.webhookSecretConfigured,
    lastInboundWebhookAt: webhookDiag.lastInboundWebhookAt,
    lastWebhookAttemptAt: webhookDiag.lastWebhookAttemptAt,
    lastWebhookAttemptError: webhookDiag.lastWebhookAttemptError,
    receivingOk,
  };

  try {
    const phone = await graphGet<{
      verified_name?: string;
      display_phone_number?: string;
      quality_rating?: string;
      name_status?: string;
      status?: string;
      health_status?: MetaHealthStatus;
    }>(
      `/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,name_status,status,health_status`,
      accessToken,
    );

    let wabaId = parsed.whatsappBusinessAccountId?.trim() ?? null;
    if (!wabaId) {
      try {
        wabaId = await fetchWabaIdFromPhoneNumberId(phoneNumberId, accessToken);
      } catch {
        /* WABA ID opcional — checks de pagamento/empresa ficam conservadores */
      }
    }

    let waba: {
      account_review_status?: string;
      business_verification_status?: string;
      primary_funding_id?: string;
      status?: string;
      currency?: string;
    } = {};

    if (wabaId) {
      try {
        waba = await fetchWabaAccountFields(wabaId, accessToken);
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
        ok: nameStatusOk(phone.name_status, {
          verifiedName: phone.verified_name ?? null,
          phoneConnected,
        }),
        meta: { nameStatus: phone.name_status ?? "UNKNOWN" },
      },
      {
        id: "payment_active",
        ok: paymentOk({
          primaryFundingId: waba.primary_funding_id,
          accountReviewStatus: waba.account_review_status,
          healthStatus: phone.health_status,
          wabaStatus: waba.status,
          currency: waba.currency,
        }),
        meta: {
          accountReviewStatus: waba.account_review_status ?? "UNKNOWN",
        },
      },
      {
        id: "business_verified",
        ok: businessVerifiedOk(waba.business_verification_status, phone.health_status),
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
