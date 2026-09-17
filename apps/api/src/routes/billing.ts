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
  parsePlanLimitEnabledFlags,
  parsePlanLimits,
  getOrganizationUsage,
  applyCatalogPlanToOrganization,
  listPlansForOrganization,
  computePaymentGraceInfo,
  getBillingProvider,
  getBillingProvidersClientConfig,
  resolveDefaultPaymentProvider,
  resolveOrganizationPaymentProvider,
  subscriptionIsProviderManaged,
  type PaymentProviderName,
} from "../lib/billing/index.js";

const planIdBodySchema = z.object({
  planId: z.string().uuid(),
  provider: z.enum(["stripe", "mercadopago"]).optional(),
});

const portalBodySchema = z.object({
  returnUrl: z.string().url().max(2048).optional(),
});

const cancelBodySchema = z.object({
  cancelAtPeriodEnd: z.boolean().optional(),
});

function sendBillingError(reply: FastifyReply, err: unknown): void {
  if (err instanceof BillingError) {
    reply.status(400).send({
      error: err.code,
      message: err.message,
      statusCode: 400,
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
  requested?: PaymentProviderName,
): Promise<PaymentProviderName> {
  if (requested) return requested;
  const active = await resolveOrganizationPaymentProvider(organizationId);
  return active ?? resolveDefaultPaymentProvider();
}

function serializePlanForClient(plan: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
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
    currency: plan.currency,
    amountCents: plan.amountCents,
    interval: plan.interval,
    trialDays: plan.trialDays,
    displayOrder: plan.displayOrder ?? 0,
    limits: parsePlanLimits(plan.limits),
    limitEnabled: parsePlanLimitEnabledFlags(plan.limits),
    features: parsePlanFeatures(plan.features),
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
      stripeConfigured: stripe.configured,
      publishableKey: stripe.publishableKey,
      providers,
      defaultProvider: resolveDefaultPaymentProvider(),
    };
  });

  app.get("/overview", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const [entitlements, usage, org, providers] = await Promise.all([
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
      stripeConfigured: providers.stripe.configured,
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
    };
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
      plans: plans.map((p) => ({
        ...serializePlanForClient(p),
        isCurrent: sub?.planId === p.id,
        isCustom: p.isCustom,
        requiresCheckout: p.amountCents > 0 && Boolean(p.stripePriceId || p.mercadopagoPlanId),
        isFree: p.amountCents <= 0,
        stripeReady: p.amountCents <= 0 || Boolean(p.stripePriceId?.trim()),
        mercadopagoReady: p.amountCents <= 0 || Boolean(p.mercadopagoPlanId?.trim()),
        checkoutProviders: {
          stripe: providers.stripe.configured && (p.amountCents <= 0 || Boolean(p.stripePriceId?.trim())),
          mercadopago:
            providers.mercadopago.connected && (p.amountCents <= 0 || Boolean(p.mercadopagoPlanId?.trim())),
        },
      })),
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
    const providerName = await resolveCheckoutProvider(organizationId, body.provider);
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
      });
      return { ...result, provider: providerName };
    } catch (err) {
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
