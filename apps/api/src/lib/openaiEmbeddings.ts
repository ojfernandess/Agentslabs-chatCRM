import { config } from "../config.js";

type EmbeddingsResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
};

/** Uma chamada à API de embeddings (OpenAI). `inputs` deve ser pequeno (ex.: ≤ 16). */
export async function embedTextsBatch(params: {
  apiKey: string;
  model: string;
  inputs: string[];
  signal?: AbortSignal;
}): Promise<number[][]> {
  const base = config.openAiApiBaseUrl.replace(/\/+$/, "");
  const url = `${base}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      input: params.inputs,
    }),
    signal: params.signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI embeddings HTTP ${res.status}: ${raw.slice(0, 800)}`);
  }
  let data: EmbeddingsResponse;
  try {
    data = JSON.parse(raw) as EmbeddingsResponse;
  } catch {
    throw new Error("OpenAI embeddings returned non-JSON");
  }
  if (data.error?.message) {
    throw new Error(data.error.message);
  }
  const rows = data.data ?? [];
  const out: number[][] = new Array(params.inputs.length);
  for (const row of rows) {
    const idx = row.index;
    const emb = row.embedding;
    if (typeof idx === "number" && Array.isArray(emb)) {
      out[idx] = emb.map((n) => Number(n));
    }
  }
  for (let i = 0; i < out.length; i++) {
    if (!out[i]?.length) {
      throw new Error(`OpenAI embeddings: missing vector for input index ${i}`);
    }
  }
  return out;
}

export async function embedTextsBatched(params: {
  apiKey: string;
  model: string;
  inputs: string[];
  batchSize?: number;
  signal?: AbortSignal;
}): Promise<number[][]> {
  const batchSize = Math.max(1, Math.min(params.batchSize ?? 16, 32));
  const all: number[][] = [];
  for (let i = 0; i < params.inputs.length; i += batchSize) {
    const slice = params.inputs.slice(i, i + batchSize);
    const part = await embedTextsBatch({
      apiKey: params.apiKey,
      model: params.model,
      inputs: slice,
      signal: params.signal,
    });
    all.push(...part);
  }
  return all;
}
