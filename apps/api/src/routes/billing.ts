import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { clientIp } from "../lib/audit.js";
import {
  BillingError,
  getEffectivePlanForOrganization,
  parsePlanExtras,
  parsePlanFeatures,
  stripInternalPlanFeatureKeys,
  parsePlanLimitEnabledFlags,
  parsePlanLimits,
  parsePlanPaymentProviders,
  getOrganizationUsage,
  applyCatalogPlanToOrganization,
  listPlansForOrganization,
  computePaymentGraceInfo,
  getBillingProvider,
  getBillingProvidersClientConfig,
  resolveDefaultPaymentProvider,
  resolveOrganizationPaymentProvider,
  subscriptionIsProviderManaged,
  ensureMercadoPagoSubscriptionBillingPeriod,
  type PaymentProviderName,
} from "../lib/billing/index.js";
import { mercadoPagoBillingErrorHttpStatus } from "../lib/billing/mercadopago/mercadoPagoClient.js";
import {
  getOrganizationAiCreditsBalance,
  listOrganizationAiUsageRecords,
} from "../lib/ai-billing/AiUsageBillingService.js";
import { getOrganizationAiBillingMode } from "../lib/ai-billing/getOrganizationAiBillingMode.js";
import { listActiveAiCreditPackages } from "../lib/ai-billing/AiCreditPackageService.js";
import {
  AiCreditPurchaseError,
  createAiCreditPurchaseCheckout,
  getAiCreditPurchaseCheckoutStatus,
} from "../lib/ai-billing/AiCreditPurchaseService.js";

const planIdBodySchema = z.object({
  planId: z.string().uuid(),
  provider: z.enum(["stripe", "mercadopago"]).optional(),
  paymentMethod: z.enum(["card", "pix"]).optional(),
  payerIdentificationNumber: z.string().trim().min(11).max(18).optional(),
});

const portalBodySchema = z.object({
  returnUrl: z.string().url().max(2048).optional(),
});

const cancelBodySchema = z.object({
  cancelAtPeriodEnd: z.boolean().optional(),
});

const aiCreditCheckoutBodySchema = z.object({
  packageId: z.string().uuid(),
  provider: z.enum(["stripe", "mercadopago"]).optional(),
  paymentMethod: z.enum(["card", "pix"]).optional(),
  payerIdentificationNumber: z.string().trim().min(11).max(18).optional(),
});

function sendAiCreditPurchaseError(reply: FastifyReply, err: unknown): void {
  if (err instanceof AiCreditPurchaseError) {
    const statusCode =
      err.code === "checkout_not_found"
        ? 404
        : err.code === "not_platform_credits" || err.code === "package_not_found"
          ? 400
          : err.code === "provider_not_configured" || err.code === "billing_email_missing"
            ? 422
            : 400;
    reply.status(statusCode).send({
      error: err.code,
      message: err.message,
      statusCode,
    });
    return;
  }
  sendBillingError(reply, err);
}

function sendBillingError(reply: FastifyReply, err: unknown): void {
  if (err instanceof BillingError) {
    const statusCode = mercadoPagoBillingErrorHttpStatus(err);
    reply.status(statusCode).send({
      error: err.code,
      message: err.message,
      statusCode,
    });
    return;
  }
  throw err;
}

function providerNotConfiguredReply(reply: FastifyReply, provider: PaymentProviderName): void {
  reply.status(503).send({
    error: `${provider}_not_configured`,
    message: `${provider} billing is not configured on this server`,
    statusCode: 503,
  });
}

