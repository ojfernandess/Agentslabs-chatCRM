import {
  acquireLlmQuotaSlot,
  configureLlmQuotaGateDefaults,
  llmQuotaGateKey,
  markLlmQuotaCooldown,
} from "./llmSharedQuotaGate.js";
import { config } from "../config.js";

configureLlmQuotaGateDefaults({
  maxConcurrent: config.nativeLlmMaxConcurrent,
  maxQueueWaitMs: config.nativeLlmMaxQueueWaitMs,
});

export type PreviewChatTurn = { role: "user" | "assistant"; content: string };

export type PreviewLlmUsage = { prompt: number; completion: number; total: number };

/**
 * Novos modelos OpenAI (ex. GPT-5.x) em `/v1/chat/completions` rejeitam `max_tokens` e exigem
 * `max_completion_tokens`. Ver documentação de modelos em https://developers.openai.com/api/docs/models
 */
export function openAiChatCompletionsUsesMaxCompletionTokens(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) return true;
  if (m.startsWith("o1")) return true;
  if (m.startsWith("o3")) return true;
  if (m.startsWith("o4")) return true;
  return false;
}

function applyOpenAiMaxTokensToBody(body: Record<string, unknown>, model: string, maxTokens: number): void {
  if (openAiChatCompletionsUsesMaxCompletionTokens(model)) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }
}

/** Extrai atraso sugerido pelo provider (header Retry-After ou «try again in Xs» no corpo). */
export function parseLlmRetryAfterMs(res: Response, body: string): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const sec = Number(header);
    if (Number.isFinite(sec) && sec > 0) return Math.min(Math.ceil(sec * 1000), 60_000);
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) return Math.min(Math.max(0, dateMs - Date.now()), 60_000);
  }
  const m = body.match(/try again in\s+([\d.]+)\s*s/i);
  if (m) {
    const sec = Number(m[1]);
    if (Number.isFinite(sec) && sec > 0) return Math.min(Math.ceil(sec * 1000) + 300, 60_000);
  }
  return 0;
}

async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * POST com:
 * - gate de concorrência partilhado por API key (vários contactos)
 * - cooldown partilhado em 429 (evita stampede)
 * - retry com backoff no próprio pedido
 */
export async function fetchLlmJsonWithRateLimitRetry(
  url: string,
  init: RequestInit,
  opts?: {
    maxAttempts?: number;
    signal?: AbortSignal;
    /** Chave do gate (ex.: `llmQuotaGateKey("openai", apiKey)`). */
    quotaKey?: string;
    maxQueueWaitMs?: number;
  },
): Promise<{ res: Response; rawText: string }> {
  const maxAttempts = Math.max(1, Math.min(opts?.maxAttempts ?? 4, 6));
  const signal = opts?.signal ?? init.signal ?? undefined;
  const quotaKey = opts?.quotaKey?.trim() || "";
  const release = quotaKey
    ? await acquireLlmQuotaSlot(quotaKey, {
        signal,
        maxQueueWaitMs: opts?.maxQueueWaitMs ?? config.nativeLlmMaxQueueWaitMs,
      })
    : () => undefined;

  try {
    let lastRes: Response | null = null;
    let lastBody = "";
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await fetch(url, { ...init, signal });
      const rawText = await res.text();
      if (res.status !== 429) {
        return { res, rawText };
      }
      lastRes = res;
      lastBody = rawText;
      const fromProvider = parseLlmRetryAfterMs(res, rawText);
      const delayMs =
        fromProvider > 0 ? fromProvider : Math.min(1500 * 2 ** attempt, 20_000);
      if (quotaKey) {
        markLlmQuotaCooldown(quotaKey, delayMs);
      }
      if (attempt >= maxAttempts - 1) break;
      await sleepMs(delayMs, signal ?? undefined);
    }
    return { res: lastRes!, rawText: lastBody };
  } finally {
    release();
  }
}

export { llmQuotaGateKey };

export type OpenAiToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

/**
 * Chat com tools (function calling). Executa `onToolCall` para cada tool_call e reenvia até obter texto final ou esgotar `maxToolRounds`.
 */
