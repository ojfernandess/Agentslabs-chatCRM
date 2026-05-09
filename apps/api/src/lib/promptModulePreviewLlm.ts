export type PreviewChatTurn = { role: "user" | "assistant"; content: string };

export type PreviewLlmUsage = { prompt: number; completion: number; total: number };

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
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      messages,
    }),
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
