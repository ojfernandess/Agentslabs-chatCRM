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
import { parsePlanFeatures, parsePlanLimits } from "../lib/billing/billingTypes.js";
import { BillingError } from "../lib/billing/StripeCustomerService.js";
import {
  createCustomPlanForOrganization,
  listCustomPlans,
  updateCustomPlan,
} from "../lib/billing/customPlanService.js";

const jsonLimitsSchema = z.record(z.unknown()).optional();

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
  legacyPlanTier: z.enum(["free", "growth", "enterprise"]).nullable().optional(),
  limits: jsonLimitsSchema,
  features: jsonLimitsSchema,
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
    overage: z
      .object({
        agents: overageDimensionPatchSchema.optional(),
        automations: overageDimensionPatchSchema.optional(),
        contacts: overageDimensionPatchSchema.optional(),
        messages: overageDimensionPatchSchema.optional(),
      })
      .optional(),
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
  legacyPlanTier: z.enum(["free", "growth", "enterprise"]).nullable().optional(),
  limits: jsonLimitsSchema,
  features: jsonLimitsSchema,
  trialDays: z.union([z.number().int().min(0).max(365), z.null()]).optional(),
  isActive: z.boolean().optional(),
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
  legacyPlanTier: string | null;
  isCustom?: boolean;
  organizationId?: string | null;
  paymentGraceDays?: number | null;
  limits: unknown;
  features: unknown;
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
    legacyPlanTier: plan.legacyPlanTier,
    isCustom: plan.isCustom ?? false,
    organizationId: plan.organizationId ?? null,
    paymentGraceDays: plan.paymentGraceDays ?? null,
    organization: plan.organization ?? null,
    limits: parsePlanLimits(plan.limits),
    features: parsePlanFeatures(plan.features),
    subscriptionCount: plan._count?.subscriptions ?? 0,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function normalizeStripeId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

export async function superBillingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get("/settings", async () => {
    const settings = await getBillingPlatformSettings();
    return {
      settings,
      stripeKeyMode: getStripeKeyMode(config.stripeSecretKey),
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
        stripeProductId: normalizeStripeId(p.stripeProductId),
        stripePriceId: normalizeStripeId(p.stripePriceId),
        legacyPlanTier: p.legacyPlanTier ?? undefined,
        limits: p.limits,
        features: p.features,
        trialDays: p.trialDays,
        isActive: p.isActive,
      });

      await recordAuditLog({
        actorUserId: request.user!.id,
        organizationId: plan.organizationId ?? undefined,
        action: "super.billing.custom_plan.update",
        resourceType: "plan",
        resourceId: plan.id,
        metadata: { patch: p },
        ip: clientIp(request),
      });

      return { plan: serializePlan(plan) };
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
        stripeProductId: normalizeStripeId(p.stripeProductId),
        stripePriceId: normalizeStripeId(p.stripePriceId),
        legacyPlanTier: p.legacyPlanTier ?? null,
        limits: p.limits,
        features: p.features,
        trialDays: p.trialDays,
      });

      await recordAuditLog({
        actorUserId: request.user!.id,
        organizationId: p.organizationId,
        action: "super.billing.custom_plan.create",
        resourceType: "plan",
        resourceId: plan.id,
        metadata: { name: plan.name, organizationId: p.organizationId },
        ip: clientIp(request),
      });

      return reply.status(201).send({
        plan: serializePlan({ ...plan, _count: { subscriptions: 1 } }),
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
        stripeProductId: normalizeStripeId(p.stripeProductId),
        stripePriceId: normalizeStripeId(p.stripePriceId),
        legacyPlanTier: p.legacyPlanTier ?? null,
        limits: (p.limits ?? {}) as Prisma.InputJsonValue,
        features: (p.features ?? {}) as Prisma.InputJsonValue,
      },
      include: { _count: { select: { subscriptions: true } } },
    });

    await recordAuditLog({
      actorUserId: request.user!.id,
      action: "super.billing.plan.create",
      resourceType: "plan",
      resourceId: plan.id,
      metadata: { slug: plan.slug, name: plan.name },
      ip: clientIp(request),
    });

    return reply.status(201).send({ plan: serializePlan(plan) });
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
    if (p.stripeProductId !== undefined) data.stripeProductId = normalizeStripeId(p.stripeProductId);
    if (p.stripePriceId !== undefined) data.stripePriceId = normalizeStripeId(p.stripePriceId);
    if (p.legacyPlanTier !== undefined) data.legacyPlanTier = p.legacyPlanTier;
    if (p.limits !== undefined) data.limits = p.limits as Prisma.InputJsonValue;
    if (p.features !== undefined) data.features = p.features as Prisma.InputJsonValue;

    try {
      const plan = await prisma.plan.update({
        where: { id: request.params.id },
        data,
        include: { _count: { select: { subscriptions: true } } },
      });

      await recordAuditLog({
        actorUserId: request.user!.id,
        action: "super.billing.plan.update",
        resourceType: "plan",
        resourceId: plan.id,
        metadata: { patch: p },
        ip: clientIp(request),
      });

      return { plan: serializePlan(plan) };
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Plan not found", statusCode: 404 });
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

    return {
      total,
      page: query.page,
      limit: query.limit,
      subscriptions: rows.map((s) => ({
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
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        canceledAt: s.canceledAt?.toISOString() ?? null,
        trialEnd: s.trialEnd?.toISOString() ?? null,
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  });
}
