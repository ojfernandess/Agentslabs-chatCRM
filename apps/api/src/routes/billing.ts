import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { clientIp } from "../lib/audit.js";
import { isStripeBillingConfigured } from "../config.js";
import {
  BillingError,
  createBillingPortalSession,
  createCheckoutSession,
  cancelOrganizationSubscription,
  changeSubscriptionPlan,
  getEffectivePlanForOrganization,
  getStripePublishableKeyForClient,
  listOrganizationInvoices,
  parsePlanFeatures,
  parsePlanLimits,
  resumeScheduledCancellation,
  getOrganizationUsage,
  applyCatalogPlanToOrganization,
  listPlansForOrganization,
  computePaymentGraceInfo,
  createPaymentMethodSetupSession,
  createPaymentMethodPortalSession,
} from "../lib/billing/index.js";

const planIdBodySchema = z.object({
  planId: z.string().uuid(),
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
    features: parsePlanFeatures(plan.features),
  };
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);

  app.get("/config", async (_request, reply) => {
    return {
      stripeConfigured: isStripeBillingConfigured(),
      publishableKey: getStripePublishableKeyForClient(),
    };
  });

  app.get("/overview", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const [entitlements, usage, org] = await Promise.all([
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
                  isCustom: true,
                },
              },
            },
          },
        },
      }),
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
      stripeConfigured: isStripeBillingConfigured(),
      publishableKey: getStripePublishableKeyForClient(),
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
            stripeManaged: Boolean(sub.stripeSubscriptionId),
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

    const [plans, sub] = await Promise.all([
      listPlansForOrganization(organizationId),
      prisma.organizationSubscription.findUnique({
        where: { organizationId },
        select: { planId: true },
      }),
    ]);

    return {
      plans: plans.map((p) => ({
        ...serializePlanForClient(p),
        isCurrent: sub?.planId === p.id,
        isCustom: p.isCustom,
        requiresCheckout: p.amountCents > 0 && Boolean(p.stripePriceId),
        isFree: p.amountCents <= 0,
        stripeReady: p.amountCents <= 0 || Boolean(p.stripePriceId?.trim()),
      })),
      catalogMode: plans.some((p) => p.isCustom) ? "custom" as const : "global" as const,
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
        message: "Paid plans require Stripe checkout",
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

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    try {
      const invoices = await listOrganizationInvoices(organizationId);
      return { invoices };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/checkout", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const body = planIdBodySchema.parse(request.body);
    const actorUserId = request.user!.id;

    try {
      const result = await createCheckoutSession({
        organizationId,
        planId: body.planId,
        actorUserId,
        ip: clientIp(request),
      });
      return result;
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/portal", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const body = portalBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      return await createBillingPortalSession({
        organizationId,
        actorUserId,
        returnUrl: body.returnUrl,
        ip: clientIp(request),
      });
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/change-plan", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const body = planIdBodySchema.parse(request.body);
    const actorUserId = request.user!.id;

    try {
      await changeSubscriptionPlan({
        organizationId,
        planId: body.planId,
        actorUserId,
        ip: clientIp(request),
      });
      return { ok: true };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/cancel", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const body = cancelBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      await cancelOrganizationSubscription({
        organizationId,
        actorUserId,
        cancelAtPeriodEnd: body.cancelAtPeriodEnd,
        ip: clientIp(request),
      });
      return { ok: true };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/setup-payment-method", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const body = portalBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      return await createPaymentMethodSetupSession({
        organizationId,
        actorUserId,
        returnUrl: body.returnUrl,
        ip: clientIp(request),
      });
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/update-payment-method", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const body = portalBodySchema.parse(request.body ?? {});
    const actorUserId = request.user!.id;

    try {
      return await createPaymentMethodPortalSession({
        organizationId,
        actorUserId,
        returnUrl: body.returnUrl,
        ip: clientIp(request),
      });
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });

  app.post("/resume", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const actorUserId = request.user!.id;

    try {
      await resumeScheduledCancellation({
        organizationId,
        actorUserId,
        ip: clientIp(request),
      });
      return { ok: true };
    } catch (err) {
      sendBillingError(reply, err);
      return;
    }
  });
}
