import type { FastifyReply } from "fastify";
import { resolveAgentLlmCredentialsForMode } from "./ai-billing/AiCredentialResolver.js";
import type { AiBillingMode } from "./ai-billing/aiBillingTypes.js";
import { getOrganizationAiBillingMode } from "./ai-billing/getOrganizationAiBillingMode.js";
import {
  beginPlatformCreditsLlmUsage,
  cancelPlatformCreditsLlmUsage,
  finalizePlatformCreditsLlmUsage,
  type PlatformCreditsBillingHandle,
} from "./ai-billing/AiUsageBillingService.js";
import { mapPreviewUsageToDetails } from "./ai-billing/llmUsageDetails.js";
import {
  assistOpenAiModel,
  getAssistOpenAiCredentialsForOrganization,
} from "./assistLlmCredentials.js";
import { callOpenAiCompatibleChat, type PreviewChatTurn } from "./promptModulePreviewLlm.js";

export type ResolvedAssistLlmContext = {
  organizationId: string;
  billingMode: AiBillingMode;
  apiKey: string;
  baseUrl: string;
  provider: string;
  model: string;
};

export type AssistLlmResolveResult =
  | { ok: true; ctx: ResolvedAssistLlmContext }
  | { ok: false; reason: "missing_credentials" | "insufficient_balance" };

export class AssistLlmError extends Error {
  constructor(
    readonly code: "insufficient_balance" | "missing_credentials",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AssistLlmError";
  }
}

export async function resolveAssistLlmForOrganization(
  organizationId: string,
): Promise<AssistLlmResolveResult> {
  const billingMode = await getOrganizationAiBillingMode(organizationId);
  const model = assistOpenAiModel();

  if (billingMode === "PLATFORM_CREDITS") {
    const resolved = resolveAgentLlmCredentialsForMode("PLATFORM_CREDITS", { model });
    if (!resolved.apiKey.trim()) {
      return { ok: false, reason: "missing_credentials" };
    }
    return {
      ok: true,
      ctx: {
        organizationId,
        billingMode,
        apiKey: resolved.apiKey,
        baseUrl: resolved.apiBaseUrl.replace(/\/+$/, ""),
        provider: resolved.provider,
        model: resolved.model,
      },
    };
  }

  const creds = await getAssistOpenAiCredentialsForOrganization(organizationId);
  if (!creds) {
    return { ok: false, reason: "missing_credentials" };
  }
  return {
    ok: true,
    ctx: {
      organizationId,
      billingMode: "OWN_API_KEY",
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      provider: "openai",
      model,
    },
  };
}

export async function isAssistLlmConfiguredForOrganization(organizationId: string): Promise<boolean> {
  const resolved = await resolveAssistLlmForOrganization(organizationId);
  return resolved.ok;
}

export type AssistLlmChatParams = {
  temperature: number;
  maxTokens: number;
  system: string;
  history: PreviewChatTurn[];
  userMessage: string;
  signal?: AbortSignal;
  model?: string;
};

export async function callAssistLlmChat(
  ctx: ResolvedAssistLlmContext,
  params: AssistLlmChatParams,
  billingMeta?: { conversationId?: string | null },
): Promise<{ text: string }> {
  const model = params.model?.trim() || ctx.model;
  let platformHandle: PlatformCreditsBillingHandle | null = null;

  if (ctx.billingMode === "PLATFORM_CREDITS") {
    const began = await beginPlatformCreditsLlmUsage({
      organizationId: ctx.organizationId,
      provider: ctx.provider,
      requestedModel: model,
      maxTokens: params.maxTokens,
      conversationId: billingMeta?.conversationId ?? null,
    });
    if (!began.ok) {
      if (began.reason === "insufficient_balance") {
        throw new AssistLlmError("insufficient_balance", "Insufficient AI credits balance");
      }
      throw new AssistLlmError("missing_credentials", "Platform LLM credentials unavailable");
    }
    platformHandle = began;
  }

  try {
    const { text, usage } = await callOpenAiCompatibleChat({
      baseUrl: ctx.baseUrl,
      apiKey: ctx.apiKey,
      model,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      system: params.system,
      history: params.history,
      userMessage: params.userMessage,
      signal: params.signal,
    });

    if (platformHandle?.ok) {
      const details = mapPreviewUsageToDetails(usage, model);
      await finalizePlatformCreditsLlmUsage({
        handle: platformHandle,
        usageParts: details ? [details] : [],
        conversationId: billingMeta?.conversationId ?? null,
      });
    }

    return { text };
  } catch (err) {
    if (platformHandle?.ok) {
      await cancelPlatformCreditsLlmUsage(platformHandle).catch(() => {});
    }
    throw err;
  }
}

export function replyAssistLlmUnavailable(
  reply: FastifyReply,
  result: Extract<AssistLlmResolveResult, { ok: false }>,
) {
  if (result.reason === "insufficient_balance") {
    return reply.status(402).send({
      error: "Payment Required",
      message: "Insufficient AI credits balance",
      code: "ai_credits_insufficient",
      statusCode: 402,
    });
  }
  return reply.status(503).send({
    error: "Service Unavailable",
    message:
      "No OpenAI API key available: configure it for this organization in Settings, or set OPENAI_API_KEY / OPENAI_PROMPT_PREVIEW_KEY on the server.",
    code: "missing_openai_key",
    statusCode: 503,
  });
}

export function replyAssistLlmCallError(reply: FastifyReply, err: unknown) {
  if (err instanceof AssistLlmError) {
    return replyAssistLlmUnavailable(reply, { ok: false, reason: err.code });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return reply.status(502).send({
    error: "Bad Gateway",
    message: msg.slice(0, 500),
    statusCode: 502,
  });
}
