import { Command, isGraphInterrupt } from "@langchain/langgraph";
import type { FastifyBaseLogger } from "fastify";
import { LangGraphRuntime } from "../runtime/LangGraphRuntime.js";
import type { AgentCheckpointStoreKind } from "../types.js";

export async function resumeLangGraphFromHitl(input: {
  organizationId: string;
  threadId: string;
  checkpointStore: AgentCheckpointStoreKind;
  decision: "approved" | "rejected";
  log: FastifyBaseLogger;
}): Promise<boolean> {
  const runtime = new LangGraphRuntime(async () => ({ reply: "" }));
  const graph = runtime.buildGraphForResume(
    input.checkpointStore,
    input.organizationId,
  );
  const config = { configurable: { thread_id: input.threadId } };
  try {
    await graph.invoke(new Command({ resume: input.decision }), config);
    return true;
  } catch (err) {
    if (isGraphInterrupt(err)) {
      input.log.info({ threadId: input.threadId }, "LangGraph still interrupted after resume attempt");
      return false;
    }
    throw err;
  }
}
