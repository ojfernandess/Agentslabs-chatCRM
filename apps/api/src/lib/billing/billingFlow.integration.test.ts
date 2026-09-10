import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import Stripe from "stripe";
import { mapStripeSubscriptionStatus } from "./billingTypes.js";
import { getSubscriptionBillingPeriod } from "./stripeHelpers.js";
import {
  makeCheckoutSessionCompletedEvent,
  makeInvoicePaymentFailedEvent,
  makeStripeSubscription,
  makeSubscriptionUpdatedEvent,
} from "./test/stripeFixtures.js";
import { createMockStripeClient } from "./test/mockStripeClient.js";

const TEST_WEBHOOK_SECRET = "whsec_test_billing_flow_secret_1234567890";
const TEST_SK = "sk_test_51billingflowmock000000000000";

function uniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe("billing flow — stripe fixtures", () => {
  it("subscription fixture exposes billing period on first item", () => {
    const sub = makeStripeSubscription({
      organizationId: "org-fixture",
      planId: "plan-fixture",
    });
    const period = getSubscriptionBillingPeriod(sub);
    assert.ok(period.currentPeriodStart);
    assert.ok(period.currentPeriodEnd);
    assert.ok(period.currentPeriodEnd! > period.currentPeriodStart!);
  });

  it("maps Stripe statuses to internal subscription status", () => {
    assert.equal(mapStripeSubscriptionStatus("active"), "active");
    assert.equal(mapStripeSubscriptionStatus("past_due"), "past_due");
    assert.equal(mapStripeSubscriptionStatus("unknown"), "inactive");
  });
});

