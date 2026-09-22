import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { mercadoPagoRequest } from "./billing/mercadopago/mercadoPagoClient.js";
import type { AutomationHttpToolRow } from "./automationHttpToolExecute.js";

export const ORG_MERCADO_PAGO_TOOL_SCOPE = "organization_agent_mercadopago";

export type MercadoPagoToolAction =
  | "list_plans"
  | "get_payment"
  | "create_checkout_preference"
  | "create_pix_payment";

export type MercadoPagoCatalogEntry = {
  label?: string;
  planId?: string;
  amountCents?: number;
  currency?: string;
  defaultTitle?: string;
  isDefault?: boolean;
};

export type MercadoPagoToolConfig = {
  accessToken: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
  defaultAmountCents: number | null;
  defaultTitle: string;
  currency: string;
  catalog: MercadoPagoCatalogEntry[];
};

const MP_ACTIONS = new Set<MercadoPagoToolAction>([
  "list_plans",
  "get_payment",
  "create_checkout_preference",
  "create_pix_payment",
]);

const MP_ACTION_ALIASES: Record<string, MercadoPagoToolAction> = {
  list_plans: "list_plans",
  list_prices: "list_plans",
  consult_plans: "list_plans",
  get_payment: "get_payment",
  consult_payment: "get_payment",
  create_checkout_preference: "create_checkout_preference",
  checkout_preference: "create_checkout_preference",
  create_payment_link: "create_checkout_preference",
  generate_payment_link: "create_checkout_preference",
  create_pix_payment: "create_pix_payment",
  pix_payment: "create_pix_payment",
  create_pix: "create_pix_payment",
};

function asJson(v: unknown): object {
  return v as object;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optionalNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function normalizeBrazilTaxId(value: unknown): string {
  return str(value).replace(/\D/g, "");
}

export function buildOrganizationMercadoPagoToolMetadata(input: {
  organizationId: string;
  conversationId: string;
  toolId: string;
}): Record<string, string> {
  return {
    openconduitToolScope: ORG_MERCADO_PAGO_TOOL_SCOPE,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    toolId: input.toolId,
  };
}

export function isOrganizationAgentMercadoPagoMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const m = metadata ?? {};
  const scope = m.openconduitToolScope;
  if (typeof scope === "string" && str(scope) === ORG_MERCADO_PAGO_TOOL_SCOPE) return true;
  return false;
}

export function isMercadoPagoAutomationTool(row: { toolType: string; config?: unknown }): boolean {
  const t = row.toolType.toUpperCase().replace(/-/g, "_");
  if (t === "MERCADO_PAGO") return true;
  if (t !== "INTEGRATION") return false;
  const c = asRecord(row.config);
  const provider = str(c.provider).toLowerCase();
  return provider === "mercadopago" || provider === "mercado_pago";
}

export function parseMercadoPagoAction(raw: unknown): MercadoPagoToolAction | null {
  const normalized = str(raw).toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  const mapped = MP_ACTION_ALIASES[normalized];
  if (mapped) return mapped;
  return MP_ACTIONS.has(normalized as MercadoPagoToolAction) ? (normalized as MercadoPagoToolAction) : null;
}

export function parseMercadoPagoCatalog(cfg: unknown): MercadoPagoCatalogEntry[] {
  const c = asRecord(cfg);
  const raw = c.catalog;
  if (Array.isArray(raw)) {
    const entries = raw
      .map((item): MercadoPagoCatalogEntry | null => {
        const o = asRecord(item);
        const planId = str(o.planId) || str(o.plan_id);
        const amountCents = optionalNumber(o.amountCents ?? o.amount_cents);
        if (!planId && amountCents == null) return null;
        const entry: MercadoPagoCatalogEntry = {
          isDefault: o.isDefault === true,
        };
        const label = str(o.label) || str(o.name);
        if (label) entry.label = label;
        if (planId) entry.planId = planId;
        if (amountCents != null) entry.amountCents = amountCents;
        const currency = str(o.currency).toUpperCase();
        if (currency) entry.currency = currency;
        const defaultTitle = str(o.defaultTitle) || str(o.title);
        if (defaultTitle) entry.defaultTitle = defaultTitle;
        return entry;
      })
      .filter((x): x is MercadoPagoCatalogEntry => x !== null);
    if (entries.length > 0) return entries;
  }
  const legacyAmount = optionalNumber(c.defaultAmountCents ?? c.defaultAmount);
  if (legacyAmount != null) {
    return [
      {
        amountCents: legacyAmount,
        isDefault: true,
        currency: str(c.currency).toUpperCase() || undefined,
        defaultTitle: str(c.defaultTitle) || undefined,
      },
    ];
  }
  return [];
}

