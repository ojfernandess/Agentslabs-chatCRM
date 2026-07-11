import type { PublicApiDocAuth } from "./publicApiDocumentationCatalog.js";
import type { PublicApiDocEndpointEnriched, PublicApiDocGroupEnriched } from "./publicApiDocumentationEnrichment.js";

type PostmanUrl = {
  raw: string;
  host: string[];
  path: string[];
  variable?: { key: string; value: string; description?: string }[];
};

type PostmanRequest = {
  method: string;
  header: { key: string; value: string; type: string }[];
  url: PostmanUrl;
  description?: string;
  body?: {
    mode: string;
    raw?: string;
    options?: { raw: { language: string } };
  };
  auth?: Record<string, unknown>;
};

type PostmanItem = {
  name: string;
  request?: PostmanRequest;
  item?: PostmanItem[];
  description?: string;
};

function parseMethods(methodField: string): string[] {
  return methodField
    .split("|")
    .map((s) => s.trim().toUpperCase())
    .filter((m) => m && m !== "OPTIONS" && m !== "HEAD");
}

function pathToPostmanUrl(path: string, baseVar = "{{baseUrl}}"): PostmanUrl {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  const segments = clean.split("/").filter(Boolean);
  const variables = segments
    .filter((s) => s.startsWith(":"))
    .map((s) => ({
      key: s.slice(1),
      value: s.slice(1).replace(/Id$/i, "uuid").replace(/id$/, "uuid"),
      description: `Substitua pelo valor real (${s})`,
    }));

  const rawPath = segments.map((s) => (s.startsWith(":") ? `{{${s.slice(1)}}}` : s)).join("/");
  const raw = `${baseVar}/${rawPath}`;

  return {
    raw,
    host: [baseVar],
    path: segments.map((s) => (s.startsWith(":") ? `:${s.slice(1)}` : s)),
    ...(variables.length ? { variable: variables } : {}),
  };
}

function postmanAuth(auth: PublicApiDocAuth): Record<string, unknown> | undefined {
  switch (auth) {
    case "session_jwt":
    case "super_admin_jwt":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: "{{jwt}}", type: "string" }],
      };
    case "session_jwt_or_api_access_token":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: "{{ocu_token}}", type: "string" }],
      };
    case "agent_bot_bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: "{{ocb_token}}", type: "string" }],
      };
    case "session_jwt_or_bot_bearer_readonly":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: "{{ocb_token}}", type: "string" }],
      };
    case "platform_app_bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: "{{ocp_token}}", type: "string" }],
      };
    case "path_ingest_token":
    case "none":
    default:
      return undefined;
  }
}

function extraHeaders(auth: PublicApiDocAuth): { key: string; value: string; type: string }[] {
  const headers: { key: string; value: string; type: string }[] = [
    { key: "Accept", value: "application/json", type: "text" },
  ];
  if (auth === "session_jwt_or_api_access_token") {
    headers.push({ key: "api_access_token", value: "{{ocu_token}}", type: "text" });
  }
  if (auth === "session_jwt" || auth === "super_admin_jwt") {
    headers.push({ key: "organization-id", value: "{{organizationId}}", type: "text" });
  }
  return headers;
}

/** Extrai primeiro bloco JSON do exemplo de payload (heurística). */
function extractJsonBody(examplePayloadPt: string, method: string): string | undefined {
  if (!/POST|PUT|PATCH/i.test(method)) return undefined;
  const blocks = examplePayloadPt.match(/\{[\s\S]*?\}/g);
  if (!blocks?.length) return undefined;
  const candidate = blocks.find((b) => b.includes('"') && b.length > 2);
  if (!candidate) return undefined;
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return candidate;
  }
}

