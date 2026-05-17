import { randomBytes } from "node:crypto";

export function generateWhatsappWebhookVerifyToken(): string {
  return randomBytes(16).toString("hex");
}

export function isMetaCloudWhatsappProvider(provider: string | null | undefined): boolean {
  return provider === "meta" || provider === "360dialog";
}
