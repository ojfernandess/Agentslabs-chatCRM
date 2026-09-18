import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import { clientIp, recordAuditLog } from "../lib/audit.js";
import { config } from "../config.js";
import {
  getBillingPlatformSettings,
  patchBillingPlatformSettings,
} from "../lib/billing/billingSettings.js";
import {
  clearAllOrganizationStripeBindings,
  clearPlanStripeIds,
} from "../lib/billing/clearStripeBindings.js";
import { getStripeKeyMode } from "../lib/billing/stripeErrors.js";
import {
  parsePlanExtras,
  parsePlanFeatures,
  parsePlanLimitEnabledFlags,
  parsePlanLimits,
  parsePlanPaymentProviders,
  applyPlanPaymentProvidersToFeatures,
  type PlanPaymentProviders,
} from "../lib/billing/billingTypes.js";
import { BillingError } from "../lib/billing/StripeCustomerService.js";
import {
  createCustomPlanForOrganization,
  deleteCustomPlan,
  listCustomPlans,
  updateCustomPlan,
} from "../lib/billing/customPlanService.js";
import { sendOrganizationPaymentReminder } from "../lib/billing/billingEmailNotifications.js";
import { updateStripeCustomerFromOrganization } from "../lib/billing/StripeCustomerService.js";
import { mercadoPagoBillingErrorHttpStatus } from "../lib/billing/mercadopago/mercadoPagoClient.js";
import { syncPlanToMercadoPago } from "../lib/billing/mercadopago/MercadoPagoPlanService.js";
import {
  getSuperBillingProviderDiagnostics,
  testSuperBillingProviderConnectivity,
} from "../lib/billing/superBillingProviderDiagnostics.js";
import { patchMercadoPagoBillingPlatformSettings } from "../lib/billing/mercadoPagoBillingSettings.js";
import {
  getPaymentProviderPlatformDiagnostics,
  patchPaymentProviderPlatformSettings,
} from "../lib/billing/paymentProviderPlatformSettings.js";
import {
  createAiModelPricingVersion,
  listActiveAiModelPricing,
} from "../lib/ai-billing/AiPricingService.js";
import {
  createAiCreditPackage,
  listAllAiCreditPackages,
  updateAiCreditPackage,
} from "../lib/ai-billing/AiCreditPackageService.js";
import {
  getAiPlatformMarkupSettings,
  patchAiPlatformMarkupSettings,
} from "../lib/ai-billing/aiPlatformMarkupSettings.js";
import { creditAiWallet } from "../lib/ai-billing/AiWalletService.js";
import { getOrganizationAiCreditsBalance, getOrganizationAiCreditsFinancialSummary } from "../lib/ai-billing/AiUsageBillingService.js";
import { listAllAiCreditPurchases } from "../lib/ai-billing/AiCreditPurchaseService.js";
import { money, moneyToApiString } from "../lib/ai-billing/money.js";
import { ensureMercadoPagoSubscriptionBillingPeriod } from "../lib/billing/subscriptionSync.js";

const jsonLimitsSchema = z.record(z.unknown()).optional();

const paymentProvidersSchema = z.object({
  stripe: z.boolean(),
  mercadopago: z.boolean(),
});

const createPlanSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).nullable().optional(),
  currency: z.string().min(3).max(8).default("BRL"),
  amountCents: z.number().int().min(0),
  interval: z.enum(["month", "year"]).default("month"),
  trialDays: z.union([z.number().int().min(0).max(365), z.null()]).optional(),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  stripeProductId: z.union([z.string().max(255), z.literal("")]).nullable().optional(),
  stripePriceId: z.union([z.string().max(255), z.literal("")]).nullable().optional(),
  mercadopagoPlanId: z.union([z.string().max(255), z.literal("")]).nullable().optional(),
  legacyPlanTier: z.enum(["free", "growth", "enterprise"]).nullable().optional(),
  limits: jsonLimitsSchema,
  features: jsonLimitsSchema,
  planExtras: jsonLimitsSchema,
  paymentProviders: paymentProvidersSchema.optional(),
});

const patchPlanSchema = createPlanSchema.partial().omit({ slug: true }).extend({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
});

const overageDimensionPatchSchema = z.object({
  enabled: z.boolean().optional(),
  stripeMeterEventName: z.union([z.string().max(255), z.literal("")]).nullable().optional(),
  unitAmountCents: z.union([z.number().int().min(0), z.null()]).optional(),
});

const resetStripeBindingsSchema = z.object({
  clearPlanStripeIds: z.boolean().optional().default(false),
});

