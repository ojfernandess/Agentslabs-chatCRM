import { prisma } from "../db.js";
import {
  PUBLIC_API_DOCUMENTATION_CHANGELOG,
  PUBLIC_API_DOCUMENTATION_CONVENTIONS,
  PUBLIC_API_DOCUMENTATION_GROUPS,
  PUBLIC_API_DOCUMENTATION_SCHEMAS,
  enrichDocumentationGroups,
  type PublicApiDocGroupEnriched,
} from "./publicApiDocumentationCatalog.js";
import { PUBLIC_API_DOCUMENTATION_N8N_GUIDE } from "./publicApiDocumentationN8nGuide.js";

export const PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY = "public_system_documentation_enabled";

export const PUBLIC_SYSTEM_DOCUMENTATION_SCHEMA_VERSION = 17;

export type PublicSystemDocumentationSectionVisibility = {
  conventions: boolean;
  auth: boolean;
  schemas: boolean;
  changelog: boolean;
  quickGuide: boolean;
  emailGuide: boolean;
  n8nGuide: boolean;
  postmanDownload: boolean;
  botAutomationNav: boolean;
};

export type PublicSystemDocumentationConfig = {
  enabled: boolean;
  sections: PublicSystemDocumentationSectionVisibility;
  groups: Record<string, boolean>;
};

export type PublicSystemDocumentationGroupOption = {
  id: string;
  titlePt: string;
};

export const PUBLIC_SYSTEM_DOCUMENTATION_GROUP_OPTIONS: PublicSystemDocumentationGroupOption[] =
  PUBLIC_API_DOCUMENTATION_GROUPS.map((g) => ({ id: g.id, titlePt: g.titlePt }));

const ALL_GROUP_IDS = PUBLIC_API_DOCUMENTATION_GROUPS.map((g) => g.id);

export const DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS: PublicSystemDocumentationSectionVisibility = {
  conventions: true,
  auth: true,
  schemas: true,
  changelog: true,
  quickGuide: true,
  emailGuide: true,
  n8nGuide: true,
  postmanDownload: true,
  botAutomationNav: true,
};

export function defaultPublicSystemDocumentationGroups(): Record<string, boolean> {
  return Object.fromEntries(ALL_GROUP_IDS.map((id) => [id, true]));
}

export const DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_CONFIG: PublicSystemDocumentationConfig = {
  enabled: false,
  sections: { ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS },
  groups: defaultPublicSystemDocumentationGroups(),
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

function readBool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}

function parseSections(raw: unknown): PublicSystemDocumentationSectionVisibility {
  const root = asRecord(raw);
  if (!root) return { ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS };
  return {
    conventions: readBool(root, "conventions", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.conventions),
    auth: readBool(root, "auth", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.auth),
    schemas: readBool(root, "schemas", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.schemas),
    changelog: readBool(root, "changelog", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.changelog),
    quickGuide: readBool(root, "quickGuide", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.quickGuide),
    emailGuide: readBool(root, "emailGuide", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.emailGuide),
    n8nGuide: readBool(root, "n8nGuide", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.n8nGuide),
    postmanDownload: readBool(root, "postmanDownload", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.postmanDownload),
    botAutomationNav: readBool(root, "botAutomationNav", DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS.botAutomationNav),
  };
}

function parseGroups(raw: unknown): Record<string, boolean> {
  const out = defaultPublicSystemDocumentationGroups();
  const root = asRecord(raw);
  if (!root) return out;
  for (const id of ALL_GROUP_IDS) {
    if (id in root) out[id] = readBool(root, id, out[id] ?? true);
  }
  return out;
}

export function parsePublicSystemDocumentationConfig(raw: unknown): PublicSystemDocumentationConfig {
  if (raw === true) {
    return {
      enabled: true,
      sections: { ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_SECTIONS },
      groups: defaultPublicSystemDocumentationGroups(),
    };
  }
  if (raw === false || raw == null) {
    return { ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_CONFIG };
  }

  const root = asRecord(raw);
  if (!root) return { ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_CONFIG };

  return {
    enabled: readBool(root, "enabled", false),
    sections: parseSections(root.sections),
    groups: parseGroups(root.groups),
  };
}

export function parsePublicSystemDocumentationEnabled(raw: unknown): boolean {
  return parsePublicSystemDocumentationConfig(raw).enabled;
}

export async function getPublicSystemDocumentationConfig(): Promise<PublicSystemDocumentationConfig> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: PUBLIC_SYSTEM_DOCUMENTATION_SETTING_KEY },
    select: { value: true },
  });
  if (!row) return { ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_CONFIG };
  return parsePublicSystemDocumentationConfig(row.value);
}

export async function isPublicSystemDocumentationEnabled(): Promise<boolean> {
  const config = await getPublicSystemDocumentationConfig();
  return config.enabled;
}

export type PublicSystemDocumentationPayload = {
  schemaVersion: number;
  generatedAt: string;
  noticeEn: string;
  noticePt: string;
  visibility: {
    sections: PublicSystemDocumentationSectionVisibility;
  };
  conventions?: typeof PUBLIC_API_DOCUMENTATION_CONVENTIONS;
  schemas?: typeof PUBLIC_API_DOCUMENTATION_SCHEMAS;
  changelog?: typeof PUBLIC_API_DOCUMENTATION_CHANGELOG;
  guides?: {
    n8n?: typeof PUBLIC_API_DOCUMENTATION_N8N_GUIDE;
  };
  groups: PublicApiDocGroupEnriched[];
};

export function buildPublicSystemDocumentationPayload(
  config: PublicSystemDocumentationConfig,
): PublicSystemDocumentationPayload {
  const allGroups = enrichDocumentationGroups(PUBLIC_API_DOCUMENTATION_GROUPS);
  const visibleGroups = allGroups.filter((g) => config.groups[g.id] !== false);

  return {
    schemaVersion: PUBLIC_SYSTEM_DOCUMENTATION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    noticeEn:
      "This catalog lists routes, auth, request/response examples and error codes. It never includes real tokens, organization IDs, or secrets.",
    noticePt:
      "Este catálogo lista rotas, autenticação, exemplos de pedido/resposta e códigos de erro. Nunca inclui tokens reais, IDs de organização nem segredos. Ver «Convenções gerais» e «Modelos de dados» antes dos endpoints.",
    visibility: {
      sections: { ...config.sections },
    },
    ...(config.sections.conventions || config.sections.auth
      ? { conventions: PUBLIC_API_DOCUMENTATION_CONVENTIONS }
      : {}),
    ...(config.sections.schemas ? { schemas: PUBLIC_API_DOCUMENTATION_SCHEMAS } : {}),
    ...(config.sections.changelog ? { changelog: PUBLIC_API_DOCUMENTATION_CHANGELOG } : {}),
    ...(config.sections.n8nGuide
      ? {
          guides: {
            n8n: PUBLIC_API_DOCUMENTATION_N8N_GUIDE,
          },
        }
      : {}),
    groups: visibleGroups,
  };
}

export function filterDocumentationGroupsForPostman(
  config: PublicSystemDocumentationConfig,
): PublicApiDocGroupEnriched[] {
  const allGroups = enrichDocumentationGroups(PUBLIC_API_DOCUMENTATION_GROUPS);
  return allGroups.filter((g) => config.groups[g.id] !== false);
}
