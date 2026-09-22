export const STRIPE_TOOL_LOGO_URL = "/Stripe%20wordmark%20-%20Blurple.svg";
export const MERCADO_PAGO_TOOL_LOGO_URL = "/logo-mercadopago.svg";

export function paymentToolLogoUrl(presetKey: string | undefined, provider: string | undefined): string | null {
  const pk = (presetKey ?? "").trim();
  const p = (provider ?? "").trim().toLowerCase();
  if (pk === "int_stripe" || p === "stripe") return STRIPE_TOOL_LOGO_URL;
  if (pk === "int_mercadopago" || p === "mercadopago" || p === "mercado_pago") return MERCADO_PAGO_TOOL_LOGO_URL;
  return null;
}