function buildDescription(ep: PublicApiDocEndpointEnriched, method: string): string {
  const lines = [
    ep.descriptionPt,
    "",
    `**Auth:** ${ep.auth}`,
    `**Sucesso:** HTTP ${ep.successStatus}`,
    "",
    "**Pedido (exemplo):**",
    "```",
    ep.examplePayloadPt,
    "```",
    "",
    "**Resposta (exemplo):**",
    "```",
    ep.exampleResponsePt,
    "```",
  ];
  if (ep.errors.length) {
    lines.push("", "**Erros:**");
    for (const e of ep.errors) {
      lines.push(`- ${e.status}: ${e.descriptionPt}`);
    }
  }
  if (method === "GET" && ep.examplePayloadPt.includes("?")) {
    const queryPart = ep.examplePayloadPt.split("?").slice(1).join("?").split("\n")[0];
    if (queryPart) lines.push("", `**Query:** ?${queryPart}`);
  }
  return lines.join("\n");
}

function endpointToPostmanItems(ep: PublicApiDocEndpointEnriched): PostmanItem[] {
  const methods = parseMethods(ep.method);
  if (ep.method === "WS") {
    return [
      {
        name: `WS ${ep.path}`,
        request: {
          method: "GET",
          header: extraHeaders(ep.auth as PublicApiDocAuth),
          url: pathToPostmanUrl("/api/v1/ws"),
          description: `${ep.descriptionPt}\n\nWebSocket — use cliente WS com ?token={{jwt}} ou cookie de sessão.`,
          auth: postmanAuth(ep.auth as PublicApiDocAuth),
        },
      },
    ];
  }

  return methods.map((method) => {
    const jsonBody = extractJsonBody(ep.examplePayloadPt, method);
    const item: PostmanItem = {
      name: methods.length > 1 ? `${method} ${ep.path}` : ep.path,
      request: {
        method: method === "WS" ? "GET" : method,
        header: [
          ...extraHeaders(ep.auth as PublicApiDocAuth),
          ...(jsonBody ? [{ key: "Content-Type", value: "application/json", type: "text" }] : []),
        ],
        url: pathToPostmanUrl(ep.path),
        description: buildDescription(ep, method),
        auth: postmanAuth(ep.auth as PublicApiDocAuth),
      },
    };
    if (jsonBody && item.request) {
      item.request.body = {
        mode: "raw",
        raw: jsonBody,
        options: { raw: { language: "json" } },
      };
    }
    return item;
  });
}

/**
 * Gera Postman Collection v2.1 a partir dos grupos enriquecidos da documentação pública.
 */
export function buildPostmanCollectionV21(
  groups: PublicApiDocGroupEnriched[],
  schemaVersion: number,
): Record<string, unknown> {
  const folders: PostmanItem[] = groups.map((g) => ({
    name: g.titlePt,
    description: g.titleEn,
    item: g.endpoints.flatMap(endpointToPostmanItems),
  }));

  return {
    info: {
      _postman_id: `opennexo-crm-api-v${schemaVersion}`,
      name: `OpenNexo CRM API v${schemaVersion}`,
      description:
        "Coleção gerada automaticamente a partir da documentação pública do OpenNexo CRM.\n\n" +
        "**Variáveis da coleção:**\n" +
        "- `baseUrl` — URL do servidor (ex.: https://chat.agentslabs.cloud)\n" +
        "- `jwt` — token de sessão (POST /api/v1/auth/login)\n" +
        "- `ocu_token` — token de perfil (POST /api/v1/auth/me/access-token)\n" +
        "- `ocb_token` — token do bot (POST /api/v1/bots/:id/inbox-token)\n" +
        "- `organizationId` — UUID do tenant (SUPER_ADMIN / ocu_)\n\n" +
        "Importe em Postman: File → Import → selecione este ficheiro.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: folders,
    variable: [
      { key: "baseUrl", value: "https://chat.agentslabs.cloud", type: "string" },
      { key: "jwt", value: "", type: "string" },
      { key: "ocu_token", value: "", type: "string" },
      { key: "ocb_token", value: "", type: "string" },
      { key: "organizationId", value: "", type: "string" },
      { key: "ocp_token", value: "", type: "string" },
    ],
  };
}