const billingSettingsPatchSchema = z
  .object({
    gracePeriodDays: z.number().int().min(0).max(90).optional(),
    limitEnforcementMode: z.enum(["block", "overage"]).optional(),
    overage: z.record(z.string().min(1).max(64), overageDimensionPatchSchema).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one setting field is required" });

const customPlanFieldsSchema = {
  name: z.string().min(1).max(120),
  description: z.string().max(4000).nullable().optional(),
  currency: z.string().min(3).max(8).default("BRL"),
  amountCents: z.number().int().min(0),
  interval: z.enum(["month", "year"]).default("month"),
  paymentGraceDays: z.number().int().min(1).max(90),
  stripeProductId: z.union([z.string().max(255), z.literal("")]).nullable().optional(),
  stripePriceId: z.union([z.string().max(255), z.literal("")]).nullable().optional(),
  mercadopagoPlanId: z.union([z.string().max(255), z.literal("")]).nullable().optional(),
  legacyPlanTier: z.enum(["free", "growth", "enterprise"]).nullable().optional(),
  limits: jsonLimitsSchema,
  features: jsonLimitsSchema,
  planExtras: jsonLimitsSchema,
  trialDays: z.union([z.number().int().min(0).max(365), z.null()]).optional(),
  isActive: z.boolean().optional(),
  paymentProviders: paymentProvidersSchema.optional(),
};

const createCustomPlanSchema = z.object({
  organizationId: z.string().uuid(),
  ...customPlanFieldsSchema,
});

const patchCustomPlanSchema = z.object(customPlanFieldsSchema).partial();

const subscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().max(32).optional(),
  q: z.string().max(200).optional(),
});

const billingEmailPatchSchema = z.object({
  billingEmail: z.union([z.string().email(), z.literal("")]),
});

const syncMercadoPagoPlanSchema = z.object({
  forceRecreate: z.boolean().optional(),
});

const sendPaymentReminderSchema = z.object({
  billingEmail: z.union([z.string().email(), z.literal("")]).optional(),
});

const testPaymentProviderSchema = z.object({
  provider: z.enum(["stripe", "mercadopago", "all"]).optional().default("all"),
});

const mercadoPagoModeSchema = z.object({
  mode: z.enum(["sandbox", "production"]),
});

const paymentProviderTogglesSchema = z
  .object({
    stripe: z.object({ enabled: z.boolean() }).optional(),
    mercadopago: z.object({ enabled: z.boolean() }).optional(),
  })
  .refine((body) => body.stripe != null || body.mercadopago != null, {
    message: "At least one provider toggle is required",
  });

function serializePlan(plan: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  currency: string;
  amountCents: number;
  interval: string;
  trialDays: number | null;
  displayOrder: number;
  isActive: boolean;
  stripeProductId: string | null;
  stripePriceId: string | null;
  mercadopagoPlanId: string | null;
  legacyPlanTier: string | null;
  isCustom?: boolean;
  organizationId?: string | null;
  paymentGraceDays?: number | null;
  limits: unknown;
  features: unknown;
  planExtras?: unknown;
  createdAt: Date;
  updatedAt: Date;
  _count?: { subscriptions: number };
  organization?: { id: string; name: string; slug: string } | null;
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
    displayOrder: plan.displayOrder,
    isActive: plan.isActive,
    stripeProductId: plan.stripeProductId,
    stripePriceId: plan.stripePriceId,
    mercadopagoPlanId: plan.mercadopagoPlanId,
    legacyPlanTier: plan.legacyPlanTier,
    isCustom: plan.isCustom ?? false,
    organizationId: plan.organizationId ?? null,
    paymentGraceDays: plan.paymentGraceDays ?? null,
    organization: plan.organization ?? null,
    limits: parsePlanLimits(plan.limits),
    limitEnabled: parsePlanLimitEnabledFlags(plan.limits),
    features: parsePlanFeatures(plan.features),
    paymentProviders: parsePlanPaymentProviders(plan.features, {
      amountCents: plan.amountCents,
      stripePriceId: plan.stripePriceId,
      mercadopagoPlanId: plan.mercadopagoPlanId,
    }),
    planExtras: parsePlanExtras(plan.planExtras ?? {}),
    subscriptionCount: plan._count?.subscriptions ?? 0,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function normalizeExternalId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

async function assertMercadoPagoPlanSyncAllowed(): Promise<void> {
  const toggles = await getPaymentProviderPlatformDiagnostics();
  if (!toggles.mercadopago.enabled) {
    throw new BillingError(
      "Mercado Pago billing is disabled. Enable it in Super Admin → Integrações de pagamento.",
      "mercadopago_not_configured",
    );
  }
  if (!toggles.mercadopagoReady) {
    throw new BillingError(
      "Mercado Pago is not configured. Set MERCADOPAGO_* tokens and active mode in Super Admin.",
      "mercadopago_not_configured",
    );
  }
}

function resolvePlanPaymentProvidersInput(
  input: PlanPaymentProviders | undefined,
  fallback: {
    features?: unknown;
    stripePriceId?: string | null;
    mercadopagoPlanId?: string | null;
    amountCents: number;
  },
): PlanPaymentProviders {
  if (input) return input;
  return parsePlanPaymentProviders(fallback.features, fallback);
}

function assertPaidPlanPaymentProviders(amountCents: number, paymentProviders: PlanPaymentProviders): void {
  if (amountCents <= 0) return;
  if (!paymentProviders.stripe && !paymentProviders.mercadopago) {
    throw new BillingError(
      "Paid plans require at least one payment provider (Stripe or Mercado Pago)",
      "plan_not_billing_ready",
    );
  }
}

async function maybeSyncMercadoPagoPlanOnSave(planId: string) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      _count: { select: { subscriptions: true } },
    },
  });
  if (!plan) return null;

  const providers = parsePlanPaymentProviders(plan.features, {
    amountCents: plan.amountCents,
    mercadopagoPlanId: plan.mercadopagoPlanId,
  });
  if (plan.amountCents <= 0 || !providers.mercadopago || plan.mercadopagoPlanId?.trim()) {
    return plan;
  }

  try {
    await assertMercadoPagoPlanSyncAllowed();
    await syncPlanToMercadoPago(plan.id);
    return prisma.plan.findUnique({
      where: { id: plan.id },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        _count: { select: { subscriptions: true } },
      },
    });
  } catch {
    return plan;
  }
}

