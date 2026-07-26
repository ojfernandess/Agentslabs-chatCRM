const API_BASE = "/api/v1";
const TOKEN_KEY = "openconduit_token";

export type AgentGraphStreamEvent = {
  kind: string;
  at: string;
  nodeId?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
};

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  return headers;
}

/** Consome SSE LangGraph com Bearer auth (fetch stream). */
export function subscribeAgentGraphEventStream(
  threadId: string,
  onEvent: (event: AgentGraphStreamEvent) => void,
  options?: { signal?: AbortSignal; onError?: (err: unknown) => void },
): () => void {
  const controller = new AbortController();
  if (options?.signal) {
    if (options.signal.aborted) {
      return () => undefined;
    }
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const signal = controller.signal;

  void (async () => {
    try {
      const response = await fetch(
        `${API_BASE}/automation/agent-engine/events/stream/${encodeURIComponent(threadId)}`,
        { headers: authHeaders(), signal },
      );
      if (!response.ok || !response.body) {
        options?.onError?.(new Error(`SSE ${response.status}`));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as AgentGraphStreamEvent;
            onEvent(payload);
          } catch {
            /* ignore malformed */
          }
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      options?.onError?.(err);
    }
  })();

  return () => controller.abort();
}
