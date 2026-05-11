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

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
    const rawText = await res.text();
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
      messages.push({
        role: "assistant",
        content: choice?.content ?? null,
        tool_calls: toolCalls,
      });
      for (const tc of toolCalls) {
        const name = tc.function.name;
        const out = await params.onToolCall(name, tc.function.arguments ?? "{}");
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: out,
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

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });
  const rawText = await res.text();
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
  const res = await fetch(url, {
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
  });
  const rawText = await res.text();
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
