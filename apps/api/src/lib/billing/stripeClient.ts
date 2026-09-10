import Stripe from "stripe";
import { config, isStripeBillingConfigured } from "../../config.js";

let stripeSingleton: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(config.stripeSecretKey, {
      apiVersion: config.stripeApiVersion as Stripe.LatestApiVersion,
    });
  }
  return stripeSingleton;
}

export function requireStripeBilling(): Stripe {
  if (!isStripeBillingConfigured()) {
    throw new Error("Stripe billing is not fully configured (secret key and webhook secret required)");
  }
  return getStripeClient();
}

/** Reseta singleton (testes). */
export function resetStripeClientForTests(): void {
  stripeSingleton = null;
}

/** Injeta cliente mock (testes de integração). */
export function setStripeClientForTests(client: Stripe): void {
  stripeSingleton = client;
}
