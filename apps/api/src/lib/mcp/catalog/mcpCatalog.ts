import { getPublicOrigin } from "../../../config.js";

export type McpCatalogTool = {
  name: string;
  description: string;
  domain?: string;
  write?: boolean;
  conditional?: string;
};

export type McpCatalogResource = {
  name: string;
  uri: string;
  description: string;
};

export type McpCatalogProvider = {
  domain: string;
  description: string;
};

export type McpCatalogServer = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  transport: "streamable-http" | "stdio" | "stdio-bridge";
  access: "super_admin";
  auth: string[];
  endpoint?: string;
  entrypoint?: string;
  envVars?: string[];
  tools: McpCatalogTool[];
  resources: McpCatalogResource[];
  providers: McpCatalogProvider[];
  category: "platform" | "integration" | "observability";
  accent: "violet" | "emerald" | "sky" | "amber";
  cursorConfigKey: string;
};

const OPENNEXO_PROVIDERS: McpCatalogProvider[] = [
  { domain: "agents", description: "Agentes / bots da organização" },
  { domain: "prompts", description: "Módulos de prompt" },
  { domain: "tools", description: "Ferramentas de automação" },
  { domain: "logs", description: "Logs de execução" },
  { domain: "executions", description: "Execuções de agentes" },
  { domain: "workflow", description: "Grafos de workflow" },
  { domain: "langgraph", description: "Runtime LangGraph" },
  { domain: "memory", description: "Memória conversacional" },
  { domain: "knowledge", description: "Base de conhecimento / RAG" },
  { domain: "vector", description: "Backend vectorial" },
  { domain: "observability", description: "Traces Langfuse" },
  { domain: "workflow_validator", description: "Validação de workflows" },
  { domain: "supervisor", description: "Decisões do supervisor" },
  { domain: "eil", description: "Execution Intelligence Layer" },
  { domain: "turn", description: "TurnContext por execução" },
  { domain: "contract", description: "ExecutionContract por execução" },
  { domain: "config", description: "Configuração da organização" },
  { domain: "architecture", description: "Governança arquitetural (ADR/RCA)" },
  { domain: "webhook", description: "Webhooks WhatsApp inbound" },
  { domain: "nvoip", description: "Integração Nvoip (voz, SMS, WhatsApp)" },
];

const OPENNEXO_TOOLS: McpCatalogTool[] = [
  { name: "search_agent", description: "Search agents/bots in the organization", domain: "agents" },
  { name: "search_tool", description: "Search automation tools", domain: "tools" },
  { name: "search_prompt", description: "Search prompt modules", domain: "prompts" },
  { name: "search_execution", description: "Search agent executions", domain: "executions" },
  { name: "search_error", description: "Search errors in execution logs", domain: "logs" },
  { name: "search_logs", description: "Search execution log entries", domain: "logs" },
  { name: "search_memory", description: "Search conversation memory contexts", domain: "memory" },
  { name: "search_document", description: "Search knowledge base documents", domain: "knowledge" },
  { name: "search_trace", description: "Find Langfuse/observability trace for an execution", domain: "observability" },
  { name: "search_workflow", description: "Get workflow graph for an agent", domain: "workflow" },
  { name: "search_supervisor", description: "Get supervisor decisions for an execution", domain: "supervisor" },
  { name: "search_eil", description: "Search EIL snapshots (facts, plan, policies, violations)", domain: "eil" },
  { name: "search_turn", description: "Get TurnContext for an execution", domain: "turn" },
  { name: "search_contract", description: "Get ExecutionContract for an execution", domain: "contract" },
  { name: "get_eil_snapshot", description: "Get EIL snapshot for an execution", domain: "eil" },
  { name: "apply_eil_policy", description: "Apply declarative EIL policies to an agent", domain: "eil", write: true },
  { name: "search_metrics", description: "Get tool execution metrics (slowest tools, error rates)", domain: "tools" },
  { name: "search_config", description: "Get organization automation configuration", domain: "config" },
  { name: "search_integrations", description: "List enabled integrations (Mem0, Langfuse, vector backend)", domain: "config" },
  { name: "search_nvoip", description: "Nvoip diagnostics — account, trunks, DIDs, logs, balance", domain: "nvoip" },
  { name: "search_webhook", description: "Monitor WhatsApp inbound webhooks (Meta, 360dialog, Evolution, Twilio)", domain: "webhook" },
  { name: "get_agent_prompt", description: "Get assembled prompt for an agent", domain: "prompts" },
  { name: "get_execution_inspector", description: "Full execution inspector — tools, supervisor, tokens, timeline", domain: "executions" },
  { name: "list_resources", description: "List all available MCP resources for this organization" },
  { name: "search_adr", description: "Search Architecture Decision Records (AGS)", domain: "architecture" },
  { name: "search_rca", description: "Search Root Cause Registry (AGS)", domain: "architecture" },
  { name: "architecture_impact_analysis", description: "Analyze architecture impact for changed files", domain: "architecture" },
  { name: "architecture_review", description: "Pre-implementation architecture review", domain: "architecture" },
  { name: "architecture_timeline", description: "Timeline of ADRs and RCAs", domain: "architecture" },
  { name: "architecture_dependency_graph", description: "OpenNexo Runtime component dependency graph", domain: "architecture" },
  {
    name: "list_mcp_audit",
    description: "List MCP access audit log entries",
    domain: "audit",
    conditional: "Requires audit:read permission",
  },
];

