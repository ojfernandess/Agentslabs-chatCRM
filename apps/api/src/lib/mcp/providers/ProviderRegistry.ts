import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor, McpResourceDomain } from "../types.js";

/** Contrato base para providers MCP — extensível sem modificar o núcleo. */
export interface McpProvider {
  readonly domain: McpResourceDomain;
  listResources(ctx: McpAuthContext, params?: McpProviderSearchParams): Promise<McpResourceDescriptor[]>;
  readResource(ctx: McpAuthContext, uri: string): Promise<unknown>;
  search?(ctx: McpAuthContext, params: McpProviderSearchParams): Promise<unknown>;
}

const providers = new Map<McpResourceDomain, McpProvider>();

export function registerMcpProvider(provider: McpProvider): void {
  providers.set(provider.domain, provider);
}

export function getMcpProvider(domain: McpResourceDomain): McpProvider | undefined {
  return providers.get(domain);
}

export function listMcpProviders(): McpProvider[] {
  return [...providers.values()];
}

export async function listAllMcpResources(
  ctx: McpAuthContext,
  params?: McpProviderSearchParams,
): Promise<McpResourceDescriptor[]> {
  const all: McpResourceDescriptor[] = [];
  for (const p of providers.values()) {
    const items = await p.listResources(ctx, params);
    all.push(...items);
  }
  return all;
}

export function parseMcpUri(uri: string): { domain: McpResourceDomain; id: string } | null {
  const m = /^opennexo:\/\/([a-z_]+)\/(.+)$/.exec(uri);
  if (!m) return null;
  return { domain: m[1] as McpResourceDomain, id: m[2]! };
}

export async function readMcpResourceByUri(ctx: McpAuthContext, uri: string): Promise<unknown> {
  const parsed = parseMcpUri(uri);
  if (!parsed) throw new Error(`Invalid MCP resource URI: ${uri}`);
  const provider = getMcpProvider(parsed.domain);
  if (!provider) throw new Error(`No provider for domain: ${parsed.domain}`);
  return provider.readResource(ctx, uri);
}