export function readMercadoPagoToolConfig(cfg: unknown): MercadoPagoToolConfig {
  const c = asRecord(cfg);
  const catalog = parseMercadoPagoCatalog(c);
  const defaultEntry = catalog.find((e) => e.isDefault) ?? catalog[0];
  const amountRaw = c.defaultAmountCents ?? c.defaultAmount;
  const defaultAmountCents = optionalNumber(amountRaw) ?? defaultEntry?.amountCents ?? null;
  return {
    accessToken: str(c.accessToken) || str(c.access_token),
    webhookSecret: str(c.webhookSecret),
    successUrl: str(c.successUrl),
    cancelUrl: str(c.cancelUrl),
    defaultAmountCents,
    defaultTitle: str(c.defaultTitle) || defaultEntry?.defaultTitle || "Pagamento",
    currency: str(c.currency).toUpperCase() || defaultEntry?.currency || "BRL",
    catalog,
  };
}

export function normalizeMercadoPagoLlmArgs(llmArgs: Record<string, unknown>): Record<string, unknown> {
  const params = asRecord(llmArgs.params);
  if (Object.keys(params).length === 0) return llmArgs;
  return { ...params, ...llmArgs };
}

export function buildMercadoPagoAgentToolDescription(config: unknown): string {
  const cfg = readMercadoPagoToolConfig(config);
  const parts: string[] = [
    "Pagamentos Mercado Pago. Fluxo: list_plans para consultar planos/valores → create_checkout_preference ou create_pix_payment. Nunca invente preços.",
  ];
  if (cfg.defaultAmountCents != null) {
    parts.push(`Valor predefinido: ${cfg.defaultAmountCents} centavos (${cfg.currency}).`);
  } else {
    parts.push("Se o valor não estiver no config, passe amountCents ou unitPrice.");
  }
  if (cfg.catalog.length > 0) {
    const lines = cfg.catalog.slice(0, 12).map((e) => {
      const label = e.label ? `${e.label}: ` : "";
      const plan = e.planId ? `plano ${e.planId}` : "";
      const amount = e.amountCents != null ? `${e.amountCents} centavos` : "";
      const core = [plan, amount].filter(Boolean).join(", ") || "item configurado";
      return `${label}${core}${e.isDefault ? " (predefinido)" : ""}`;
    });
    parts.push(`Catálogo configurado: ${lines.join("; ")}.`);
  }
  if (cfg.webhookSecret) {
    parts.push("Pagamentos aprovados via webhook actualizam paymentStatus=paid nos flowSlots da conversa.");
  }
  parts.push("Pix exige payerEmail e CPF/CNPJ (payerIdentificationNumber).");
  return parts.join(" ");
}

function summarizeMpPlan(plan: Record<string, unknown>): Record<string, unknown> {
  return {
    id: plan.id ?? null,
    reason: plan.reason ?? null,
    autoRecurring: plan.auto_recurring ?? plan.autoRecurring ?? null,
    status: plan.status ?? null,
  };
}

function resolveAmountCents(llmArgs: Record<string, unknown>, cfg: MercadoPagoToolConfig): number | null {
  return (
    optionalNumber(llmArgs.amountCents) ??
    optionalNumber(llmArgs.amount_cents) ??
    optionalNumber(llmArgs.unitPrice) ??
    optionalNumber(llmArgs.unit_price) ??
    cfg.defaultAmountCents
  );
}

function buildPixPayer(email: string, identificationNumber?: string | null) {
  const digits = normalizeBrazilTaxId(identificationNumber);
  if (digits.length !== 11 && digits.length !== 14) {
    return { error: "missing_fields", missingFields: ["payerIdentificationNumber"] };
  }
  const localPart = email.split("@")[0]?.trim() || "Cliente";
  return {
    payer: {
      email,
      first_name: localPart.slice(0, 50),
      last_name: "OpenConduit",
      identification: {
        type: digits.length === 11 ? "CPF" : "CNPJ",
        number: digits,
      },
    },
  };
}

async function logMercadoPagoExecution(input: {
  organizationId: string;
  toolId: string;
  botId: string;
  source: string;
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  errorMessage: string | null;
}): Promise<void> {
  await prisma.automationToolExecution.create({
    data: {
      organizationId: input.organizationId,
      toolId: input.toolId,
      source: input.source.slice(0, 32),
      ok: input.ok,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      requestSummary: asJson(input.requestSummary),
      responseSummary: asJson(input.responseSummary),
      errorMessage: input.errorMessage,
      tokensUsed: null,
      botId: input.botId.trim() ? input.botId : null,
    },
  });
}

function failResult(input: {
  started: number;
  statusCode?: number | null;
  error: string;
  payload: Record<string, unknown>;
}) {
  return {
    ok: false as const,
    statusCode: input.statusCode ?? null,
    responseText: JSON.stringify({ ok: false, error: input.error, ...input.payload }),
    error: input.error,
    durationMs: Date.now() - input.started,
  };
}

