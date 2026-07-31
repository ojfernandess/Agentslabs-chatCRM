/** Níveis de acesso MCP do OpenNexo CRM. */
export type McpRole =
  | "admin"
  | "developer"
  | "support"
  | "audit"
  | "read_only"
  | "custom";

/** Domínios de recurso expostos via MCP. */
export type McpResourceDomain =
  | "agents"
  | "prompts"
  | "tools"
  | "logs"
  | "executions"
  | "workflow"
  | "langgraph"
  | "memory"
  | "knowledge"
  | "vector"
  | "observability"
  | "workflow_validator"
  | "supervisor"
  | "eil"
  | "turn"
  | "contract"
  | "config"
  | "architecture";

/** Permissões granulares por recurso. */
export type McpPermission =
  | "agents:read"
  | "agents:debug"
  | "prompts:read"
  | "prompts:debug"
  | "tools:read"
  | "tools:logs"
  | "logs:read"
  | "logs:search"
  | "executions:read"
  | "executions:debug"
  | "workflow:read"
  | "langgraph:read"
  | "langgraph:checkpoint"
  | "memory:read"
  | "knowledge:read"
  | "vector:read"
  | "vector:search"
  | "observability:read"
  | "observability:traces"
  | "workflow_validator:read"
  | "supervisor:read"
  | "eil:read"
  | "eil:write"
  | "turn:read"
  | "contract:read"
  | "config:read"
  | "architecture:read"
  | "audit:read";

/** Contexto autenticado de um pedido MCP. */
export type McpAuthContext = {
  organizationId: string;
  userId: string | null;
  tokenId: string | null;
  role: McpRole;
  permissions: Set<McpPermission>;
  allowedBotIds: string[] | null;
  environment: string | null;
  debugMode: boolean;
  authMethod: "mcp_token" | "jwt" | "user_api_token" | "agent_bot_token";
  clientName: string | null;
  ipAddress: string | null;
};

/** Contexto completo de um pedido MCP (auth + metadados). */
export type McpRequestContext = McpAuthContext & {
  startedAt: number;
};

export type McpResourceDescriptor = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type McpProviderSearchParams = {
  query?: string;
  botId?: string;
  executionId?: string;
  conversationId?: string;
  contactId?: string;
  toolId?: string;
  errorOnly?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};