async function resolveCheckoutProvider(
  organizationId: string,
  planId: string,
  requested?: PaymentProviderName,
): Promise<PaymentProviderName> {
  if (requested) {
    const providers = await getBillingProvidersClientConfig(organizationId);
    if (requested === "stripe" && (!providers.stripe.configured || !providers.stripe.enabled)) {
      throw new BillingError("Stripe billing is disabled or not configured on the platform", "stripe_not_configured");
    }
    if (requested === "mercadopago" && (!providers.mercadopago.connected || !providers.mercadopago.enabled)) {
      throw new BillingError(
        "Mercado Pago billing is disabled or not configured on the platform",
        "mercadopago_not_configured",
      );
    }
    return requested;
  }

  const sub = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: { paymentProvider: true },
  });
  if (sub?.paymentProvider === "mercadopago" || sub?.paymentProvider === "stripe") {
    return sub.paymentProvider;
  }

  const [plan, providers] = await Promise.all([
    prisma.plan.findFirst({
      where: { id: planId, isActive: true },
      select: { stripePriceId: true, mercadopagoPlanId: true, amountCents: true },
    }),
    getBillingProvidersClientConfig(organizationId),
  ]);

  if (!plan || plan.amountCents <= 0) {
    return resolveDefaultPaymentProvider();
  }

  const stripeReady = providers.stripe.configured && providers.stripe.enabled;
  const mercadoPagoReady =
    providers.mercadopago.connected && providers.mercadopago.enabled && plan.amountCents > 0;

  if (mercadoPagoReady && !stripeReady) return "mercadopago";
  if (stripeReady && !mercadoPagoReady) return "stripe";
  return resolveDefaultPaymentProvider();
}

