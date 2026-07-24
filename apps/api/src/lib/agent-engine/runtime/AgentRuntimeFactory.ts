import type { AgentEngineConfig } from "../types.js";
import type { AgentRuntime } from "./AgentRuntime.js";
import { OpenNexoRuntime, type NativeAgentExecutor } from "./OpenNexoRuntime.js";
import { LangGraphRuntime } from "./LangGraphRuntime.js";
import { CrewAIRuntime } from "./CrewAIRuntime.js";
import { AutoGenRuntime } from "./AutoGenRuntime.js";
import { MastraRuntime } from "./MastraRuntime.js";

/** Factory Pattern — registo central de motores. */
export class AgentRuntimeFactory {
  private static executors = new Map<string, NativeAgentExecutor>();

  static registerExecutor(kind: string, executor: NativeAgentExecutor): void {
    this.executors.set(kind, executor);
  }

  static create(config: AgentEngineConfig): AgentRuntime {
    const executor = this.executors.get("_default");
    if (!executor) {
      throw new Error("AgentRuntimeFactory: native executor not registered");
    }

    switch (config.runtime) {
      case "langgraph":
        return new LangGraphRuntime(executor);
      case "crewai":
        return new CrewAIRuntime(executor);
      case "autogen":
        return new AutoGenRuntime(executor);
      case "mastra":
        return new MastraRuntime(executor);
      case "openconduit":
      default:
        return new OpenNexoRuntime(executor);
    }
  }
}
