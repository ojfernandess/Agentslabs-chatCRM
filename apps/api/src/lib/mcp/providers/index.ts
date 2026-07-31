import { agentsProvider } from "./agentsProvider.js";
import {
  configProvider,
  observabilityProvider,
  supervisorProvider,
  workflowValidatorProvider,
} from "./observabilityProvider.js";
import { promptsProvider } from "./promptsProvider.js";
import { registerMcpProvider } from "./ProviderRegistry.js";
import { toolsProvider } from "./toolsProvider.js";
import { executionsProvider } from "./executionsProvider.js";
import { langgraphProvider, workflowProvider } from "./workflowProvider.js";
import {
  knowledgeProvider,
  vectorProvider,
} from "./knowledgeProvider.js";
import { logsProvider } from "./logsProvider.js";
import { memoryProvider } from "./memoryProvider.js";
import { eilProvider } from "./eilProvider.js";
import { turnProvider, contractProvider } from "./turnContractProvider.js";
import { architectureGovernanceProvider } from "./architectureGovernanceProvider.js";

let initialized = false;

/** Regista todos os providers MCP built-in. Novos domínios: registerMcpProvider(). */
export function initMcpProviders(): void {
  if (initialized) return;
  registerMcpProvider(agentsProvider);
  registerMcpProvider(promptsProvider);
  registerMcpProvider(toolsProvider);
  registerMcpProvider(logsProvider);
  registerMcpProvider(executionsProvider);
  registerMcpProvider(workflowProvider);
  registerMcpProvider(langgraphProvider);
  registerMcpProvider(memoryProvider);
  registerMcpProvider(knowledgeProvider);
  registerMcpProvider(vectorProvider);
  registerMcpProvider(observabilityProvider);
  registerMcpProvider(workflowValidatorProvider);
  registerMcpProvider(supervisorProvider);
  registerMcpProvider(eilProvider);
  registerMcpProvider(turnProvider);
  registerMcpProvider(contractProvider);
  registerMcpProvider(configProvider);
  registerMcpProvider(architectureGovernanceProvider);
  initialized = true;
}
