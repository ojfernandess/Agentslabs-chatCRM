import { prisma } from "../../db.js";
import {
  config,
  getPublicOrigin,
  getWebAppPublicOrigin,
  isMercadoPagoBillingConfigured,
  isMercadoPagoWebhookConfigured,
  isStripeBillingConfigured,
} from "../../config.js";
import { mercadoPagoOAuthRedirectUri } from "./MercadoPagoConnectionService.js";
import {
  getMercadoPagoBillingModeDiagnostics,
  getMercadoPagoBillingPlatformSettings,
  resolvePlatformMercadoPagoAccessToken,
} from "./mercadoPagoBillingSettings.js";
import { mercadoPagoRequest } from "./mercadopago/mercadoPagoClient.js";
import { getStripeClient } from "./stripeClient.js";
import { getStripeKeyMode, type StripeKeyMode } from "./stripeErrors.js";

export type SuperBillingEnvVarRow = {
  key: string;
  configured: boolean;
  displayValue: string | null;
  isSecret: boolean;
};

export type SuperBillingWebhookStats = {
  url: string;
  configured: boolean;
  eventsLast7Days: number;
  lastEventAt: string | null;
  lastEventType: string | null;
};

export type SuperBillingConnectivityTest = {
  ok: boolean;
  message: string;
  testedAt: string;
  details?: Record<string, unknown>;
};

export type SuperBillingProviderDiagnostics = Awaited<ReturnType<typeof getSuperBillingProviderDiagnostics>>;

function maskSecret(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function envRow(key: string, value: string, isSecret: boolean): SuperBillingEnvVarRow {
  const configured = Boolean(value.trim());
  return {
    key,
    configured,
    displayValue: configured ? (isSecret ? maskSecret(value) : value.trim()) : null,
    isSecret,
  };
}

async function webhookStats(
  provider: "stripe" | "mercadopago",
  url: string,
  configured: boolean,
): Promise<SuperBillingWebhookStats> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [eventsLast7Days, last] = await Promise.all([
    prisma.paymentWebhookEvent.count({
      where: { provider, createdAt: { gte: since } },
    }),
    prisma.paymentWebhookEvent.findFirst({
      where: { provider },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, eventType: true },
    }),
  ]);

  return {
    url,
    configured,
    eventsLast7Days,
    lastEventAt: last?.createdAt.toISOString() ?? null,
    lastEventType: last?.eventType ?? null,
  };
}