export async function superBillingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get("/settings", async () => {
    const settings = await getBillingPlatformSettings();
    const providerToggles = await getPaymentProviderPlatformDiagnostics();
    return {
      settings,
      stripeKeyMode: getStripeKeyMode(config.stripeSecretKey),
      mercadoPagoPlatformConfigured: providerToggles.mercadopagoReady,
      paymentProviders: providerToggles,
    };
  });

  app.get("/payment-providers", async () => {
    const diagnostics = await getSuperBillingProviderDiagnostics();
    return { diagnostics };
  });

  app.post("/payment-providers/test", async (request, reply) => {
    const parsed = testPaymentProviderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const test = await testSuperBillingProviderConnectivity(parsed.data.provider);

    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.payment_providers.test",
      resourceType: "billing_settings",
      metadata: {
        provider: parsed.data.provider,
        results: Object.fromEntries(
          Object.entries(test.results).map(([key, value]) => [key, { ok: value.ok, message: value.message }]),
        ),
      },
      ip: clientIp(request),
    });

    return test;
  });

  app.patch("/payment-providers/mercadopago", async (request, reply) => {
    const parsed = mercadoPagoModeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const settings = await patchMercadoPagoBillingPlatformSettings({ mode: parsed.data.mode });
    const diagnostics = await getSuperBillingProviderDiagnostics();

    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.mercadopago_mode.update",
      resourceType: "billing_settings",
      metadata: { mode: settings.mode },
      ip: clientIp(request),
    });

    return {
      settings,
      billingMode: diagnostics.mercadopago.billingMode,
    };
  });

  app.patch("/payment-providers", async (request, reply) => {
    const parsed = paymentProviderTogglesSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const settings = await patchPaymentProviderPlatformSettings(parsed.data);
    const diagnostics = await getSuperBillingProviderDiagnostics();

    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.payment_providers.update",
      resourceType: "billing_settings",
      metadata: settings,
      ip: clientIp(request),
    });

    return {
      settings,
      diagnostics: diagnostics.providerToggles,
    };
  });

  app.post("/reset-stripe-bindings", async (request, reply) => {
    const parsed = resetStripeBindingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const orgBindings = await clearAllOrganizationStripeBindings();
    const planBindings = parsed.data.clearPlanStripeIds ? await clearPlanStripeIds() : { plansCleared: 0 };

    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.stripe_bindings_reset",
      resourceType: "billing_settings",
      metadata: {
        clearPlanStripeIds: parsed.data.clearPlanStripeIds,
        ...orgBindings,
        ...planBindings,
      },
      ip: clientIp(request),
    });

    return {
      stripeKeyMode: getStripeKeyMode(config.stripeSecretKey),
      organizationsCleared: orgBindings.organizationsCleared,
      subscriptionsCleared: orgBindings.subscriptionsCleared,
      plansCleared: planBindings.plansCleared,
    };
  });

  app.patch("/settings", async (request, reply) => {
    const parsed = billingSettingsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const settings = await patchBillingPlatformSettings({
      gracePeriodDays: parsed.data.gracePeriodDays,
      limitEnforcementMode: parsed.data.limitEnforcementMode,
      overage: parsed.data.overage,
    });
    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.settings.update",
      resourceType: "billing_settings",
      metadata: parsed.data,
      ip: clientIp(request),
    });
    return { settings };
  });

  app.get("/plans", async () => {
    const plans = await prisma.plan.findMany({
      where: { isCustom: false, organizationId: null },
      orderBy: [{ displayOrder: "asc" }, { amountCents: "asc" }],
      include: { _count: { select: { subscriptions: true } } },
    });
    return { plans: plans.map(serializePlan) };
  });

  app.get("/custom-plans", async (request) => {
    const q = request.query as { organizationId?: string };
    const orgId = q.organizationId?.trim();
    const plans = await listCustomPlans(orgId || undefined);
    return {
      plans: plans.map((p) =>
        serializePlan({
          ...p,
          organization: p.organization,
        }),
      ),
    };
  });

  app.patch<{ Params: { id: string } }>("/custom-plans/:id", async (request, reply) => {
    const parsed = patchCustomPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const p = parsed.data;
    try {
      const plan = await updateCustomPlan(request.params.id, {
        name: p.name,
        description: p.description,
        currency: p.currency,
        amountCents: p.amountCents,
        interval: p.interval,
        paymentGraceDays: p.paymentGraceDays,
        stripeProductId: normalizeExternalId(p.stripeProductId),
        stripePriceId: normalizeExternalId(p.stripePriceId),
        mercadopagoPlanId: normalizeExternalId(p.mercadopagoPlanId),
        legacyPlanTier: p.legacyPlanTier ?? undefined,
        limits: p.limits,
        features: p.features,
        planExtras: p.planExtras,
        trialDays: p.trialDays,
        isActive: p.isActive,
        paymentProviders: p.paymentProviders,
      });

      const saved = (await maybeSyncMercadoPagoPlanOnSave(plan.id)) ?? plan;

      await recordAuditLog({
        actorUserId: request.user!.id,
        organizationId: plan.organizationId ?? undefined,
        action: "super.billing.custom_plan.update",
        resourceType: "plan",
        resourceId: saved.id,
        metadata: { patch: p },
        ip: clientIp(request),
      });

      return { plan: serializePlan(saved) };
    } catch (err) {
      if (err instanceof BillingError) {
        return reply.status(err.code === "plan_not_found" ? 404 : 400).send({
          error: err.code,
          message: err.message,
          statusCode: err.code === "plan_not_found" ? 404 : 400,
        });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/custom-plans/:id", async (request, reply) => {
    try {
      await deleteCustomPlan(request.params.id);

      await recordAuditLog({
        actorUserId: request.user!.id,
        action: "super.billing.custom_plan.delete",
        resourceType: "plan",
        resourceId: request.params.id,
        ip: clientIp(request),
      });

      return reply.status(204).send();
    } catch (err) {
      if (err instanceof BillingError) {
        return reply.status(err.code === "plan_not_found" ? 404 : 400).send({
          error: err.code,
          message: err.message,
          statusCode: err.code === "plan_not_found" ? 404 : 400,
        });
      }
      throw err;
    }
  });

  app.post("/custom-plans", async (request, reply) => {
    const parsed = createCustomPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const p = parsed.data;
    try {
      const plan = await createCustomPlanForOrganization({
        organizationId: p.organizationId,
        name: p.name,
        description: p.description,
        currency: p.currency,
        amountCents: p.amountCents,
        interval: p.interval,
        paymentGraceDays: p.paymentGraceDays,
        stripeProductId: normalizeExternalId(p.stripeProductId),
        stripePriceId: normalizeExternalId(p.stripePriceId),
        mercadopagoPlanId: normalizeExternalId(p.mercadopagoPlanId),
        legacyPlanTier: p.legacyPlanTier ?? null,
        limits: p.limits,
        features: p.features,
        planExtras: p.planExtras,
        trialDays: p.trialDays,
        paymentProviders: p.paymentProviders,
      });

      const saved = (await maybeSyncMercadoPagoPlanOnSave(plan.id)) ?? plan;

      await recordAuditLog({
        actorUserId: request.user!.id,
        organizationId: p.organizationId,
        action: "super.billing.custom_plan.create",
        resourceType: "plan",
        resourceId: saved.id,
        metadata: { name: saved.name, organizationId: p.organizationId },
        ip: clientIp(request),
      });

      return reply.status(201).send({
        plan: serializePlan({ ...saved, _count: { subscriptions: 1 } }),
      });
    } catch (err) {
      if (err instanceof BillingError) {
        return reply.status(400).send({
          error: err.code,
          message: err.message,
          statusCode: 400,
        });
      }
      throw err;
    }
  });

  app.post("/plans", async (request, reply) => {
    const parsed = createPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const p = parsed.data;
    const existing = await prisma.plan.findUnique({ where: { slug: p.slug } });
    if (existing) {
      return reply.status(409).send({ error: "Conflict", message: "Plan slug already exists", statusCode: 409 });
    }

    const paymentProviders = resolvePlanPaymentProvidersInput(p.paymentProviders, {
      features: p.features,
      stripePriceId: p.stripePriceId,
      mercadopagoPlanId: p.mercadopagoPlanId,
      amountCents: p.amountCents,
    });
    assertPaidPlanPaymentProviders(p.amountCents, paymentProviders);

    try {
      const plan = await prisma.plan.create({
        data: {
          slug: p.slug,
          name: p.name.trim(),
          description: p.description?.trim() || null,
          currency: p.currency.toUpperCase(),
          amountCents: p.amountCents,
          interval: p.interval,
          trialDays: p.trialDays ?? null,
          displayOrder: p.displayOrder ?? 0,
          isActive: p.isActive ?? true,
          stripeProductId: paymentProviders.stripe ? normalizeExternalId(p.stripeProductId) : null,
          stripePriceId: paymentProviders.stripe ? normalizeExternalId(p.stripePriceId) : null,
          mercadopagoPlanId: paymentProviders.mercadopago ? normalizeExternalId(p.mercadopagoPlanId) : null,
          legacyPlanTier: p.legacyPlanTier ?? null,
          limits: (p.limits ?? {}) as Prisma.InputJsonValue,
          features: applyPlanPaymentProvidersToFeatures(p.features, paymentProviders) as Prisma.InputJsonValue,
          planExtras: (p.planExtras ?? {}) as Prisma.InputJsonValue,
        },
        include: { _count: { select: { subscriptions: true } } },
      });

      const saved = (await maybeSyncMercadoPagoPlanOnSave(plan.id)) ?? plan;

      await recordAuditLog({
        actorUserId: request.user!.id,
        action: "super.billing.plan.create",
        resourceType: "plan",
        resourceId: saved.id,
        metadata: { slug: saved.slug, name: saved.name },
        ip: clientIp(request),
      });

      return reply.status(201).send({ plan: serializePlan(saved) });
    } catch (err) {
      if (err instanceof BillingError) {
        return reply.status(400).send({
          error: err.code,
          message: err.message,
          statusCode: 400,
        });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    const parsed = patchPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const p = parsed.data;

    if (p.slug) {
      const slugConflict = await prisma.plan.findFirst({
        where: { slug: p.slug, NOT: { id: request.params.id } },
        select: { id: true },
      });
      if (slugConflict) {
        return reply.status(409).send({ error: "Conflict", message: "Plan slug already exists", statusCode: 409 });
      }
    }

    try {
      const current = await prisma.plan.findUnique({
        where: { id: request.params.id },
        select: {
          amountCents: true,
          features: true,
          stripeProductId: true,
          stripePriceId: true,
          mercadopagoPlanId: true,
        },
      });
      if (!current) {
        return reply.status(404).send({ error: "Not Found", message: "Plan not found", statusCode: 404 });
      }

      const nextAmountCents = p.amountCents ?? current.amountCents;
      const paymentProviders = resolvePlanPaymentProvidersInput(p.paymentProviders, {
        features: p.features ?? current.features,
        stripePriceId: p.stripePriceId !== undefined ? p.stripePriceId : current.stripePriceId,
        mercadopagoPlanId:
          p.mercadopagoPlanId !== undefined ? p.mercadopagoPlanId : current.mercadopagoPlanId,
        amountCents: nextAmountCents,
      });
      assertPaidPlanPaymentProviders(nextAmountCents, paymentProviders);

      const data: Prisma.PlanUpdateInput = {};
      if (p.slug !== undefined) data.slug = p.slug;
      if (p.name !== undefined) data.name = p.name.trim();
      if (p.description !== undefined) data.description = p.description?.trim() || null;
      if (p.currency !== undefined) data.currency = p.currency.toUpperCase();
      if (p.amountCents !== undefined) data.amountCents = p.amountCents;
      if (p.interval !== undefined) data.interval = p.interval;
      if (p.trialDays !== undefined) data.trialDays = p.trialDays;
      if (p.displayOrder !== undefined) data.displayOrder = p.displayOrder;
      if (p.isActive !== undefined) data.isActive = p.isActive;
      if (p.stripeProductId !== undefined || p.paymentProviders !== undefined) {
        const value = p.stripeProductId !== undefined ? p.stripeProductId : current.stripeProductId;
        data.stripeProductId = paymentProviders.stripe ? normalizeExternalId(value) : null;
      }
      if (p.stripePriceId !== undefined || p.paymentProviders !== undefined) {
        const value = p.stripePriceId !== undefined ? p.stripePriceId : current.stripePriceId;
        data.stripePriceId = paymentProviders.stripe ? normalizeExternalId(value) : null;
      }
      if (p.mercadopagoPlanId !== undefined || p.paymentProviders !== undefined) {
        const value = p.mercadopagoPlanId !== undefined ? p.mercadopagoPlanId : current.mercadopagoPlanId;
        data.mercadopagoPlanId = paymentProviders.mercadopago ? normalizeExternalId(value) : null;
      }
      if (p.legacyPlanTier !== undefined) data.legacyPlanTier = p.legacyPlanTier;
      if (p.limits !== undefined) data.limits = p.limits as Prisma.InputJsonValue;
      if (p.planExtras !== undefined) data.planExtras = p.planExtras as Prisma.InputJsonValue;
      if (p.features !== undefined || p.paymentProviders !== undefined) {
        data.features = applyPlanPaymentProvidersToFeatures(
          (p.features ?? (current.features as Record<string, unknown>)) as Record<string, unknown>,
          paymentProviders,
        ) as Prisma.InputJsonValue;
      }

      const plan = await prisma.plan.update({
        where: { id: request.params.id },
        data,
        include: { _count: { select: { subscriptions: true } } },
      });

      const saved = (await maybeSyncMercadoPagoPlanOnSave(plan.id)) ?? plan;

      await recordAuditLog({
        actorUserId: request.user!.id,
        action: "super.billing.plan.update",
        resourceType: "plan",
        resourceId: saved.id,
        metadata: { patch: p },
        ip: clientIp(request),
      });

      return { plan: serializePlan(saved) };
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Plan not found", statusCode: 404 });
    }
  });

  app.post<{ Params: { id: string } }>("/plans/:id/sync-mercadopago", async (request, reply) => {
    const parsed = syncMercadoPagoPlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    try {
      await assertMercadoPagoPlanSyncAllowed();
      const result = await syncPlanToMercadoPago(request.params.id, {
        forceRecreate: parsed.data.forceRecreate,
      });

      await recordAuditLog({
        actorUserId: request.user!.id,
        action: "super.billing.plan.sync_mercadopago",
        resourceType: "plan",
        resourceId: request.params.id,
        metadata: result,
        ip: clientIp(request),
      });

      const plan = await prisma.plan.findUnique({
        where: { id: request.params.id },
        include: { _count: { select: { subscriptions: true } } },
      });
      return {
        sync: result,
        plan: plan ? serializePlan(plan) : null,
      };
    } catch (err) {
      if (err instanceof BillingError) {
        const statusCode = err.code === "plan_not_found" ? 404 : mercadoPagoBillingErrorHttpStatus(err);
        return reply.status(statusCode).send({
          error: err.code,
          message: err.message,
          statusCode,
        });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/custom-plans/:id/sync-mercadopago", async (request, reply) => {
    const parsed = syncMercadoPagoPlanSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const customPlan = await prisma.plan.findFirst({
      where: { id: request.params.id, isCustom: true },
      select: { id: true, organizationId: true },
    });
    if (!customPlan) {
      return reply.status(404).send({ error: "Not Found", message: "Custom plan not found", statusCode: 404 });
    }

    try {
      await assertMercadoPagoPlanSyncAllowed();
      const result = await syncPlanToMercadoPago(request.params.id, {
        forceRecreate: parsed.data.forceRecreate,
      });

      await recordAuditLog({
        actorUserId: request.user!.id,
        organizationId: customPlan.organizationId ?? undefined,
        action: "super.billing.custom_plan.sync_mercadopago",
        resourceType: "plan",
        resourceId: request.params.id,
        metadata: result,
        ip: clientIp(request),
      });

      const plan = await prisma.plan.findUnique({
        where: { id: request.params.id },
        include: {
          organization: { select: { id: true, name: true, slug: true } },
          _count: { select: { subscriptions: true } },
        },
      });
      return {
        sync: result,
        plan: plan ? serializePlan(plan) : null,
      };
    } catch (err) {
      if (err instanceof BillingError) {
        const statusCode = err.code === "plan_not_found" ? 404 : mercadoPagoBillingErrorHttpStatus(err);
        return reply.status(statusCode).send({
          error: err.code,
          message: err.message,
          statusCode,
        });
      }
      throw err;
    }
  });

  app.get("/subscriptions", async (request) => {
    const query = subscriptionsQuerySchema.parse(request.query);
    const where: Prisma.OrganizationSubscriptionWhereInput = {};
    if (query.status?.trim()) where.status = query.status.trim();
    if (query.q?.trim()) {
      where.organization = {
        OR: [
          { name: { contains: query.q.trim(), mode: "insensitive" } },
          { slug: { contains: query.q.trim(), mode: "insensitive" } },
        ],
      };
    }

    const [total, rows] = await Promise.all([
      prisma.organizationSubscription.count({ where }),
      prisma.organizationSubscription.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              planTier: true,
              billingEmail: true,
              isActive: true,
              stripeCustomerId: true,
            },
          },
          plan: {
            select: {
              id: true,
              slug: true,
              name: true,
              amountCents: true,
              currency: true,
              interval: true,
            },
          },
        },
      }),
    ]);

    const backfillCandidates = rows.filter(
      (s) =>
        s.paymentProvider === "mercadopago" &&
        !s.currentPeriodEnd &&
        (s.status === "active" || s.status === "trialing") &&
        s.plan?.interval,
    );
    let displayRows = rows;
    if (backfillCandidates.length > 0) {
      await Promise.all(
        backfillCandidates.map((s) =>
          ensureMercadoPagoSubscriptionBillingPeriod(s.organizationId).catch(() => {}),
        ),
      );
      displayRows = await prisma.organizationSubscription.findMany({
        where: { id: { in: backfillCandidates.map((s) => s.id) } },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              planTier: true,
              billingEmail: true,
              isActive: true,
              stripeCustomerId: true,
            },
          },
          plan: {
            select: {
              id: true,
              slug: true,
              name: true,
              amountCents: true,
              currency: true,
              interval: true,
            },
          },
        },
      });
      const refreshedById = new Map(displayRows.map((s) => [s.id, s]));
      displayRows = rows.map((s) => refreshedById.get(s.id) ?? s);
    }

    return {
      total,
      page: query.page,
      limit: query.limit,
      subscriptions: displayRows.map((s) => ({
        id: s.id,
        organizationId: s.organizationId,
        organization: s.organization,
        plan: s.plan,
        status: s.status,
        stripeCustomerId: s.stripeCustomerId,
        stripeSubscriptionId: s.stripeSubscriptionId,
        stripePriceId: s.stripePriceId,
        currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
        paymentDueAt: s.paymentDueAt?.toISOString() ?? null,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        canceledAt: s.canceledAt?.toISOString() ?? null,
        trialEnd: s.trialEnd?.toISOString() ?? null,
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  });

  app.patch<{ Params: { organizationId: string } }>(
    "/organizations/:organizationId/billing-email",
    async (request, reply) => {
      const parsed = billingEmailPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const billingEmail = parsed.data.billingEmail === "" ? null : parsed.data.billingEmail.trim();
      try {
        const org = await prisma.organization.update({
          where: { id: request.params.organizationId },
          data: { billingEmail },
          select: { id: true, name: true, billingEmail: true },
        });

        await updateStripeCustomerFromOrganization(org.id);

        await recordAuditLog({
          actorUserId: request.user!.id,
          organizationId: org.id,
          action: "super.billing.billing_email.update",
          resourceType: "organization",
          resourceId: org.id,
          metadata: { billingEmail: org.billingEmail },
          ip: clientIp(request),
        });

        return { organizationId: org.id, billingEmail: org.billingEmail };
      } catch {
        return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
      }
    },
  );

  app.post<{ Params: { organizationId: string } }>(
    "/subscriptions/:organizationId/send-payment-reminder",
    async (request, reply) => {
      const parsed = sendPaymentReminderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const billingEmailOverride =
        parsed.data.billingEmail === "" ? null : parsed.data.billingEmail?.trim() || undefined;

      const result = await sendOrganizationPaymentReminder({
        organizationId: request.params.organizationId,
        billingEmail: billingEmailOverride,
        actorUserId: request.user!.id,
        ip: clientIp(request),
      });

      if (!result.ok) {
        const statusCode =
          result.error === "organization_not_found"
            ? 404
            : result.error === "billing_email_missing" || result.error === "resend_not_configured"
              ? 400
              : 502;
        const messages: Record<string, string> = {
          organization_not_found: "Organization not found",
          billing_email_missing: "Billing email is missing for this organization",
          resend_not_configured: "Resend is not configured",
        };
        return reply.status(statusCode).send({
          error: result.error,
          message: messages[result.error] ?? "Failed to send reminder",
          statusCode,
        });
      }

      await recordAuditLog({
        actorUserId: request.user!.id,
        organizationId: request.params.organizationId,
        action: "super.billing.payment_reminder.send",
        resourceType: "organization_subscription",
        resourceId: request.params.organizationId,
        metadata: { sentTo: result.sentTo },
        ip: clientIp(request),
      });

      return { ok: true, sentTo: result.sentTo };
    },
  );

  const aiCreditBodySchema = z.object({
    amount: z.union([z.string(), z.number()]),
    note: z.string().max(500).optional(),
    idempotencyKey: z.string().min(8).max(255).optional(),
  });

  const aiPricingBodySchema = z.object({
    provider: z.string().min(1).max(32),
    model: z.string().min(1).max(128),
    currency: z.string().min(3).max(8).optional(),
    inputPrice: z.union([z.string(), z.number()]),
    cachedInputPrice: z.union([z.string(), z.number()]).nullable().optional(),
    outputPrice: z.union([z.string(), z.number()]),
    reasoningPrice: z.union([z.string(), z.number()]).nullable().optional(),
  });

  const aiMarkupPatchSchema = z.object({
    globalMarkupPercent: z.number().min(0).max(500).optional(),
    modelMarkupPercent: z.record(z.string(), z.number().min(0).max(500)).optional(),
  });

  app.get("/ai-credits/pricing", async () => ({
    pricing: await listActiveAiModelPricing(),
    markup: await getAiPlatformMarkupSettings(),
  }));

  app.post("/ai-credits/pricing", async (request, reply) => {
    const parsed = aiPricingBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const pricing = await createAiModelPricingVersion(parsed.data);
    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.ai_credits.pricing.create",
      resourceType: "ai_model_pricing",
      resourceId: pricing.id,
      metadata: { provider: pricing.provider, model: pricing.model },
      ip: clientIp(request),
    });
    return { pricing };
  });

  app.patch("/ai-credits/markup", async (request, reply) => {
    const parsed = aiMarkupPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const markup = await patchAiPlatformMarkupSettings(parsed.data);
    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.ai_credits.markup.update",
      resourceType: "platform_settings",
      metadata: markup,
      ip: clientIp(request),
    });
    return { markup };
  });

  app.get<{ Params: { organizationId: string } }>(
    "/ai-credits/organizations/:organizationId/balance",
    async (request, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: request.params.organizationId },
      select: { id: true },
    });
    if (!org) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }
    return getOrganizationAiCreditsBalance(org.id);
    },
  );

  app.get<{ Params: { organizationId: string } }>(
    "/ai-credits/organizations/:organizationId/summary",
    async (request, reply) => {
      const summary = await getOrganizationAiCreditsFinancialSummary(request.params.organizationId);
      if (!summary) {
        return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
      }
      return {
        organization: summary.organization,
        wallet: summary.wallet,
        usageRecordCount: summary.usageRecordCount,
        creditsAvailable: moneyToApiString(summary.creditsAvailable),
        creditsConsumed: moneyToApiString(summary.creditsConsumed),
        providerCostUsd: moneyToApiString(summary.providerCostUsd),
        convertedCostBrl: moneyToApiString(summary.convertedCostBrl),
        billedBrl: moneyToApiString(summary.billedBrl),
        marginBrl: moneyToApiString(summary.marginBrl),
        usdBrlRate: summary.usdBrlRate,
      };
    },
  );

  app.post<{ Params: { organizationId: string } }>(
    "/ai-credits/organizations/:organizationId/credit",
    async (request, reply) => {
    const parsed = aiCreditBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const org = await prisma.organization.findUnique({
      where: { id: request.params.organizationId },
      select: { id: true },
    });
    if (!org) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }

    const idempotencyKey =
      parsed.data.idempotencyKey?.trim() ||
      `super-credit:${request.user!.id}:${org.id}:${Date.now()}`;
    const wallet = await creditAiWallet({
      organizationId: org.id,
      amount: money(parsed.data.amount),
      entryType: "CREDIT_ADJUSTMENT",
      idempotencyKey,
      referenceType: "super_admin_adjustment",
      referenceId: request.user!.id,
      metadata: { note: parsed.data.note ?? null },
    });

    await recordAuditLog({
      actorUserId: request.user!.id,
      organizationId: org.id,
      action: "super.billing.ai_credits.credit",
      resourceType: "organization_ai_wallet",
      resourceId: org.id,
      metadata: {
        amount: moneyToApiString(money(parsed.data.amount)),
        note: parsed.data.note ?? null,
        balanceAfter: wallet.balance,
      },
      ip: clientIp(request),
    });

    return { wallet: { ...wallet, balance: moneyToApiString(wallet.balance), reservedBalance: moneyToApiString(wallet.reservedBalance), availableBalance: moneyToApiString(wallet.availableBalance) } };
    },
  );

  const aiCreditPackageBodySchema = z.object({
    slug: z.string().min(2).max(64),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    creditAmount: z.union([z.string(), z.number()]),
    amountCents: z.number().int().positive(),
    currency: z.string().min(3).max(8).optional(),
    stripePriceId: z.string().max(255).nullable().optional(),
    displayOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  });

  const aiCreditPackagePatchSchema = aiCreditPackageBodySchema.partial();

  app.get("/ai-credits/packages", async () => ({
    packages: await listAllAiCreditPackages(),
  }));

  app.post("/ai-credits/packages", async (request, reply) => {
    const parsed = aiCreditPackageBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const pkg = await createAiCreditPackage(parsed.data);
    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.ai_credits.package.create",
      resourceType: "ai_credit_package",
      resourceId: pkg.id,
      metadata: { slug: pkg.slug },
      ip: clientIp(request),
    });
    return { package: pkg };
  });

  app.patch<{ Params: { packageId: string } }>("/ai-credits/packages/:packageId", async (request, reply) => {
    const parsed = aiCreditPackagePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    try {
      const pkg = await updateAiCreditPackage(request.params.packageId, parsed.data);
      await recordAuditLog({
        actorUserId: request.user!.id,
        action: "super.billing.ai_credits.package.update",
        resourceType: "ai_credit_package",
        resourceId: pkg.id,
        metadata: parsed.data,
        ip: clientIp(request),
      });
      return { package: pkg };
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Package not found", statusCode: 404 });
    }
  });

  app.get("/ai-credits/purchases", async (request) => {
    const query = request.query as { organizationId?: string; status?: string; limit?: string };
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
    return {
      purchases: await listAllAiCreditPurchases({
        organizationId: query.organizationId?.trim() || undefined,
        status: query.status?.trim() || undefined,
        limit,
      }),
    };
  });
}
