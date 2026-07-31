import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requirePermission } from "../access/permissions.js";
import type { McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";
import {
  evaluateProposedChange,
  getAdr,
  getArchitectureTimeline,
  listAdrs,
  listRcas,
  searchAdrs,
  searchRcas,
} from "../../architecture-governance/governanceService.js";
import { analyzeArchitectureImpact } from "../../architecture-governance/impactAnalysis.js";
import { OPENNEXO_RUNTIME_COMPONENTS } from "../../architecture-governance/componentRegistry.js";
import { adrDir, resolveRepoRoot } from "../../architecture-governance/paths.js";
import type { ProposedChange } from "../../architecture-governance/types.js";

function readAdrResource(id: string): unknown {
  const root = resolveRepoRoot();
  const jsonPath = join(adrDir(root), `${id}.json`);
  const mdPath = join(adrDir(root), `${id}.md`);
  const adr = getAdr(id, root);
  if (!adr) throw new Error(`ADR not found: ${id}`);
  let markdown: string | null = null;
  try {
    markdown = readFileSync(mdPath, "utf8");
  } catch {
    /* optional md */
  }
  return { adr, markdown, jsonPath };
}

export const architectureGovernanceProvider: McpProvider = {
  domain: "architecture",

  async listResources(_ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(_ctx, "architecture:read");
    const limit = params?.limit ?? 50;
    return listAdrs()
      .slice(0, limit)
      .map((a) => ({
        uri: `opennexo://architecture/adr/${a.id}`,
        name: `${a.id}: ${a.title}`,
        description: `${a.component} · ${a.status}`,
        mimeType: "application/json",
      }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "architecture:read");
    const m = /^opennexo:\/\/architecture\/adr\/(.+)$/.exec(uri);
    if (!m) throw new Error(`Invalid architecture URI: ${uri}`);
    return readAdrResource(m[1]!);
  },

  async search(ctx, params: McpProviderSearchParams): Promise<unknown> {
    requirePermission(ctx, "architecture:read");
    const q = params?.query ?? "";
    if (!q.trim()) {
      return { adrs: listAdrs(), rcas: listRcas(), timeline: getArchitectureTimeline() };
    }
    return {
      adrs: searchAdrs(q),
      rcas: searchRcas(q),
    };
  },
};

export async function architectureImpactAnalysisMcp(changedFiles: string[]): Promise<unknown> {
  const impact = analyzeArchitectureImpact(changedFiles);
  const components = OPENNEXO_RUNTIME_COMPONENTS.map((c) => ({
    id: c.id,
    name: c.name,
    dependsOn: c.dependsOn,
  }));
  return { impact, componentRegistry: components };
}

export async function architectureReviewMcp(proposal: ProposedChange): Promise<unknown> {
  return evaluateProposedChange(proposal);
}

export async function architectureTimelineMcp(): Promise<unknown> {
  return getArchitectureTimeline();
}

export async function architectureDependencyGraphMcp(): Promise<unknown> {
  return {
    nodes: OPENNEXO_RUNTIME_COMPONENTS.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
    })),
    edges: OPENNEXO_RUNTIME_COMPONENTS.flatMap((c) =>
      c.dependsOn.map((dep) => ({ from: c.id, to: dep })),
    ),
  };
}
