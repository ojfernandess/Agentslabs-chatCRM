import Stripe from "stripe";
import type StripeTypes from "stripe";

type SubscriptionHandlers = {
  retrieve?: (id: string) => Promise<StripeTypes.Subscription>;
  update?: (id: string, params: StripeTypes.SubscriptionUpdateParams) => Promise<StripeTypes.Subscription>;
  cancel?: (id: string) => Promise<StripeTypes.Subscription>;
};

type CheckoutHandlers = {
  create?: (
    params: StripeTypes.Checkout.SessionCreateParams,
    options?: StripeTypes.RequestOptions,
  ) => Promise<StripeTypes.Checkout.Session>;
};

type CustomerHandlers = {
  create?: (params: StripeTypes.CustomerCreateParams) => Promise<StripeTypes.Customer>;
  update?: (id: string, params: StripeTypes.CustomerUpdateParams) => Promise<StripeTypes.Customer>;
};

type PortalHandlers = {
  create?: (params: StripeTypes.BillingPortal.SessionCreateParams) => Promise<StripeTypes.BillingPortal.Session>;
};

export type MockStripeHandlers = {
  subscriptions?: SubscriptionHandlers;
  checkout?: CheckoutHandlers;
  customers?: CustomerHandlers;
  billingPortal?: PortalHandlers;
};

const webhookStripe = new Stripe("sk_test_mock");

export function createMockStripeClient(handlers: MockStripeHandlers): StripeTypes {
  return {
    subscriptions: {
      retrieve: async (id: string) => {
        if (handlers.subscriptions?.retrieve) return handlers.subscriptions.retrieve(id);
        throw new Error(`Unexpected subscriptions.retrieve(${id})`);
      },
      update: async (id: string, params: StripeTypes.SubscriptionUpdateParams) => {
        if (handlers.subscriptions?.update) return handlers.subscriptions.update(id, params);
        throw new Error(`Unexpected subscriptions.update(${id})`);
      },
      cancel: async (id: string) => {
        if (handlers.subscriptions?.cancel) return handlers.subscriptions.cancel(id);
        throw new Error(`Unexpected subscriptions.cancel(${id})`);
      },
    },
    checkout: {
      sessions: {
        create: async (
          params: StripeTypes.Checkout.SessionCreateParams,
          options?: StripeTypes.RequestOptions,
        ) => {
          if (handlers.checkout?.create) return handlers.checkout.create(params, options);
          throw new Error("Unexpected checkout.sessions.create");
        },
      },
    },
    customers: {
      create: async (params: StripeTypes.CustomerCreateParams) => {
        if (handlers.customers?.create) return handlers.customers.create(params);
        return { id: "cus_mock_created", object: "customer", ...params } as StripeTypes.Customer;
      },
      update: async (id: string, params: StripeTypes.CustomerUpdateParams) => {
        if (handlers.customers?.update) return handlers.customers.update(id, params);
        return { id, object: "customer", ...params } as StripeTypes.Customer;
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: StripeTypes.BillingPortal.SessionCreateParams) => {
          if (handlers.billingPortal?.create) return handlers.billingPortal.create(params);
          return {
            id: "bps_mock",
            object: "billing_portal.session",
            url: "https://billing.stripe.test/session/mock",
            ...params,
          } as StripeTypes.BillingPortal.Session;
        },
      },
    },
    webhooks: {
      constructEvent: (payload: Buffer | string, signature: string, secret: string) =>
        webhookStripe.webhooks.constructEvent(payload, signature, secret),
    },
  } as unknown as StripeTypes;
}