export async function getSuperBillingProviderDiagnostics() {
  const publicApiUrl = getPublicOrigin();
  const webAppUrl = getWebAppPublicOrigin();
  const stripeWebhookUrl = `${publicApiUrl}/webhooks/stripe`;
  const mpWebhookUrl = `${publicApiUrl}/webhooks/mercadopago`;
  const oauthRedirectUri = mercadoPagoOAuthRedirectUri();
  const mpOAuthConfigured = Boolean(config.mercadopagoClientId && config.mercadopagoClientSecret);

  const [stripeWebhook, mpWebhook, mpConnectedOrgs, mpTotalOrgs, mpBillingMode] = await Promise.all([
    webhookStats("stripe", stripeWebhookUrl, isStripeBillingConfigured()),
    webhookStats("mercadopago", mpWebhookUrl, isMercadoPagoWebhookConfigured()),
    prisma.paymentProviderConnection.count({ where: { provider: "mercadopago", status: "connected" } }),
    prisma.paymentProviderConnection.count({ where: { provider: "mercadopago" } }),
    getMercadoPagoBillingModeDiagnostics(),
  ]);

  return {
    publicApiUrl,
    webAppUrl,
    stripe: {
      configured: isStripeBillingConfigured(),
      checkoutConfigured: Boolean(config.stripeSecretKey),
      publishableKeyConfigured: Boolean(config.stripePublishableKey),
      webhookSecretConfigured: Boolean(config.stripeWebhookSecret),
      keyMode: getStripeKeyMode(config.stripeSecretKey) as StripeKeyMode,
      apiVersion: config.stripeApiVersion,
      env: [
        envRow("STRIPE_SECRET_KEY", config.stripeSecretKey, true),
        envRow("STRIPE_PUBLISHABLE_KEY", config.stripePublishableKey, false),
        envRow("STRIPE_WEBHOOK_SECRET", config.stripeWebhookSecret, true),
        envRow("STRIPE_API_VERSION", config.stripeApiVersion, false),
        envRow("STRIPE_CHECKOUT_SUCCESS_URL", config.stripeCheckoutSuccessUrl, false),
        envRow("STRIPE_CHECKOUT_CANCEL_URL", config.stripeCheckoutCancelUrl, false),
      ],
      webhooks: stripeWebhook,
    },
    mercadopago: {
      configured: isMercadoPagoBillingConfigured(),
      webhookConfigured: isMercadoPagoWebhookConfigured(),
      oauthConfigured: mpOAuthConfigured,
      oauthRedirectUri,
      orgConnections: { connected: mpConnectedOrgs, total: mpTotalOrgs },
      billingMode: mpBillingMode,
      env: [
        envRow("MERCADOPAGO_SANDBOX_ACCESS_TOKEN", config.mercadopagoSandboxAccessToken, true),
        envRow("MERCADOPAGO_SANDBOX_PUBLIC_KEY", config.mercadopagoSandboxPublicKey, false),
        envRow("MERCADOPAGO_PRODUCTION_ACCESS_TOKEN", config.mercadopagoProductionAccessToken, true),
        envRow("MERCADOPAGO_PRODUCTION_PUBLIC_KEY", config.mercadopagoProductionPublicKey, false),
        envRow("MERCADOPAGO_ACCESS_TOKEN", config.mercadopagoAccessToken, true),
        envRow("MERCADOPAGO_PUBLIC_KEY", config.mercadopagoPublicKey, false),
        envRow("MERCADOPAGO_WEBHOOK_SECRET", config.mercadopagoWebhookSecret, true),
        envRow("MERCADOPAGO_CLIENT_ID", config.mercadopagoClientId, false),
        envRow("MERCADOPAGO_CLIENT_SECRET", config.mercadopagoClientSecret, true),
        envRow(
          "MERCADOPAGO_OAUTH_REDIRECT_URI",
          config.mercadopagoOAuthRedirectUri.trim() || oauthRedirectUri,
          false,
        ),
        envRow("MERCADOPAGO_CHECKOUT_SUCCESS_URL", config.mercadopagoCheckoutSuccessUrl, false),
        envRow("MERCADOPAGO_CHECKOUT_CANCEL_URL", config.mercadopagoCheckoutCancelUrl, false),
      ],
      webhooks: mpWebhook,
    },
    platformEnv: [
      envRow("PUBLIC_URL", publicApiUrl, false),
      envRow("WEB_APP_PUBLIC_URL", process.env.WEB_APP_PUBLIC_URL?.trim() ?? "", false),
    ],
  };
}

export async function testSuperBillingProviderConnectivity(
  provider: "stripe" | "mercadopago" | "all",
): Promise<{ results: Record<string, SuperBillingConnectivityTest>; testedAt: string }> {
  const testedAt = new Date().toISOString();
  const results: Record<string, SuperBillingConnectivityTest> = {};

  if (provider === "stripe" || provider === "all") {
    if (!config.stripeSecretKey.trim()) {
      results.stripe = { ok: false, message: "STRIPE_SECRET_KEY is not configured", testedAt };
    } else {
      try {
        const stripe = getStripeClient();
        const balance = await stripe.balance.retrieve();
        results.stripe = {
          ok: true,
          message: "Stripe API responded successfully",
          testedAt,
          details: { livemode: balance.livemode },
        };
      } catch (err) {
        results.stripe = {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          testedAt,
        };
      }
    }
  }

  if (provider === "mercadopago" || provider === "all") {
    if (!isMercadoPagoBillingConfigured()) {
      results.mercadopago = {
        ok: false,
        message: "Mercado Pago access token is not configured",
        testedAt,
      };
    } else {
      try {
        const settings = await getMercadoPagoBillingPlatformSettings();
        const accessToken = await resolvePlatformMercadoPagoAccessToken();
        const profile = await mercadoPagoRequest<{ id?: number; nickname?: string }>({
          accessToken,
          method: "GET",
          path: "/users/me",
        });
        results.mercadopago = {
          ok: true,
          message: "Mercado Pago API responded successfully",
          testedAt,
          details: {
            userId: profile.id ?? null,
            nickname: profile.nickname ?? null,
            mode: settings.mode,
          },
        };
      } catch (err) {
        results.mercadopago = {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          testedAt,
        };
      }
    }
  }

  return { results, testedAt };
}
