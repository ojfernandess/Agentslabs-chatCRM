export function subscriptionStatusKey(status: string): string {
  return `settings.billingStatus_${status}`;
}

export function invoiceStatusKey(status: string): string {
  return `settings.billingInvoiceStatus_${status}`;
}

export function translateBillingStatus(
  t: (key: string) => string,
  status: string | null | undefined,
  kind: "subscription" | "invoice",
): string {
  if (!status) return "—";
  const key = kind === "subscription" ? subscriptionStatusKey(status) : invoiceStatusKey(status);
  const label = t(key);
  return label === key ? status : label;
}
