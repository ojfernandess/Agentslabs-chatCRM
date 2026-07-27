import type { McpPermission, McpRole } from "../types.js";

/** Permissões por role predefinido. */
export const MCP_ROLE_PERMISSIONS: Record<Exclude<McpRole, "custom">, McpPermission[]> = {
  admin: [
    "agents:read",
    "agents:debug",
    "prompts:read",
    "prompts:debug",
    "tools:read",
    "tools:logs",
    "logs:read",
    "logs:search",
    "executions:read",
    "executions:debug",
    "workflow:read",
    "langgraph:read",
    "langgraph:checkpoint",
    "memory:read",
    "knowledge:read",
    "vector:read",
    "vector:search",
    "observability:read",
    "observability:traces",
    "workflow_validator:read",
    "supervisor:read",
    "config:read",
    "audit:read",
  ],
  developer: [
    "agents:read",
    "agents:debug",
    "prompts:read",
    "prompts:debug",
    "tools:read",
    "tools:logs",
    "logs:read",
    "logs:search",
    "executions:read",
    "executions:debug",
    "workflow:read",
    "langgraph:read",
    "langgraph:checkpoint",
    "memory:read",
    "knowledge:read",
    "vector:read",
    "vector:search",
    "observability:read",
    "observability:traces",
    "workflow_validator:read",
    "supervisor:read",
    "config:read",
  ],
  support: [
    "agents:read",
    "prompts:read",
    "tools:read",
    "tools:logs",
    "logs:read",
    "logs:search",
    "executions:read",
    "workflow:read",
    "memory:read",
    "knowledge:read",
    "observability:read",
    "supervisor:read",
  ],
  audit: [
    "agents:read",
    "prompts:read",
    "tools:read",
    "logs:read",
    "logs:search",
    "executions:read",
    "observability:read",
    "workflow_validator:read",
    "supervisor:read",
    "audit:read",
  ],
  read_only: [
    "agents:read",
    "prompts:read",
    "tools:read",
    "logs:read",
    "executions:read",
    "workflow:read",
    "memory:read",
    "knowledge:read",
    "observability:read",
    "config:read",
  ],
};

export function resolvePermissions(
  role: McpRole,
  customPermissions?: string[] | null,
): Set<McpPermission> {
  if (role === "custom" && customPermissions?.length) {
    return new Set(customPermissions.filter(isMcpPermission));
  }
  if (role === "custom") {
    return new Set(MCP_ROLE_PERMISSIONS.read_only);
  }
  return new Set(MCP_ROLE_PERMISSIONS[role]);
}

function isMcpPermission(v: string): v is McpPermission {
  const all = Object.values(MCP_ROLE_PERMISSIONS).flat();
  return all.includes(v as McpPermission);
}

export function hasPermission(ctx: { permissions: Set<McpPermission> }, perm: McpPermission): boolean {
  return ctx.permissions.has(perm);
}

export function requirePermission(
  ctx: { permissions: Set<McpPermission> },
  perm: McpPermission,
): void {
  if (!hasPermission(ctx, perm)) {
    throw new McpForbiddenError(`Missing permission: ${perm}`);
  }
}

export class McpForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "McpForbiddenError";
  }
}
