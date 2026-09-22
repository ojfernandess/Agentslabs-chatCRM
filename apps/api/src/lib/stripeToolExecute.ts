import Stripe from "stripe";
import { prisma } from "../db.js";
import type { AutomationHttpToolRow } from "./automationHttpToolExecute.js";
import type { AutomationHttpToolRow } from "./automationHttpToolExecute.js";

export const ORG_STRIPE_TOOL_SCOPE = "organization_agent";

export function buildOrganizationStripeToolMetadata(input: {
  organizationId: string;
  conversationId: string;
  toolId: string;
}): Record<string, string> {
  return {
    openconduitToolScope: ORG_STRIPE_TOOL_SCOPE,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    toolId: input.toolId,
  };
}

export function isOrganizationAgentStripeMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  const m = metadata ?? {};
  const scope = m.openconduitToolScope;
  if (typeof scope === "string" && str(scope) === ORG_STRIPE_TOOL_SCOPE) return true;
  const toolId = m.toolId;
  return typeof toolId === "string" && Boolean(str(toolId));
}

export type StripeAction =
  | "list_products"
  | "list_prices"
  | "create_payment_link"
  | "create_checkout_session";

export type StripeToolConfig = {
  secretKey: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
  defaultPriceId: string;
  currency: string;
};

const STRIPE_ACTIONS = new Set<StripeAction>([
  "list_products",
  "list_prices",
  "create_payment_link",
  "create_checkout_session",
]);

const STRIPE_ACTION_ALIASES: Record<string, StripeAction> = {
  list_products: "list_products",
  list_prices: "list_prices",
  get_prices: "list_prices",
  consult_prices: "list_prices",
  consult_plans: "list_prices",
  create_payment_link: "create_payment_link",
  payment_link: "create_payment_link",
  generate_payment_link: "create_payment_link",
  create_checkout_session: "create_checkout_session",
  checkout_session: "create_checkout_session",
  checkout: "create_checkout_session",
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

export function isStripeAutomationTool(row: { toolType: string; config?: unknown }): boolean {
  const t = row.toolType.toUpperCase().replace(/-/g, "_");
  if (t === "STRIPE") return true;
  if (t !== "INTEGRATION") return false;
  const c = asRecord(row.config);
  return str(c.provider).toLowerCase() === "stripe";
}

export function parseStripeAction(raw: unknown): StripeAction | null {
  const normalized = str(raw).toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  const mapped = STRIPE_ACTION_ALIASES[normalized];
  if (mapped) return mapped;
  return STRIPE_ACTIONS.has(normalized as StripeAction) ? (normalized as StripeAction) : null;
}

export function readStripeToolConfig(cfg: unknown): StripeToolConfig {
  const c = asRecord(cfg);
  return {
    secretKey: str(c.secretKey),
    webhookSecret: str(c.webhookSecret),
    successUrl: str(c.successUrl),
    cancelUrl: str(c.cancelUrl),
    defaultPriceId: str(c.defaultPriceId),
    currency: str(c.currency).toLowerCase(),
  };
}

export function normalizeStripeLlmArgs(llmArgs: Record<string, unknown>): Record<string, unknown> {
  const params = asRecord(llmArgs.params);
  if (Object.keys(params).length === 0) return llmArgs;
  return { ...params, ...llmArgs };
}

export function buildStripeAgentToolDescription(config: unknown): string {
  const cfg = readStripeToolConfig(config);
  const parts: string[] = [
    "Pagamentos Stripe. Fluxo: list_prices ou list_products para consultar planos e valores reais → create_payment_link ou create_checkout_session com priceId escolhido. Nunca invente preços.",
  ];
  if (cfg.defaultPriceId) {
    parts.push(`Price ID predefinido: ${cfg.defaultPriceId}.`);
  } else {
    parts.push("Se o priceId não estiver no config, use list_prices antes de gerar o link.");
  }
  if (cfg.successUrl) parts.push(`URL de sucesso predefinida: ${cfg.successUrl}.`);
  if (cfg.cancelUrl) parts.push(`URL de cancelamento predefinida: ${cfg.cancelUrl}.`);
  if (cfg.webhookSecret) {
    parts.push("Pagamentos confirmados via webhook actualizam paymentStatus=paid nos flowSlots da conversa.");
  }
  parts.push("Envie ao cliente apenas a URL devolvida (url).");
  return parts.join(" ");
}

function summarizePrice(price: Stripe.Price, productName?: string | null): Record<string, unknown> {
  return {
    id: price.id,
    productId: typeof price.product === "string" ? price.product : price.product?.id ?? null,
    productName: productName ?? null,
    nickname: price.nickname ?? null,
    unitAmount: price.unit_amount,
    currency: price.currency,
    type: price.type,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
    billingScheme: price.billing_scheme,
  };
}

function summarizeProduct(product: Stripe.Product): Record<string, unknown> {
  const defaultPrice =
    product.default_price && typeof product.default_price === "object"
      ? summarizePrice(product.default_price as Stripe.Price, product.name)
      : null;
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    active: product.active,
    defaultPrice,
  };
}