const OPENNEXO_RESOURCES: McpCatalogResource[] = [
  { name: "agents", uri: "opennexo://agents/{botId}", description: "Agent profile and configuration" },
  { name: "executions", uri: "opennexo://executions/{executionId}", description: "Agent execution inspector" },
  { name: "turn", uri: "opennexo://turn/{executionId}", description: "TurnContext snapshot (intent, prompt hash, required tools)" },
  { name: "contract", uri: "opennexo://contract/{executionId}", description: "ExecutionContract (pending/satisfied tools, violations)" },
  { name: "architecture_adr", uri: "opennexo://architecture/adr/{adrId}", description: "Architecture Decision Record (AGS)" },
];

/** Catálogo estático de servidores MCP disponíveis na plataforma. */
export function getMcpCatalog(): { servers: McpCatalogServer[]; endpoint: string } {
  const endpoint = `${getPublicOrigin()}/api/v1/super/mcp`;

  return {
    endpoint,
    servers: [
      {
        id: "opennexo",
        name: "OpenNexo MCP",
        tagline: "Plataforma de agentes — inspeção completa",
        description:
          "Servidor MCP principal da plataforma. Expõe agentes, execuções, prompts, ferramentas, logs, memória, RAG, workflows LangGraph, traces, EIL, webhooks e governança arquitetural. Acesso exclusivo super admin.",
        transport: "streamable-http",
        access: "super_admin",
        auth: ["Bearer ocm_* (token MCP)", "Bearer JWT (SUPER_ADMIN + organization-id header)"],
        endpoint,
        entrypoint: "apps/api/src/mcp-stdio.ts (local) · apps/api/src/mcp-http-bridge.ts (Cursor bridge)",
        envVars: ["OPENNEXO_MCP_TOKEN", "OPENNEXO_MCP_URL (opcional)"],
        tools: OPENNEXO_TOOLS,
        resources: OPENNEXO_RESOURCES,
        providers: OPENNEXO_PROVIDERS,
        category: "platform",
        accent: "violet",
        cursorConfigKey: "opennexo",
      },
      {
        id: "nvoip",
        name: "Nvoip MCP",
        tagline: "Voz, SMS, WhatsApp e PABX — diagnóstico",
        description:
          "Servidor MCP dedicado à integração Nvoip. Consulta conta, saldo, trunks, DIDs, logs e insights. Somente leitura — não altera configuração nem dispara chamadas.",
        transport: "stdio-bridge",
        access: "super_admin",
        auth: ["OPENNEXO_MCP_TOKEN ou NVOIP_MCP_TOKEN (ocm_*)"],
        endpoint: `${endpoint}/nvoip`,
        entrypoint: "apps/api/src/mcp-nvoip-http-bridge.ts (Cursor) · apps/api/src/mcp-nvoip-stdio.ts (Docker com DB)",
        envVars: ["OPENNEXO_MCP_TOKEN", "NVOIP_MCP_TOKEN", "NVOIP_MCP_URL (opcional)"],
        tools: [
          {
            name: "search_nvoip",
            description:
              "Account, insights, logs, trunks, DIDs, balance, test_connection, whatsapp, sip_users, pabx_trunk",
            domain: "nvoip",
          },
          { name: "list_nvoip_resources", description: "List Nvoip MCP resources (account URI)", domain: "nvoip" },
        ],
        resources: [
          {
            name: "nvoip_account",
            uri: "nvoip://account/{organizationId}",
            description: "Nvoip account summary for the MCP token organization",
          },
        ],
        providers: [{ domain: "nvoip", description: "Integração Nvoip (voz, SMS, WhatsApp, PABX)" }],
        category: "integration",
        accent: "emerald",
        cursorConfigKey: "nvoip",
      },
      {
        id: "langfuse",
        name: "Langfuse MCP",
        tagline: "Observabilidade LLM — traces e prompts",
        description:
          "Ponte stdio para o MCP remoto do Langfuse Cloud. Expõe ferramentas de observabilidade (traces, sessions, prompts) via Basic Auth. Requer credenciais Langfuse configuradas.",
        transport: "stdio-bridge",
        access: "super_admin",
        auth: ["LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY (Basic Auth)"],
        entrypoint: "apps/api/src/mcp-langfuse-bridge.ts",
        envVars: ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"],
        tools: [
          { name: "get_trace", description: "Fetch a Langfuse trace by ID", domain: "observability" },
          { name: "list_traces", description: "List traces with filters", domain: "observability" },
          { name: "get_prompt", description: "Fetch a Langfuse prompt", domain: "observability" },
        ],
        resources: [],
        providers: [{ domain: "observability", description: "Langfuse Cloud (externo)" }],
        category: "observability",
        accent: "sky",
        cursorConfigKey: "langfuse",
      },
    ],
  };
}
