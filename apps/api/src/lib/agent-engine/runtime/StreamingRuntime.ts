/**
 * Streaming Runtime — AsyncIterable sobre AgentGraphEventBus + execute().
 * Não substitui LangGraph stream; unifica consumo client-side.
 */

import type {
  AgentGraphEvent,
  AgentRuntimeExecuteInput,
  AgentRuntimeExecuteResult,
} from "../types.js";
import type { AgentRuntime } from "./AgentRuntime.js";
import { publishGraphEvent, subscribeGraphEvents } from "../observability/AgentGraphEventBus.js";

export type StreamRuntimeEvent =
  | { type: "graph"; event: AgentGraphEvent }
  | { type: "result"; result: AgentRuntimeExecuteResult }
  | { type: "error"; error: string };

export type ExecuteStreamOpts = {
  /** Thread do event bus — default conversation:message. */
  threadId?: string;
};

function defaultThreadId(input: AgentRuntimeExecuteInput): string {
  return `${input.conversation.id}:${input.message.id}`;
}

/**
 * Executa o runtime e faz yield dos eventos do bus + resultado final.
 * Útil para SSE / WebSocket sem alterar o contrato `execute()`.
 */
export async function* executeRuntimeStream(
  runtime: AgentRuntime,
  input: AgentRuntimeExecuteInput,
  opts: ExecuteStreamOpts = {},
): AsyncGenerator<StreamRuntimeEvent> {
  const threadId = opts.threadId ?? defaultThreadId(input);
  const queue: StreamRuntimeEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  const push = (ev: StreamRuntimeEvent) => {
    queue.push(ev);
    wake?.();
  };

  const unsub = subscribeGraphEvents(threadId, (event) => {
    push({ type: "graph", event });
  });

  publishGraphEvent(threadId, {
    kind: "start",
    at: new Date().toISOString(),
    detail: `stream:${runtime.kind}`,
  });

  const execPromise = runtime.execute(input).then(
    (result) => {
      push({ type: "result", result });
      closed = true;
      wake?.();
    },
    (err: unknown) => {
      push({
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      closed = true;
      wake?.();
    },
  );

  try {
    while (!closed || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      const next = queue.shift()!;
      yield next;
    }
    await execPromise;
  } finally {
    unsub();
    publishGraphEvent(threadId, {
      kind: "end",
      at: new Date().toISOString(),
      detail: "stream_closed",
    });
  }
}

/** Consome o stream até ao resultado (helper de testes / clients). */
export async function collectRuntimeStream(
  runtime: AgentRuntime,
  input: AgentRuntimeExecuteInput,
  opts?: ExecuteStreamOpts,
): Promise<{
  events: AgentGraphEvent[];
  result?: AgentRuntimeExecuteResult;
  error?: string;
}> {
  const events: AgentGraphEvent[] = [];
  let result: AgentRuntimeExecuteResult | undefined;
  let error: string | undefined;
  for await (const item of executeRuntimeStream(runtime, input, opts)) {
    if (item.type === "graph") events.push(item.event);
    else if (item.type === "result") result = item.result;
    else error = item.error;
  }
  return { events, result, error };
}