async function logStripeExecution(input: {
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
}): {
  ok: false;
  statusCode: number | null;
  responseText: string;
  error: string;
  durationMs: number;
} {
  return {
    ok: false,
    statusCode: input.statusCode ?? null,
    responseText: JSON.stringify({ ok: false, error: input.error, ...input.payload }),
    error: input.error,
    durationMs: Date.now() - input.started,
  };
}

function successResult(input: {
  started: number;
  payload: Record<string, unknown>;
  statusCode?: number;
}): {
  ok: true;
  statusCode: number;
  responseText: string;
  error: null;
  durationMs: number;
} {
  return {
    ok: true,
    statusCode: input.statusCode ?? 200,
    responseText: JSON.stringify({ ok: true, ...input.payload }),
    error: null,
    durationMs: Date.now() - input.started,
  };
}

function stripeClient(secretKey: string): Stripe {
  const apiVersion = (process.env.STRIPE_API_VERSION ?? "2025-02-24.acacia").trim();
  return new Stripe(secretKey, { apiVersion: apiVersion as Stripe.LatestApiVersion });
}

function resolvePriceId(llmArgs: Record<string, unknown>, cfg: StripeToolConfig): string {
  return str(llmArgs.priceId) || str(llmArgs.price_id) || cfg.defaultPriceId;
}

function resolveQuantity(llmArgs: Record<string, unknown>): number {
  return optionalNumber(llmArgs.quantity) ?? 1;
}

/**
 * Executa ferramenta Stripe da organização com secret key em config.
 */
