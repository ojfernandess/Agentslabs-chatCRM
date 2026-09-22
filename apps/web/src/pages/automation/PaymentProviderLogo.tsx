import clsx from "clsx";
import { MERCADO_PAGO_TOOL_LOGO_URL, STRIPE_TOOL_LOGO_URL } from "./paymentToolBranding";

export function PaymentProviderLogo({
  provider,
  className,
  size = "md",
}: {
  provider: "stripe" | "mercadopago";
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const src = provider === "stripe" ? STRIPE_TOOL_LOGO_URL : MERCADO_PAGO_TOOL_LOGO_URL;
  const sizeCls =
    provider === "stripe"
      ? size === "sm"
        ? "h-5 w-auto max-w-[4.5rem]"
        : size === "lg"
          ? "h-8 w-auto max-w-[7rem]"
          : "h-6 w-auto max-w-[5.5rem]"
      : size === "sm"
        ? "h-6 w-6"
        : size === "lg"
          ? "h-10 w-10"
          : "h-8 w-8";
  return (
    <img
      src={src}
      alt=""
      className={clsx(sizeCls, "shrink-0 object-contain", className)}
      draggable={false}
    />
  );
}
