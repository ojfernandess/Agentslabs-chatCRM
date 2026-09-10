import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { prisma } from "../../db.js";
import {
  makeCheckoutSessionCompletedEvent,
  makeStripeSubscription,
} from "./test/stripeFixtures.js";
import { createMockStripeClient } from "./test/mockStripeClient.js";
import { resetStripeClientForTests, setStripeClientForTests } from "./stripeClient.js";

type MemoryOrg = {
  id: string;
  planTier: string;
  stripeCustomerId: string | null;
  monthlyMessageQuota: number | null;
};

type MemorySub = {
  organizationId: string;
  planId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  status: string;
  checkoutSessionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

const GROWTH_PLAN = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "growth",
  legacyPlanTier: "growth",
  stripePriceId: "price_test_growth",
  limits: { messages: 50_000 },
};

describe("billing flow — in-memory prisma simulation", () => {
  const orgId = "22222222-2222-4222-8222-222222222222";
  const orgs = new Map<string, MemoryOrg>();
  const subs = new Map<string, MemorySub>();
  const webhookEvents = new Set<string>();

  const original = {
    planFindUnique: prisma.plan.findUnique.bind(prisma.plan),
    planFindFirst: prisma.plan.findFirst.bind(prisma.plan),
    orgFindFirst: prisma.organization.findFirst.bind(prisma.organization),
    orgFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    orgUpdate: prisma.organization.update.bind(prisma.organization),
    subUpsert: prisma.organizationSubscription.upsert.bind(prisma.organizationSubscription),
    subFindUnique: prisma.organizationSubscription.findUnique.bind(prisma.organizationSubscription),
    webhookCreate: prisma.stripeWebhookEvent.create.bind(prisma.stripeWebhookEvent),
    auditCreate: prisma.auditLog.create.bind(prisma.auditLog),
  };

  beforeEach(() => {
    orgs.clear();
    subs.clear();
    webhookEvents.clear();
    resetStripeClientForTests();

    orgs.set(orgId, {
      id: orgId,
      planTier: "free",
      stripeCustomerId: null,
      monthlyMessageQuota: null,
    });
    subs.set(orgId, {
      organizationId: orgId,
      planId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      status: "inactive",
      checkoutSessionId: null,
      cancelAtPeriodEnd: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });

    prisma.plan.findUnique = (async (args: { where: { id?: string; slug?: string } }) => {
      if (args.where.id === GROWTH_PLAN.id || args.where.slug === "growth") {
        return GROWTH_PLAN as never;
      }
      return null;
    }) as typeof prisma.plan.findUnique;

    prisma.plan.findFirst = (async (args: { where: { stripePriceId?: string } }) => {
      if (args.where.stripePriceId === GROWTH_PLAN.stripePriceId) {
        return GROWTH_PLAN as never;
      }
      return null;
    }) as typeof prisma.plan.findFirst;

    prisma.organization.findFirst = (async (args: { where: { stripeCustomerId?: string } }) => {
      for (const org of orgs.values()) {
        if (org.stripeCustomerId === args.where.stripeCustomerId) return org as never;
      }
      return null;
    }) as typeof prisma.organization.findFirst;

    prisma.organization.findUnique = (async (args: { where: { id: string } }) => {
      return (orgs.get(args.where.id) ?? null) as never;
    }) as typeof prisma.organization.findUnique;

    prisma.organization.update = (async (args: {
      where: { id: string };
      data: Partial<MemoryOrg>;
    }) => {
      const org = orgs.get(args.where.id);
      assert.ok(org);
      Object.assign(org, args.data);
      return org as never;
    }) as typeof prisma.organization.update;

    prisma.organizationSubscription.findUnique = (async (args: { where: { organizationId: string } }) => {
      return (subs.get(args.where.organizationId) ?? null) as never;
    }) as typeof prisma.organizationSubscription.findUnique;

    prisma.organizationSubscription.upsert = (async (args: {
      where: { organizationId: string };
      create: MemorySub;
      update: Partial<MemorySub>;
    }) => {
      const existing = subs.get(args.where.organizationId);
      const next = { ...(existing ?? args.create), ...args.update, organizationId: args.where.organizationId };
      subs.set(args.where.organizationId, next);
      return next as never;
    }) as typeof prisma.organizationSubscription.upsert;

    prisma.stripeWebhookEvent.create = (async (args: { data: { id: string } }) => {
      if (webhookEvents.has(args.data.id)) {
        const err = new Error("Unique constraint") as Error & { code?: string };
        err.code = "P2002";
        throw err;
      }
      webhookEvents.add(args.data.id);
      return args.data as never;
    }) as typeof prisma.stripeWebhookEvent.create;

    prisma.auditLog.create = (async () => ({ id: "audit-mock" }) as never) as typeof prisma.auditLog.create;
  });

  afterEach(() => {
    prisma.plan.findUnique = original.planFindUnique;
    prisma.plan.findFirst = original.planFindFirst;
    prisma.organization.findFirst = original.orgFindFirst;
    prisma.organization.findUnique = original.orgFindUnique;
    prisma.organization.update = original.orgUpdate;
    prisma.organizationSubscription.upsert = original.subUpsert;
    prisma.organizationSubscription.findUnique = original.subFindUnique;
    prisma.stripeWebhookEvent.create = original.webhookCreate;
    prisma.auditLog.create = original.auditCreate;
    resetStripeClientForTests();
  });

  it("syncSubscriptionFromStripe updates org plan tier and quotas", async () => {
    const { syncSubscriptionFromStripe } = await import("./subscriptionSync.js");
    const subscription = makeStripeSubscription({
      organizationId: orgId,
      planId: GROWTH_PLAN.id,
      customerId: "cus_sync_direct",
      status: "active",
    });

    const result = await syncSubscriptionFromStripe(subscription, orgId);
    assert.ok(result);
    assert.equal(result?.status, "active");

    const sub = subs.get(orgId);
    assert.equal(sub?.planId, GROWTH_PLAN.id);
    assert.equal(sub?.stripeSubscriptionId, subscription.id);

    const org = orgs.get(orgId);
    assert.equal(org?.planTier, "growth");
    assert.equal(org?.monthlyMessageQuota, 50_000);
  });

  it("checkout.session.completed activates subscription and plan tier", async () => {
    const { processStripeWebhookEvent } = await import("./stripeWebhookHandler.js");
    const subscriptionId = "sub_memory_flow";
    const subscription = makeStripeSubscription({
      id: subscriptionId,
      organizationId: orgId,
      planId: GROWTH_PLAN.id,
      customerId: "cus_memory_flow",
      status: "active",
    });

    setStripeClientForTests(
      createMockStripeClient({
        subscriptions: { retrieve: async () => subscription },
      }),
    );

    const event = makeCheckoutSessionCompletedEvent({
      eventId: "evt_memory_checkout",
      sessionId: "cs_memory",
      organizationId: orgId,
      planId: GROWTH_PLAN.id,
      subscriptionId,
      customerId: "cus_memory_flow",
    });

    assert.equal(await processStripeWebhookEvent(event), true);

    const sub = subs.get(orgId);
    assert.equal(sub?.status, "active");
    assert.equal(sub?.stripeSubscriptionId, subscriptionId);
    assert.equal(sub?.planId, GROWTH_PLAN.id);

    const org = orgs.get(orgId);
    assert.equal(org?.planTier, "growth");
    assert.equal(org?.stripeCustomerId, "cus_memory_flow");
    assert.equal(org?.monthlyMessageQuota, 50_000);
  });

  it("duplicate webhook is ignored (idempotent)", async () => {
    const { processStripeWebhookEvent } = await import("./stripeWebhookHandler.js");
    const subscription = makeStripeSubscription({
      organizationId: orgId,
      planId: GROWTH_PLAN.id,
      status: "active",
    });

    setStripeClientForTests(
      createMockStripeClient({
        subscriptions: { retrieve: async () => subscription },
      }),
    );

    const event = makeCheckoutSessionCompletedEvent({
      eventId: "evt_memory_dup",
      sessionId: "cs_memory_dup",
      organizationId: orgId,
      planId: GROWTH_PLAN.id,
      subscriptionId: "sub_memory_dup",
    });

    assert.equal(await processStripeWebhookEvent(event), true);
    assert.equal(await processStripeWebhookEvent(event), false);
    assert.equal(webhookEvents.size, 1);
  });
});
