import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../../db.js";
import type { PaymentProviderName } from "./billingTypes.js";

export type MarkPaymentWebhookEventInput = {
  provider: PaymentProviderName;
  externalEventId: string;
  eventType: string;
  payload?: unknown;
  status?: string;
};

export function hashWebhookPayload(payload: unknown): string {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return createHash("sha256").update(raw).digest("hex");
}

/** Idempotência genérica para webhooks multi-provider. Retorna false se duplicado. */
export async function markPaymentWebhookEventProcessed(
  input: MarkPaymentWebhookEventInput,
): Promise<boolean> {
  try {
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: input.provider,
        externalEventId: input.externalEventId,
        eventType: input.eventType,
        payloadHash: input.payload != null ? hashWebhookPayload(input.payload) : null,
        status: input.status ?? "processed",
        payload:
          input.payload != null ? (input.payload as Prisma.InputJsonValue) : undefined,
        processedAt: new Date(),
      },
    });
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return false;
    throw err;
  }
}