export async function runStripeTool(input: {
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

  if (!isStripeAutomationTool(tool)) {
    return failResult({ started, error: "unsupported_tool_type", payload: {} });
  }
  if (tool.organizationId !== organizationId) {
    return failResult({ started, error: "organization_mismatch", payload: {} });
  }

  const cfg = readStripeToolConfig(tool.config);
  const llmArgs = normalizeStripeLlmArgs(input.llmArgs);
  const action = parseStripeAction(llmArgs.action);

  const persist = async (result: {
    ok: boolean;
    statusCode: number | null;
    responseText: string;
    error: string | null;
    requestSummary: Record<string, unknown>;
  }) => {
    await logStripeExecution({
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
      payload: {
        missingFields: ["action"],
        allowed: [...STRIPE_ACTIONS],
      },
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

  if (!cfg.secretKey || cfg.secretKey === "***") {
    const out = failResult({
      started,
      error: "stripe_not_connected",
      payload: {
        message:
          "Stripe não está ligado. Guarde a secret key (restricted key recomendada) no painel da ferramenta.",
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

  const stripe = stripeClient(cfg.secretKey);

  try {
    if (action === "list_products") {
      const activeOnly = llmArgs.active !== false;
      const products = await stripe.products.list({
        active: activeOnly,
        limit: 100,
        expand: ["data.default_price"],
      });
      const items = products.data.map((product) => summarizeProduct(product));
      const out = successResult({ started, payload: { action, count: items.length, products: items } });
      await persist({
        ok: true,
        statusCode: out.statusCode,
        responseText: out.responseText,
        error: null,
        requestSummary: { action },
      });
      return out;
    }

    if (action === "list_prices") {
      const productId = str(llmArgs.productId) || str(llmArgs.product_id);
      const currency = str(llmArgs.currency).toLowerCase() || cfg.currency;
      const prices = await stripe.prices.list({
        active: true,
        limit: 100,
        ...(productId ? { product: productId } : {}),
        expand: ["data.product"],
      });
      const productNames = new Map<string, string>();
      const items = prices.data
        .filter((price) => !currency || price.currency === currency)
        .map((price) => {
          const product =
            price.product && typeof price.product === "object" ? (price.product as Stripe.Product) : null;
          if (product?.id && product.name) productNames.set(product.id, product.name);
          return summarizePrice(price, product?.name ?? null);
        });
      const out = successResult({ started, payload: { action, count: items.length, prices: items } });
      await persist({
        ok: true,
        statusCode: out.statusCode,
        responseText: out.responseText,
        error: null,
        requestSummary: { action, productId: productId || null, currency: currency || null },
      });
      return out;
    }

    const priceId = resolvePriceId(llmArgs, cfg);
    if (!priceId) {
      const out = failResult({
        started,
        error: "missing_fields",
        payload: { missingFields: ["priceId"], action },
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

    const quantity = resolveQuantity(llmArgs);

    if (action === "create_payment_link") {
      const agentMeta = buildOrganizationStripeToolMetadata({
        organizationId,
        conversationId,
        toolId: tool.id,
      });
      const link = await stripe.paymentLinks.create({
        line_items: [{ price: priceId, quantity }],
        metadata: agentMeta,
      });
      const out = successResult({
        started,
        payload: {
          action,
          id: link.id,
          url: link.url,
          priceId,
          quantity,
        },
      });
      await persist({
        ok: true,
        statusCode: out.statusCode,
        responseText: out.responseText,
        error: null,
        requestSummary: { action, priceId, quantity },
      });
      return out;
    }

    const price = await stripe.prices.retrieve(priceId);
    const successUrl = str(llmArgs.successUrl) || str(llmArgs.success_url) || cfg.successUrl;
    const cancelUrl = str(llmArgs.cancelUrl) || str(llmArgs.cancel_url) || cfg.cancelUrl;
    const missing: string[] = [];
    if (!successUrl) missing.push("successUrl");
    if (!cancelUrl) missing.push("cancelUrl");
    if (missing.length > 0) {
      const out = failResult({
        started,
        error: "missing_fields",
        payload: { missingFields: missing, action },
      });
      await persist({
        ok: false,
        statusCode: null,
        responseText: out.responseText,
        error: out.error,
        requestSummary: { action, priceId },
      });
      return out;
    }

    const customerEmail = str(llmArgs.customerEmail) || str(llmArgs.email);
    const agentMeta = buildOrganizationStripeToolMetadata({
      organizationId,
      conversationId,
      toolId: tool.id,
    });
    const session = await stripe.checkout.sessions.create({
      mode: price.type === "recurring" ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: conversationId || undefined,
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      metadata: agentMeta,
      ...(price.type === "recurring"
        ? {
            subscription_data: {
              metadata: agentMeta,
            },
          }
        : {
            payment_intent_data: {
              metadata: agentMeta,
            },
          }),
    });
    const out = successResult({
      started,
      payload: {
        action,
        sessionId: session.id,
        url: session.url,
        priceId,
        quantity,
        mode: price.type === "recurring" ? "subscription" : "payment",
      },
    });
    await persist({
      ok: true,
      statusCode: out.statusCode,
      responseText: out.responseText,
      error: null,
      requestSummary: { action, priceId, quantity, mode: price.type },
    });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const out = failResult({
      started,
      error: "stripe_api_error",
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