function successResult(input: { started: number; payload: Record<string, unknown>; statusCode?: number }) {
  return {
    ok: true as const,
    statusCode: input.statusCode ?? 200,
    responseText: JSON.stringify({ ok: true, ...input.payload }),
    error: null,
    durationMs: Date.now() - input.started,
  };
}

export async function runMercadoPagoTool(input: {
  tool: AutomationHttpToolRow;
  llmArgs: Record<string, unknown>;
  organizationId: string;
  botId: string;
  conversationId: string;
  executionSource: string;
}): Promise<{
  ok: boolean;
  statusCode: number | null;
  responseText: string;
  error: string | null;
  durationMs: number;
  autoFilledFields?: string[];
}> {
  const started = Date.now();
  const { tool, organizationId, botId, conversationId, executionSource } = input;

  if (!isMercadoPagoAutomationTool(tool)) {
    return failResult({ started, error: "unsupported_tool_type", payload: {} });
  }
  if (tool.organizationId !== organizationId) {
    return failResult({ started, error: "organization_mismatch", payload: {} });
  }

  const cfg = readMercadoPagoToolConfig(tool.config);
  const llmArgs = normalizeMercadoPagoLlmArgs(input.llmArgs);
  const action = parseMercadoPagoAction(llmArgs.action);
  const agentMeta = buildOrganizationMercadoPagoToolMetadata({
    organizationId,
    conversationId,
    toolId: tool.id,
  });
  const { mercadoPagoToolWebhookUrlForOrganization } = await import("../config.js");
  const notificationUrl = mercadoPagoToolWebhookUrlForOrganization(organizationId, tool.id);

  const persist = async (result: {
    ok: boolean;
    statusCode: number | null;
    responseText: string;
    error: string | null;
    requestSummary: Record<string, unknown>;
  }) => {
    await logMercadoPagoExecution({
      organizationId,
      toolId: tool.id,
      botId,
      source: executionSource,
      ok: result.ok,
      statusCode: result.statusCode,
      durationMs: Date.now() - started,
      requestSummary: {
        conversationId,
        action: action ?? (str(llmArgs.action) || null),
        ...result.requestSummary,
      },
      responseSummary: { preview: result.responseText.slice(0, 8000) },
      errorMessage: result.error,
    });
  };

  if (!action) {
    const out = failResult({
      started,
      error: "missing_fields",
      payload: { missingFields: ["action"], allowed: [...MP_ACTIONS] },
    });
    await persist({
      ok: false,
      statusCode: null,
      responseText: out.responseText,
      error: out.error,
      requestSummary: { llmArgsKeys: Object.keys(llmArgs) },
    });
    return out;
  }

  if (!cfg.accessToken || cfg.accessToken === "***") {
    const out = failResult({
      started,
      error: "mercadopago_not_connected",
      payload: {
        message: "Mercado Pago não está ligado. Guarde o Access Token da conta no painel da ferramenta.",
      },
    });
    await persist({
      ok: false,
      statusCode: null,
      responseText: out.responseText,
      error: out.error,
      requestSummary: { action },
    });
    return out;
  }

  try {
    if (action === "list_plans") {
      const search = await mercadoPagoRequest<{ results?: Record<string, unknown>[] }>({
        accessToken: cfg.accessToken,
        method: "GET",
        path: "/preapproval_plan/search?status=active",
      });
      const plans = (search.results ?? []).map((p) => summarizeMpPlan(p));
      const out = successResult({ started, payload: { action, count: plans.length, plans } });
      await persist({
        ok: true,
        statusCode: out.statusCode,
        responseText: out.responseText,
        error: null,
        requestSummary: { action },
      });
      return out;
    }

    if (action === "get_payment") {
      const paymentId = str(llmArgs.paymentId) || str(llmArgs.payment_id);
      if (!paymentId) {
        const out = failResult({
          started,
          error: "missing_fields",
          payload: { missingFields: ["paymentId"], action },
        });
        await persist({
          ok: false,
          statusCode: null,
          responseText: out.responseText,
          error: out.error,
          requestSummary: { action },
        });
        return out;
      }
      const payment = await mercadoPagoRequest<Record<string, unknown>>({
        accessToken: cfg.accessToken,
        method: "GET",
        path: `/v1/payments/${encodeURIComponent(paymentId)}`,
      });
      const out = successResult({
        started,
        payload: {
          action,
          payment: {
            id: payment.id,
            status: payment.status,
            statusDetail: payment.status_detail,
            transactionAmount: payment.transaction_amount,
            currencyId: payment.currency_id,
            dateApproved: payment.date_approved,
          },
        },
      });
      await persist({
        ok: true,
        statusCode: out.statusCode,
        responseText: out.responseText,
        error: null,
        requestSummary: { action, paymentId },
      });
      return out;
    }

    const amountCents = resolveAmountCents(llmArgs, cfg);
    if (amountCents == null) {
      const out = failResult({
        started,
        error: "missing_fields",
        payload: { missingFields: ["amountCents"], action },
      });
      await persist({
        ok: false,
        statusCode: null,
        responseText: out.responseText,
        error: out.error,
        requestSummary: { action },
      });
      return out;
    }
    const amount = amountCents / 100;
    const title = str(llmArgs.title) || str(llmArgs.description) || cfg.defaultTitle;
    const quantity = optionalNumber(llmArgs.quantity) ?? 1;
    const externalReference = `oc|${tool.id}|${conversationId}|${randomUUID().slice(0, 8)}`;

    if (action === "create_checkout_preference") {
      const successUrl = str(llmArgs.successUrl) || cfg.successUrl;
      const cancelUrl = str(llmArgs.cancelUrl) || cfg.cancelUrl;
      const preference = await mercadoPagoRequest<{
        id?: string;
        init_point?: string;
        sandbox_init_point?: string;
      }>({
        accessToken: cfg.accessToken,
        method: "POST",
        path: "/checkout/preferences",
        body: {
          items: [
            {
              title: title.slice(0, 256),
              quantity,
              unit_price: amount,
              currency_id: cfg.currency,
            },
          ],
          metadata: agentMeta,
          external_reference: externalReference,
          notification_url: notificationUrl,
          back_urls: {
            success: successUrl || undefined,
            failure: cancelUrl || undefined,
            pending: cancelUrl || undefined,
          },
          auto_return: successUrl ? "approved" : undefined,
        },
        idempotencyKey: `mp-pref:${tool.id}:${conversationId}:${amountCents}`,
      });
      const url = preference.init_point ?? preference.sandbox_init_point ?? null;
      const out = successResult({
        started,
        payload: {
          action,
          preferenceId: preference.id,
          url,
          amountCents,
          currency: cfg.currency,
        },
      });
      await persist({
        ok: true,
        statusCode: out.statusCode,
        responseText: out.responseText,
        error: null,
        requestSummary: { action, amountCents },
      });
      return out;
    }

    const payerEmail = str(llmArgs.payerEmail) || str(llmArgs.email) || str(llmArgs.customerEmail);
    const idNumber = str(llmArgs.payerIdentificationNumber) || str(llmArgs.cpf) || str(llmArgs.cnpj);
    if (!payerEmail) {
      const out = failResult({
        started,
        error: "missing_fields",
        payload: { missingFields: ["payerEmail"], action },
      });
      await persist({
        ok: false,
        statusCode: null,
        responseText: out.responseText,
        error: out.error,
        requestSummary: { action },
      });
      return out;
    }
    const payerBuilt = buildPixPayer(payerEmail, idNumber);
    if ("error" in payerBuilt) {
      const out = failResult({
        started,
        error: "missing_fields",
        payload: { missingFields: payerBuilt.missingFields, action },
      });
      await persist({
        ok: false,
        statusCode: null,
        responseText: out.responseText,
        error: out.error,
        requestSummary: { action },
      });
      return out;
    }

    const payment = await mercadoPagoRequest<Record<string, unknown>>({
      accessToken: cfg.accessToken,
      method: "POST",
      path: "/v1/payments",
      idempotencyKey: `mp-pix:${tool.id}:${conversationId}:${amountCents}`,
      body: {
        transaction_amount: amount,
        description: title.slice(0, 256),
        payment_method_id: "pix",
        payer: payerBuilt.payer,
        metadata: agentMeta,
        external_reference: externalReference,
        notification_url: notificationUrl,
      },
    });

    const poi = payment.point_of_interaction as Record<string, unknown> | undefined;
    const tx = poi?.transaction_data as Record<string, unknown> | undefined;
    const out = successResult({
      started,
      payload: {
        action,
        paymentId: payment.id,
        status: payment.status,
        amountCents,
        currency: cfg.currency,
        qrCode: tx?.qr_code ?? null,
        qrCodeBase64: tx?.qr_code_base64 ?? null,
        ticketUrl: tx?.ticket_url ?? null,
      },
    });
    await persist({
      ok: true,
      statusCode: out.statusCode,
      responseText: out.responseText,
      error: null,
      requestSummary: { action, amountCents },
    });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const out = failResult({
      started,
      error: "mercadopago_api_error",
      payload: { message: message.slice(0, 500), action },
    });
    await persist({
      ok: false,
      statusCode: null,
      responseText: out.responseText,
      error: out.error,
      requestSummary: { action },
    });
    return out;
  }
}
