import type Stripe from "stripe";

export type StripeKeyMode = "test" | "live" | "unknown";

export function getStripeKeyMode(secretKey: string): StripeKeyMode {
  const key = secretKey.trim();
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return "unknown";
}

function stripeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export function isStripeResourceMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Stripe.errors.StripeInvalidRequestError;
  return e.type === "StripeInvalidRequestError" && e.code === "resource_missing";
}

/** Stripe devolve isto quando o ID existe no modo oposto (test vs live). */
export function isStripeModeMismatchError(err: unknown): boolean {
  if (!isStripeResourceMissingError(err)) return false;
  const message = stripeErrorMessage(err);
  return /similar object exists in (test|live) mode/i.test(message);
}

export function isStaleStripeBindingError(err: unknown): boolean {
  return isStripeResourceMissingError(err) || isStripeModeMismatchError(err);
}
