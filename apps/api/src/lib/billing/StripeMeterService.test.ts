import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type Stripe from "stripe";
import type { BillingPlatformSettings } from "./billingTypes.js";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
process.env.STRIPE_SECRET_KEY ??= "sk_test_51stripemeter000000000000";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_stripe_meter_service";

const {
  ensureStripeOverageMeter,
  resetEnsuredBillingMetersForTests,
  syncBillingOverageMeters,
} = await import("./StripeMeterService.js");
const { resetStripeClientForTests, setStripeClientForTests } = await import("./stripeClient.js");

function makeStripeMock(state: {
  meters: Array<{ id: string; event_name: string; status: "active" | "inactive" }>;
  created: Array<Record<string, unknown>>;
  reactivated: string[];
}) {
  return {
    billing: {
      meters: {
        list: async (params: { starting_after?: string; limit?: number }) => {
          const start = params.starting_after
            ? state.meters.findIndex((m) => m.id === params.starting_after) + 1
            : 0;
          const data = state.meters.slice(start, start + (params.limit ?? 100));
          return {
            object: "list",
            data: data.map((m) => ({
              id: m.id,
              object: "billing.meter",
              event_name: m.event_name,
              status: m.status,
            })),
            has_more: start + data.length < state.meters.length,
          };
        },
        create: async (params: Record<string, unknown>) => {
          state.created.push(params);
          state.meters.push({
            id: `mtr_${state.meters.length + 1}`,
            event_name: String(params.event_name),
            status: "active",
          });
          return state.meters[state.meters.length - 1];
        },
        reactivate: async (id: string) => {
          state.reactivated.push(id);
          const meter = state.meters.find((m) => m.id === id);
          if (meter) meter.status = "active";
          return meter;
        },
      },
      meterEvents: {
        create: async () => ({ object: "billing.meter_event" }),
      },
    },
  } as unknown as Stripe;
}

describe("StripeMeterService", () => {
  beforeEach(() => {
    resetEnsuredBillingMetersForTests();
    resetStripeClientForTests();
  });

  afterEach(() => {
    resetEnsuredBillingMetersForTests();
    resetStripeClientForTests();
  });

  it("ensureStripeOverageMeter creates meter when missing", async () => {
    const created: Array<Record<string, unknown>> = [];
    const reactivated: string[] = [];
    setStripeClientForTests(
      makeStripeMock({
        meters: [],
        created,
        reactivated,
      }),
    );

    const result = await ensureStripeOverageMeter({
      eventName: "openconduit_users_overage",
      dimension: "users",
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.action, "created");
    assert.equal(created.length, 1);
    assert.equal(created[0]?.event_name, "openconduit_users_overage");
    assert.equal(created[0]?.display_name, "OpenConduit users overage");
  });

  it("ensureStripeOverageMeter reactivates inactive meter", async () => {
    const reactivated: string[] = [];
    setStripeClientForTests(
      makeStripeMock({
        meters: [{ id: "mtr_users", event_name: "openconduit_users_overage", status: "inactive" }],
        created: [],
        reactivated,
      }),
    );

    const result = await ensureStripeOverageMeter({
      eventName: "openconduit_users_overage",
      dimension: "users",
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.action, "reactivated");
    assert.deepEqual(reactivated, ["mtr_users"]);
  });

  it("syncBillingOverageMeters syncs enabled dimensions only", async () => {
    const created: Array<Record<string, unknown>> = [];
    setStripeClientForTests(
      makeStripeMock({
        meters: [],
        created,
        reactivated: [],
      }),
    );

    const settings = {
      gracePeriodDays: 7,
      limitEnforcementMode: "overage",
      overage: {
        users: {
          enabled: true,
          stripeMeterEventName: "openconduit_users_overage",
          unitAmountCents: 1000,
        },
        agents: {
          enabled: false,
          stripeMeterEventName: "openconduit_agents_overage",
          unitAmountCents: null,
        },
      },
    } satisfies BillingPlatformSettings;

    const sync = await syncBillingOverageMeters(settings);
    assert.equal(sync.errors.length, 0);
    assert.equal(sync.synced.length, 1);
    assert.equal(sync.synced[0]?.dimension, "users");
    assert.equal(created.length, 1);
  });
});