describe("billing flow — webhook signature", () => {
  before(() => {
    process.env.STRIPE_SECRET_KEY = TEST_SK;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  it("rejects missing Stripe-Signature header", async () => {
    const { constructStripeWebhookEvent, StripeWebhookError } = await import("./stripeWebhookHandler.js");
    const { resetStripeClientForTests, setStripeClientForTests } = await import("./stripeClient.js");
    resetStripeClientForTests();
    setStripeClientForTests(createMockStripeClient({}));

    assert.throws(
      () => constructStripeWebhookEvent(Buffer.from("{}"), undefined),
      (err: unknown) => err instanceof StripeWebhookError && err.statusCode === 400,
    );
  });

  it("rejects invalid webhook signature", async () => {
    const { constructStripeWebhookEvent, StripeWebhookError } = await import("./stripeWebhookHandler.js");
    const { resetStripeClientForTests, setStripeClientForTests } = await import("./stripeClient.js");
    resetStripeClientForTests();
    setStripeClientForTests(createMockStripeClient({}));

    const payload = JSON.stringify({ id: "evt_invalid", type: "ping" });
    assert.throws(
      () => constructStripeWebhookEvent(payload, "t=0,v1=invalid"),
      (err: unknown) => err instanceof StripeWebhookError && err.statusCode === 400,
    );
  });

  it("accepts valid webhook signature", async () => {
    const { config } = await import("../../config.js");
    const webhookSecret =
      config.stripeWebhookSecret.trim() || process.env.STRIPE_WEBHOOK_SECRET?.trim() || TEST_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

    const { constructStripeWebhookEvent } = await import("./stripeWebhookHandler.js");
    const { resetStripeClientForTests, setStripeClientForTests } = await import("./stripeClient.js");
    resetStripeClientForTests();
    setStripeClientForTests(createMockStripeClient({}));

    const payload = JSON.stringify({ id: "evt_valid_sig", type: "ping", data: { object: {} } });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    const event = constructStripeWebhookEvent(payload, signature);
    assert.equal(event.id, "evt_valid_sig");
  });
});

describe("billing flow — database integration", () => {
  let dbAvailable = false;
  let prisma: typeof import("../../db.js").prisma;
  let resetStripeClientForTests: () => void;
  let setStripeClientForTests: (client: import("stripe").default) => void;

  const orgIds: string[] = [];
  const webhookEventIds: string[] = [];
  let growthPlanId: string | null = null;
  let growthPlanPriceBackup: string | null = null;

  before(async () => {
    process.env.STRIPE_SECRET_KEY = TEST_SK;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    try {
      const stripeClientMod = await import("./stripeClient.js");
      resetStripeClientForTests = stripeClientMod.resetStripeClientForTests;
      setStripeClientForTests = stripeClientMod.setStripeClientForTests;

      const dbMod = await import("../../db.js");
      prisma = dbMod.prisma;
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;

      const growth = await prisma.plan.findUnique({ where: { slug: "growth" } });
      if (growth) {
        growthPlanId = growth.id;
        growthPlanPriceBackup = growth.stripePriceId;
        if (!growth.stripePriceId) {
          await prisma.plan.update({
            where: { id: growth.id },
            data: { stripePriceId: "price_test_growth" },
          });
        }
      }
    } catch {
      dbAvailable = false;
    }
  });

  after(async () => {
    if (!dbAvailable || !prisma) return;

    if (webhookEventIds.length > 0) {
      await prisma.stripeWebhookEvent.deleteMany({ where: { id: { in: webhookEventIds } } });
    }
    for (const orgId of orgIds) {
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    }
    if (growthPlanId && growthPlanPriceBackup === null) {
      await prisma.plan.update({
        where: { id: growthPlanId },
        data: { stripePriceId: null },
      });
    } else if (growthPlanId && growthPlanPriceBackup !== null) {
      await prisma.plan.update({
        where: { id: growthPlanId },
        data: { stripePriceId: growthPlanPriceBackup },
      });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    resetStripeClientForTests?.();
  });

  async function createTestOrg(): Promise<{ id: string; adminUserId: string }> {
    const slug = uniqueId("billing-org");
    const org = await prisma.organization.create({
      data: {
        name: `Billing Test ${slug}`,
        slug,
        planTier: "free",
        billingEmail: `${slug}@billing.test`,
      },
    });
    orgIds.push(org.id);

    const admin = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `${slug}-admin@billing.test`,
        name: "Billing Admin",
        role: "ADMIN",
        passwordHash: "unused",
      },
    });

    await prisma.organizationSubscription.create({
      data: {
        organizationId: org.id,
        status: "inactive",
      },
    });

    return { id: org.id, adminUserId: admin.id };
  }

  it("checkout → webhook completes subscription activation", async (t) => {
    if (!dbAvailable || !growthPlanId) {
      t.skip("Database or growth plan unavailable");
      return;
    }

    const { processStripeWebhookEvent } = await import("./stripeWebhookHandler.js");
    const { createCheckoutSession } = await import("./StripeCheckoutService.js");

    const org = await createTestOrg();
    const subscriptionId = uniqueId("sub");
    const sessionId = uniqueId("cs");
    const eventId = uniqueId("evt_test_billing_checkout");
    webhookEventIds.push(eventId);

    const subscription = makeStripeSubscription({
      id: subscriptionId,
      organizationId: org.id,
      planId: growthPlanId,
      customerId: "cus_checkout_flow",
      status: "active",
    });

    setStripeClientForTests(
      createMockStripeClient({
        checkout: {
          create: async () =>
            ({
              id: sessionId,
              object: "checkout.session",
              url: "https://checkout.stripe.test/session/mock",
            }) as import("stripe").default.Checkout.Session,
        },
        customers: {
          create: async () =>
            ({ id: "cus_checkout_flow", object: "customer" }) as import("stripe").default.Customer,
        },
        subscriptions: {
          retrieve: async () => subscription,
        },
      }),
    );

    const checkout = await createCheckoutSession({
      organizationId: org.id,
      planId: growthPlanId,
      actorUserId: org.adminUserId,
    });
    assert.ok(checkout.url.includes("checkout.stripe.test"));

    const incomplete = await prisma.organizationSubscription.findUnique({
      where: { organizationId: org.id },
    });
    assert.equal(incomplete?.status, "incomplete");
    assert.equal(incomplete?.checkoutSessionId, sessionId);

    const event = makeCheckoutSessionCompletedEvent({
      eventId,
      sessionId,
      organizationId: org.id,
      planId: growthPlanId,
      subscriptionId,
      customerId: "cus_checkout_flow",
    });

    const processed = await processStripeWebhookEvent(event);
    assert.equal(processed, true);

    const active = await prisma.organizationSubscription.findUnique({
      where: { organizationId: org.id },
      include: { plan: { select: { slug: true, legacyPlanTier: true } } },
    });
    assert.equal(active?.status, "active");
    assert.equal(active?.stripeSubscriptionId, subscriptionId);
    assert.equal(active?.planId, growthPlanId);

    const orgRow = await prisma.organization.findUnique({ where: { id: org.id } });
    assert.equal(orgRow?.planTier, "growth");
    assert.equal(orgRow?.stripeCustomerId, "cus_checkout_flow");
  });

  it("duplicate webhook event is idempotent", async (t) => {
    if (!dbAvailable || !growthPlanId) {
      t.skip("Database or growth plan unavailable");
      return;
    }

    const { processStripeWebhookEvent } = await import("./stripeWebhookHandler.js");
    const org = await createTestOrg();
    const subscriptionId = uniqueId("sub");
    const eventId = uniqueId("evt_test_billing_dup");
    webhookEventIds.push(eventId);

    const subscription = makeStripeSubscription({
      id: subscriptionId,
      organizationId: org.id,
      planId: growthPlanId,
      status: "active",
    });

    setStripeClientForTests(
      createMockStripeClient({
        subscriptions: { retrieve: async () => subscription },
      }),
    );

    const event = makeCheckoutSessionCompletedEvent({
      eventId,
      sessionId: uniqueId("cs"),
      organizationId: org.id,
      planId: growthPlanId,
      subscriptionId,
    });

    assert.equal(await processStripeWebhookEvent(event), true);
    assert.equal(await processStripeWebhookEvent(event), false);

    const count = await prisma.stripeWebhookEvent.count({ where: { id: eventId } });
    assert.equal(count, 1);
  });

  it("invoice.payment_failed syncs past_due status", async (t) => {
    if (!dbAvailable || !growthPlanId) {
      t.skip("Database or growth plan unavailable");
      return;
    }

    const { processStripeWebhookEvent } = await import("./stripeWebhookHandler.js");
    const org = await createTestOrg();
    const subscriptionId = uniqueId("sub");
    const eventId = uniqueId("evt_test_billing_failed");
    webhookEventIds.push(eventId);

    await prisma.organization.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_past_due" },
    });
    await prisma.organizationSubscription.update({
      where: { organizationId: org.id },
      data: {
        planId: growthPlanId,
        stripeCustomerId: "cus_past_due",
        stripeSubscriptionId: subscriptionId,
        status: "active",
      },
    });

    const pastDueSub = makeStripeSubscription({
      id: subscriptionId,
      organizationId: org.id,
      planId: growthPlanId,
      customerId: "cus_past_due",
      status: "past_due",
    });

    setStripeClientForTests(
      createMockStripeClient({
        subscriptions: { retrieve: async () => pastDueSub },
      }),
    );

    const event = makeInvoicePaymentFailedEvent({
      eventId,
      invoiceId: uniqueId("in"),
      customerId: "cus_past_due",
      subscriptionId,
    });

    await processStripeWebhookEvent(event);

    const sub = await prisma.organizationSubscription.findUnique({ where: { organizationId: org.id } });
    assert.equal(sub?.status, "past_due");
  });

  it("change plan upgrades subscription via Stripe update", async (t) => {
    if (!dbAvailable || !growthPlanId) {
      t.skip("Database or growth plan unavailable");
      return;
    }

    const enterprise = await prisma.plan.findUnique({ where: { slug: "enterprise" } });
    if (!enterprise) {
      t.skip("Enterprise plan unavailable");
      return;
    }

    const enterprisePriceBackup = enterprise.stripePriceId;
    if (!enterprise.stripePriceId) {
      await prisma.plan.update({
        where: { id: enterprise.id },
        data: { stripePriceId: "price_test_enterprise" },
      });
    }

    try {
      const { changeSubscriptionPlan } = await import("./StripeSubscriptionService.js");
      const org = await createTestOrg();
      const subscriptionId = uniqueId("sub");

      await prisma.organizationSubscription.update({
        where: { organizationId: org.id },
        data: {
          planId: growthPlanId,
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: "cus_change_plan",
          status: "active",
        },
      });

      const updatedSub = makeStripeSubscription({
        id: subscriptionId,
        organizationId: org.id,
        planId: enterprise.id,
        priceId: "price_test_enterprise",
        status: "active",
      });

      setStripeClientForTests(
        createMockStripeClient({
          subscriptions: {
            retrieve: async () =>
              makeStripeSubscription({
                id: subscriptionId,
                organizationId: org.id,
                planId: growthPlanId!,
                status: "active",
              }),
            update: async (_id, params) => {
              assert.equal(params.items?.[0]?.price, "price_test_enterprise");
              return updatedSub;
            },
          },
        }),
      );

      await changeSubscriptionPlan({
        organizationId: org.id,
        planId: enterprise.id,
        actorUserId: org.adminUserId,
      });

      const sub = await prisma.organizationSubscription.findUnique({ where: { organizationId: org.id } });
      assert.equal(sub?.planId, enterprise.id);

      const orgRow = await prisma.organization.findUnique({ where: { id: org.id } });
      assert.equal(orgRow?.planTier, "enterprise");
    } finally {
      if (enterprisePriceBackup === null) {
        await prisma.plan.update({
          where: { id: enterprise.id },
          data: { stripePriceId: null },
        });
      }
    }
  });

  it("cancel schedules cancel_at_period_end and resume clears it", async (t) => {
    if (!dbAvailable || !growthPlanId) {
      t.skip("Database or growth plan unavailable");
      return;
    }

    const {
      cancelOrganizationSubscription,
      resumeScheduledCancellation,
    } = await import("./StripeSubscriptionService.js");

    const org = await createTestOrg();
    const subscriptionId = uniqueId("sub");

    await prisma.organizationSubscription.update({
      where: { organizationId: org.id },
      data: {
        planId: growthPlanId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: "cus_cancel",
        status: "active",
      },
    });

    let cancelFlag = false;
    setStripeClientForTests(
      createMockStripeClient({
        subscriptions: {
          retrieve: async () =>
            makeStripeSubscription({
              id: subscriptionId,
              organizationId: org.id,
              planId: growthPlanId!,
              status: "active",
              cancelAtPeriodEnd: cancelFlag,
            }),
          update: async (_id, params) => {
            if (params.cancel_at_period_end === true) cancelFlag = true;
            if (params.cancel_at_period_end === false) cancelFlag = false;
            return makeStripeSubscription({
              id: subscriptionId,
              organizationId: org.id,
              planId: growthPlanId!,
              status: "active",
              cancelAtPeriodEnd: cancelFlag,
            });
          },
        },
      }),
    );

    await cancelOrganizationSubscription({
      organizationId: org.id,
      actorUserId: org.adminUserId,
      cancelAtPeriodEnd: true,
    });

    let sub = await prisma.organizationSubscription.findUnique({ where: { organizationId: org.id } });
    assert.equal(sub?.cancelAtPeriodEnd, true);

    await resumeScheduledCancellation({
      organizationId: org.id,
      actorUserId: org.adminUserId,
    });

    sub = await prisma.organizationSubscription.findUnique({ where: { organizationId: org.id } });
    assert.equal(sub?.cancelAtPeriodEnd, false);
  });

  it("portal session returns Stripe billing portal URL", async (t) => {
    if (!dbAvailable) {
      t.skip("Database unavailable");
      return;
    }

    const { createBillingPortalSession } = await import("./StripePortalService.js");
    const org = await createTestOrg();

    await prisma.organization.update({
      where: { id: org.id },
      data: { stripeCustomerId: "cus_portal" },
    });

    setStripeClientForTests(
      createMockStripeClient({
        billingPortal: {
          create: async () =>
            ({
              id: "bps_test",
              object: "billing_portal.session",
              url: "https://billing.stripe.test/portal/mock",
            }) as import("stripe").default.BillingPortal.Session,
        },
      }),
    );

    const portal = await createBillingPortalSession({
      organizationId: org.id,
      actorUserId: org.adminUserId,
    });
    assert.equal(portal.url, "https://billing.stripe.test/portal/mock");
  });

  it("organizations are isolated — webhook sync does not cross tenants", async (t) => {
    if (!dbAvailable || !growthPlanId) {
      t.skip("Database or growth plan unavailable");
      return;
    }

    const { processStripeWebhookEvent } = await import("./stripeWebhookHandler.js");
    const orgA = await createTestOrg();
    const orgB = await createTestOrg();
    const subscriptionId = uniqueId("sub");
    const eventId = uniqueId("evt_test_billing_isolation");
    webhookEventIds.push(eventId);

    const subscription = makeStripeSubscription({
      id: subscriptionId,
      organizationId: orgA.id,
      planId: growthPlanId,
      status: "active",
    });

    setStripeClientForTests(
      createMockStripeClient({
        subscriptions: { retrieve: async () => subscription },
      }),
    );

    const event = makeSubscriptionUpdatedEvent(subscription, eventId);
    await processStripeWebhookEvent(event);

    const subA = await prisma.organizationSubscription.findUnique({ where: { organizationId: orgA.id } });
    const subB = await prisma.organizationSubscription.findUnique({ where: { organizationId: orgB.id } });

    assert.equal(subA?.status, "active");
    assert.equal(subA?.stripeSubscriptionId, subscriptionId);
    assert.equal(subB?.status, "inactive");
    assert.equal(subB?.stripeSubscriptionId, null);
  });

  it("checkout blocks duplicate active subscription for same plan", async (t) => {
    if (!dbAvailable || !growthPlanId) {
      t.skip("Database or growth plan unavailable");
      return;
    }

    const { createCheckoutSession } = await import("./StripeCheckoutService.js");
    const { BillingError } = await import("./StripeCustomerService.js");
    const org = await createTestOrg();

    await prisma.organizationSubscription.update({
      where: { organizationId: org.id },
      data: {
        planId: growthPlanId,
        stripeSubscriptionId: uniqueId("sub"),
        status: "active",
      },
    });

    setStripeClientForTests(createMockStripeClient({}));

    await assert.rejects(
      () =>
        createCheckoutSession({
          organizationId: org.id,
          planId: growthPlanId,
          actorUserId: org.adminUserId,
        }),
      (err: unknown) => err instanceof BillingError && err.code === "already_subscribed",
    );
  });
});