export async function callOpenAiCompatibleChatWithTools(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  history: PreviewChatTurn[];
  userMessage: string;
  tools: OpenAiToolDefinition[];
  onToolCall: (name: string, argsJson: string) => Promise<string>;
  /** Invocado quando o modelo devolve texto (ou vazio) junto com tool_calls — antes de executar as ferramentas. */
  onAssistantToolRound?: (input: {
    assistantContent: string | null;
    toolNames: string[];
    round: number;
  }) => Promise<void>;
  maxToolRounds?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; toolRounds: number; usage?: PreviewLlmUsage }> {
  const maxRounds = Math.max(1, Math.min(params.maxToolRounds ?? 6, 12));
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const messages: OpenAiChatMessage[] = [
    { role: "system", content: params.system },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.userMessage },
  ];

  let toolRounds = 0;
  let totalUsage: PreviewLlmUsage | undefined;

  for (;;) {
    const body: Record<string, unknown> = {
      model: params.model,
      temperature: params.temperature,
      messages,
      tools: params.tools,
      tool_choice: "auto",
    };
    applyOpenAiMaxTokensToBody(body, params.model, params.maxTokens);

    const { res, rawText } = await fetchLlmJsonWithRateLimitRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
      {
        signal: params.signal,
        quotaKey: llmQuotaGateKey("openai", params.apiKey),
      },
    );
    if (!res.ok) {
      throw new Error(`OpenAI-compatible API HTTP ${res.status}: ${rawText.slice(0, 800)}`);
    }
    let data: {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: OpenAiChatMessage["tool_calls"];
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
      data = JSON.parse(rawText) as typeof data;
    } catch {
      throw new Error("OpenAI-compatible API returned non-JSON");
    }

    const u = data.usage;
    if (u) {
      const chunk: PreviewLlmUsage = {
        prompt: u.prompt_tokens ?? 0,
        completion: u.completion_tokens ?? 0,
        total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
      };
      totalUsage = totalUsage
        ? {
            prompt: totalUsage.prompt + chunk.prompt,
            completion: totalUsage.completion + chunk.completion,
            total: totalUsage.total + chunk.total,
          }
        : chunk;
    }

    const choice = data.choices?.[0]?.message;
    const toolCalls = choice?.tool_calls?.filter((t) => t.type === "function") ?? [];

    if (toolCalls.length) {
      if (toolRounds >= maxRounds) {
        const fallback =
          (typeof choice?.content === "string" && choice.content.trim()) ||
          "Não foi possível concluir as ações automáticas a tempo. Um agente humano irá ajudá-lo em seguida.";
        return { text: fallback, toolRounds, usage: totalUsage };
      }
      toolRounds++;
      const toolNames = toolCalls.map((tc) => tc.function.name);
      if (params.onAssistantToolRound) {
        await params.onAssistantToolRound({
          assistantContent: typeof choice?.content === "string" ? choice.content : null,
          toolNames,
          round: toolRounds,
        });
      }
      messages.push({
        role: "assistant",
        content: choice?.content ?? null,
        tool_calls: toolCalls,
      });
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
          const name = tc.function.name;
          const out = await params.onToolCall(name, tc.function.arguments ?? "{}");
          return { id: tc.id, content: out };
        }),
      );
      for (const result of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: result.id,
          content: result.content,
        });
      }
      continue;
    }

    const text = choice?.content ?? "";
    return { text: typeof text === "string" ? text : "", toolRounds, usage: totalUsage };
  }
}

export async function callOpenAiCompatibleChat(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  history: PreviewChatTurn[];
  userMessage: string;
  signal?: AbortSignal;
}): Promise<{ text: string; usage?: PreviewLlmUsage }> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: params.system },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.userMessage },
  ];
  const body: Record<string, unknown> = {
    model: params.model,
    temperature: params.temperature,
    messages,
  };
  applyOpenAiMaxTokensToBody(body, params.model, params.maxTokens);

  const { res, rawText } = await fetchLlmJsonWithRateLimitRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    },
    {
      signal: params.signal,
      quotaKey: llmQuotaGateKey("openai", params.apiKey),
    },
  );
  if (!res.ok) {
    throw new Error(`OpenAI-compatible API HTTP ${res.status}: ${rawText.slice(0, 800)}`);
  }
  let data: {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error("OpenAI-compatible API returned non-JSON");
  }
  const text = data.choices?.[0]?.message?.content ?? "";
  const u = data.usage;
  const usage: PreviewLlmUsage | undefined = u
    ? {
        prompt: u.prompt_tokens ?? 0,
        completion: u.completion_tokens ?? 0,
        total:
          u.total_tokens ??
          (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
      }
    : undefined;
  return { text: typeof text === "string" ? text : "", usage };
}

export async function callGeminiGenerateContent(params: {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  history: PreviewChatTurn[];
  userMessage: string;
  signal?: AbortSignal;
}): Promise<{ text: string; usage?: PreviewLlmUsage }> {
  const modelId = params.model.replace(/^models\//, "").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of params.history) {
    contents.push({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    });
  }
  contents.push({ role: "user", parts: [{ text: params.userMessage }] });
  const { res, rawText } = await fetchLlmJsonWithRateLimitRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.system }] },
        contents,
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
        },
      }),
      signal: params.signal,
    },
    {
      signal: params.signal,
      quotaKey: llmQuotaGateKey("google_gemini", params.apiKey),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}: ${rawText.slice(0, 800)}`);
  }
  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error("Gemini API returned non-JSON");
  }
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  const um = data.usageMetadata;
  const usage: PreviewLlmUsage | undefined = um
    ? {
        prompt: um.promptTokenCount ?? 0,
        completion: um.candidatesTokenCount ?? 0,
        total:
          um.totalTokenCount ??
          (um.promptTokenCount ?? 0) + (um.candidatesTokenCount ?? 0),
      }
    : undefined;
  return { text, usage };
}
