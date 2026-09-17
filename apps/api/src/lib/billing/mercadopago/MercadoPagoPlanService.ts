import type { Plan } from "@prisma/client";
import { prisma } from "../../../db.js";
import { BillingError } from "../StripeCustomerService.js";
import { resolvePlatformMercadoPagoAccessToken } from "../mercadoPagoBillingSettings.js";
import {
  mercadoPagoPlanBackUrl,
  mercadoPagoRequest,
  MercadoPagoApiError,
} from "./mercadoPagoClient.js";

type MercadoPagoPreapprovalPlan = {
  id: string;
  reason?: string;
  status?: string;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number;
    currency_id?: string;
  };
};

export type SyncMercadoPagoPlanResult = {
  planId: string;
  mercadopagoPlanId: string;
  created: boolean;
  status: string | null;
};

function normalizeMercadoPagoId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function buildAutoRecurring(plan: Pick<Plan, "amountCents" | "currency" | "interval">) {
  if (plan.amountCents <= 0) {
    throw new BillingError("Free plans cannot be synced to Mercado Pago", "plan_free_mercadopago");
  }

  const currency = (plan.currency || "BRL").toUpperCase();
  const frequency = plan.interval === "year" ? 12 : 1;

  return {
    frequency,
    frequency_type: "months" as const,
    transaction_amount: Number((plan.amountCents / 100).toFixed(2)),
    currency_id: currency,
  };
}

function buildPreapprovalPlanBody(plan: Pick<Plan, "id" | "slug" | "name" | "description" | "amountCents" | "currency" | "interval">) {
  return {
    reason: plan.name.trim(),
    external_reference: `ONX-PLAN-${plan.id}`,
    auto_recurring: buildAutoRecurring(plan),
    back_url: mercadoPagoPlanBackUrl(),
  };
}

async function resolveAccessTokenForPlan(_plan: Pick<Plan, "organizationId">): Promise<string> {
  // Billing SaaS da plataforma: planos globais e personalizados usam credenciais da plataforma.
  return resolvePlatformMercadoPagoAccessToken();
}

export async function getMercadoPagoPreapprovalPlan(
  accessToken: string,
  mercadopagoPlanId: string,
): Promise<MercadoPagoPreapprovalPlan | null> {
  try {
    return await mercadoPagoRequest<MercadoPagoPreapprovalPlan>({
      accessToken,
      method: "GET",
      path: `/preapproval_plan/${encodeURIComponent(mercadopagoPlanId)}`,
    });
  } catch (err) {
    if (err instanceof MercadoPagoApiError && err.statusCode === 404) return null;
    throw err;
  }
}

export async function createMercadoPagoPreapprovalPlan(
  accessToken: string,
  plan: Pick<Plan, "id" | "slug" | "name" | "description" | "amountCents" | "currency" | "interval">,
): Promise<MercadoPagoPreapprovalPlan> {
  return mercadoPagoRequest<MercadoPagoPreapprovalPlan>({
    accessToken,
    method: "POST",
    path: "/preapproval_plan",
    body: buildPreapprovalPlanBody(plan),
    idempotencyKey: `preapproval-plan:${plan.id}`,
  });
}

export async function syncPlanToMercadoPago(
  planId: string,
  options?: { forceRecreate?: boolean },
): Promise<SyncMercadoPagoPlanResult> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    throw new BillingError("Plan not found", "plan_not_found");
  }

  const accessToken = await resolveAccessTokenForPlan(plan);
  const existingId = normalizeMercadoPagoId(plan.mercadopagoPlanId);

  if (existingId && !options?.forceRecreate) {
    const existing = await getMercadoPagoPreapprovalPlan(accessToken, existingId);
    if (existing?.id) {
      return {
        planId: plan.id,
        mercadopagoPlanId: existing.id,
        created: false,
        status: existing.status ?? null,
      };
    }
  }

  const created = await createMercadoPagoPreapprovalPlan(accessToken, plan);
  if (!created.id?.trim()) {
    throw new BillingError("Mercado Pago did not return a plan id", "mercadopago_plan_sync_failed");
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: { mercadopagoPlanId: created.id },
  });

  return {
    planId: plan.id,
    mercadopagoPlanId: created.id,
    created: true,
    status: created.status ?? null,
  };
}

export async function resolvePlanIdFromMercadoPagoPlanId(
  mercadopagoPlanId: string,
): Promise<string | null> {
  const plan = await prisma.plan.findFirst({
    where: { mercadopagoPlanId },
    select: { id: true },
  });
  return plan?.id ?? null;
}

export function planIsMercadoPagoReady(plan: {
  amountCents: number;
  mercadopagoPlanId?: string | null;
}): boolean {
  if (plan.amountCents <= 0) return true;
  return Boolean(normalizeMercadoPagoId(plan.mercadopagoPlanId));
}