function serializePlanForClient(plan: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  badgeLabel?: string | null;
  currency: string;
  amountCents: number;
  interval: string;
  trialDays: number | null;
  displayOrder?: number;
  limits: unknown;
  features: unknown;
  planExtras?: unknown;
  stripePriceId?: string | null;
  mercadopagoPlanId?: string | null;
}) {
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    badgeLabel: plan.badgeLabel?.trim() || null,
    currency: plan.currency,
    amountCents: plan.amountCents,
    interval: plan.interval,
    trialDays: plan.trialDays,
    displayOrder: plan.displayOrder ?? 0,
    limits: parsePlanLimits(plan.limits),
    limitEnabled: parsePlanLimitEnabledFlags(plan.limits),
    features: stripInternalPlanFeatureKeys(parsePlanFeatures(plan.features)),
    planExtras: parsePlanExtras(plan.planExtras ?? {}),
  };
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);

  app.get("/config", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providers = await getBillingProvidersClientConfig(organizationId);
    const stripe = providers.stripe;
    return {
      stripeConfigured: stripe.configured && stripe.enabled,
      publishableKey: stripe.publishableKey,
      providers,
      defaultProvider: resolveDefaultPaymentProvider(),
    };
  });

  app.get("/overview", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    await ensureMercadoPagoSubscriptionBillingPeriod(organizationId).catch(() => {});

    const [entitlements, usage, org, providers, aiBillingMode] = await Promise.all([
      getEffectivePlanForOrganization(organizationId),
      getOrganizationUsage(organizationId),
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          planTier: true,
          billingEmail: true,
          subscription: {
            include: {
              plan: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  description: true,
                  currency: true,
                  amountCents: true,
                  interval: true,
                  trialDays: true,
                  limits: true,
                  features: true,
                  planExtras: true,
                  isCustom: true,
                },
              },
            },
          },
        },
      }),
      getBillingProvidersClientConfig(organizationId),
      getOrganizationAiBillingMode(organizationId),
    ]);

    const sub = org?.subscription;
    const plan = sub?.plan;
    const paymentGrace = computePaymentGraceInfo({
      status: sub?.status ?? "inactive",
      paymentDueAt: sub?.paymentDueAt ?? null,
      stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
      planIsCustom: plan?.isCustom ?? false,
    });

    return {
      stripeConfigured: providers.stripe.configured && providers.stripe.enabled,
      publishableKey: providers.stripe.publishableKey,
      providers,
      defaultProvider: resolveDefaultPaymentProvider(),
      billingEmail: org?.billingEmail ?? null,
      legacyPlanTier: org?.planTier ?? "free",
      hasCustomPlanCatalog: Boolean(
        plan?.isCustom ||
          (await prisma.plan.count({ where: { organizationId, isCustom: true, isActive: true } })),
      ),
      paymentGrace,
      subscription: sub
        ? {
            status: sub.status,
            paymentProvider: sub.paymentProvider,
            stripeManaged: Boolean(sub.stripeSubscriptionId),
            providerManaged: subscriptionIsProviderManaged(sub),
            currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            canceledAt: sub.canceledAt?.toISOString() ?? null,
            trialEnd: sub.trialEnd?.toISOString() ?? null,
            paymentDueAt: sub.paymentDueAt?.toISOString() ?? null,
            plan: plan ? { ...serializePlanForClient(plan), isCustom: plan.isCustom } : null,
          }
        : null,
      entitlements: entitlements
        ? {
            hasAccess: entitlements.hasAccess,
            inGracePeriod: entitlements.inGracePeriod,
            limits: entitlements.limits,
            features: entitlements.features,
          }
        : null,
      usage,
      aiBillingMode,
      aiCredits: aiBillingMode === "PLATFORM_CREDITS" ? (await getOrganizationAiCreditsBalance(organizationId)).wallet : null,
      aiCreditPackages:
        aiBillingMode === "PLATFORM_CREDITS" ? await listActiveAiCreditPackages() : null,
    };
  });

  app.get("/ai-credits/packages", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const mode = await getOrganizationAiBillingMode(organizationId);
    if (mode !== "PLATFORM_CREDITS") {
      return reply.status(400).send({
        error: "not_platform_credits",
        message: "AI credit packages are only available in PLATFORM_CREDITS mode",
        statusCode: 400,
      });
    }
    return { packages: await listActiveAiCreditPackages() };
  });

  app.post("/ai-credits/checkout", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = aiCreditCheckoutBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    try {
      const result = await createAiCreditPurchaseCheckout({
        organizationId,
        packageId: parsed.data.packageId,
        actorUserId: request.user!.id,
        provider: parsed.data.provider,
        paymentMethod: parsed.data.paymentMethod,
        payerIdentificationNumber: parsed.data.payerIdentificationNumber,
        ip: clientIp(request),
      });
      return result;
    } catch (err) {
      sendAiCreditPurchaseError(reply, err);
      return;
    }
  });

  app.get("/ai-credits/balance", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return getOrganizationAiCreditsBalance(organizationId);
  });

  app.get("/ai-credits/usage", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 24;
    return { records: await listOrganizationAiUsageRecords(organizationId, limit) };
  });

  app.get("/ai-credits/purchases", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const mode = await getOrganizationAiBillingMode(organizationId);
    if (mode !== "PLATFORM_CREDITS") {
      return reply.status(400).send({
        error: "not_platform_credits",
        message: "AI credit purchases are only available in PLATFORM_CREDITS mode",
        statusCode: 400,
      });
    }
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
    const { listOrganizationAiCreditPurchases } = await import("../lib/ai-billing/AiCreditPurchaseService.js");
    return { purchases: await listOrganizationAiCreditPurchases(organizationId, limit) };
  });

  app.get("/usage", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return { usage: await getOrganizationUsage(organizationId) };
  });

  app.get("/plans", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const [plans, sub, providers] = await Promise.all([
      listPlansForOrganization(organizationId),
      prisma.organizationSubscription.findUnique({
        where: { organizationId },
        select: { planId: true },
      }),
      getBillingProvidersClientConfig(organizationId),
    ]);

    return {
      plans: plans.map((p) => {
        const planProviders = parsePlanPaymentProviders(p.features, {
          amountCents: p.amountCents,
          stripePriceId: p.stripePriceId,
          mercadopagoPlanId: p.mercadopagoPlanId,
        });
        const stripeCheckoutReady =
          planProviders.stripe && (p.amountCents <= 0 || Boolean(p.stripePriceId?.trim()));
        const mercadoPagoCheckoutReady = planProviders.mercadopago && p.amountCents > 0;
        return {
          ...serializePlanForClient(p),
          isCurrent: sub?.planId === p.id,
          isCustom: p.isCustom,
          paymentProviders: planProviders,
          requiresCheckout:
            p.amountCents > 0 && (stripeCheckoutReady || mercadoPagoCheckoutReady),
          isFree: p.amountCents <= 0,
          stripeReady: stripeCheckoutReady,
          mercadopagoReady: mercadoPagoCheckoutReady,
          checkoutProviders: {
            stripe:
              providers.stripe.configured && providers.stripe.enabled && stripeCheckoutReady,
            mercadopago:
              providers.mercadopago.connected &&
              providers.mercadopago.enabled &&
              mercadoPagoCheckoutReady,
          },
        };
      }),
      catalogMode: plans.some((p) => p.isCustom) ? ("custom" as const) : ("global" as const),
    };
  });

  app.post("/select-plan", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const body = planIdBodySchema.parse(request.body);
    const plan = await prisma.plan.findFirst({
      where: { id: body.planId, isActive: true },
      select: { id: true, amountCents: true },
    });
    if (!plan) {
      return reply.status(404).send({
        error: "Not Found",
        message: "Plan not found or inactive",
        statusCode: 404,
      });
    }
    if (plan.amountCents > 0) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Paid plans require checkout via a payment provider",
        statusCode: 400,
      });
    }

    try {
      await applyCatalogPlanToOrganization(organizationId, plan.id);
      return { ok: true };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.get("/invoices", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    try {
      const invoices = await provider.listInvoices(organizationId);
      return { invoices, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/checkout", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const body = planIdBodySchema.parse(request.body);
    let providerName: PaymentProviderName;
    try {
      providerName = await resolveCheckoutProvider(organizationId, body.planId, body.provider);
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    const actorUserId = request.user!.id;

    try {
      const result = await provider.createCheckoutSession({
        organizationId,
        planId: body.planId,
        actorUserId,
        ip: clientIp(request),
        paymentMethod: body.paymentMethod,
        payerIdentificationNumber: body.payerIdentificationNumber,
      });
      return { ...result, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.get<{ Params: { sessionId: string } }>("/checkout/:sessionId/status", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    try {
      const aiStatus = await getAiCreditPurchaseCheckoutStatus(organizationId, request.params.sessionId);
      return { ...aiStatus, provider: "mercadopago", kind: "ai_credits" as const };
    } catch (err) {
      if (!(err instanceof AiCreditPurchaseError && err.code === "checkout_not_found")) {
        sendAiCreditPurchaseError(reply, err);
        return;
      }
    }

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    if (providerName !== "mercadopago") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Checkout status polling is only supported for Mercado Pago Pix sessions",
        statusCode: 400,
      });
    }

    try {
      const { getMercadoPagoCheckoutStatus } = await import(
        "../lib/billing/mercadopago/MercadoPagoPixPaymentService.js"
      );
      const status = await getMercadoPagoCheckoutStatus(organizationId, request.params.sessionId);
      return { ...status, provider: providerName };
    } catch (err) {
      if (err instanceof BillingError && err.code === "checkout_not_found") {
        return reply.status(404).send({
          error: err.code,
          message: err.message,
          statusCode: 404,
        });
      }
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/portal", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    const body = portalBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      const result = await provider.createPortalSession({
        organizationId,
        actorUserId,
        returnUrl: body.returnUrl,
        ip: clientIp(request),
      });
      return { ...result, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/change-plan", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    const body = planIdBodySchema.parse(request.body);
    const actorUserId = request.user!.id;

    try {
      await provider.changePlan({
        organizationId,
        planId: body.planId,
        actorUserId,
        ip: clientIp(request),
      });
      return { ok: true, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/cancel", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    const body = cancelBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      await provider.cancelSubscription({
        organizationId,
        actorUserId,
        cancelAtPeriodEnd: body.cancelAtPeriodEnd,
        ip: clientIp(request),
      });
      return { ok: true, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/setup-payment-method", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    const body = portalBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      const result = await provider.createPaymentMethodSetupSession({
        organizationId,
        actorUserId,
        returnUrl: body.returnUrl,
        ip: clientIp(request),
      });
      return { ...result, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/update-payment-method", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    const body = portalBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      const result = await provider.createPaymentMethodPortalSession({
        organizationId,
        actorUserId,
        returnUrl: body.returnUrl,
        ip: clientIp(request),
      });
      return { ...result, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/resume", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const providerName = await resolveOrganizationPaymentProvider(organizationId);
    const provider = getBillingProvider(providerName);
    if (!(await provider.isConfigured({ organizationId }))) {
      providerNotConfiguredReply(reply, providerName);
      return;
    }

    const actorUserId = request.user!.id;

    try {
      await provider.resumeSubscription({
        organizationId,
        actorUserId,
        ip: clientIp(request),
      });
      return { ok: true, provider: providerName };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });
}
