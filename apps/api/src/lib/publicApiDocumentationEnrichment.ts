import type { PublicApiDocAuth, PublicApiDocEndpoint, PublicApiDocGroup } from "./publicApiDocumentationCatalog.js";

export type PublicApiDocError = {
  status: number;
  descriptionPt: string;
};

export type PublicApiDocEndpointEnriched = PublicApiDocEndpoint & {
  slug: string;
  successStatus: number;
  exampleResponsePt: string;
  errors: PublicApiDocError[];
};

export type PublicApiDocGroupEnriched = Omit<PublicApiDocGroup, "endpoints"> & {
  endpoints: PublicApiDocEndpointEnriched[];
};

/** Gera slug estável para âncora HTML (ex.: /api/v1/auth/login → api-v1-auth-login). */
export function endpointSlug(path: string): string {
  return path
    .replace(/^\//, "")
    .replace(/[:/|*]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
}

const ERR_400: PublicApiDocError = { status: 400, descriptionPt: "Corpo ou query inválidos (validação Zod)." };
const ERR_401: PublicApiDocError = { status: 401, descriptionPt: "Credencial ausente, inválida ou expirada." };
const ERR_403: PublicApiDocError = { status: 403, descriptionPt: "Papel ou token insuficiente para a operação." };
const ERR_404: PublicApiDocError = { status: 404, descriptionPt: "Recurso não encontrado no tenant." };
const ERR_409: PublicApiDocError = { status: 409, descriptionPt: "Conflito (recurso duplicado ou estado incompatível)." };
const ERR_422: PublicApiDocError = { status: 422, descriptionPt: "Regra de negócio não satisfeita (ex.: janela WhatsApp 24h)." };
const ERR_429: PublicApiDocError = { status: 429, descriptionPt: "Rate limit excedido." };
const ERR_503: PublicApiDocError = { status: 503, descriptionPt: "Serviço indisponível ou configuração em falta." };

type RouteOverride = {
  successStatus: number;
  exampleResponsePt: string;
  extraErrors?: PublicApiDocError[];
};

/** Respostas de sucesso extraídas ou alinhadas ao código real dos handlers. */
const ROUTE_RESPONSE_OVERRIDES: Record<string, RouteOverride> = {
  "/health": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200 application/json:
{
  "status": "ok",
  "version": "0.1.0"
}`,
  },
  "/api/v1/auth/login": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200 application/json:
{
  "token": "<jwt>",
  "user": {
    "id": "<uuid>",
    "name": "Ana Admin",
    "email": "ana@exemplo.com",
    "role": "ADMIN",
    "organizationId": "<uuid-org>"
  }
}`,
    extraErrors: [
      { status: 401, descriptionPt: "Email ou palavra-passe incorrectos." },
      ERR_429,
    ],
  },
  "/api/v1/auth/logout": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200 application/json:
{
  "message": "Logged out"
}`,
  },
  "/api/v1/auth/me": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200 application/json:
{
  "id": "<uuid>",
  "name": "Ana Admin",
  "displayName": null,
  "avatarUrl": null,
  "email": "ana@exemplo.com",
  "role": "ADMIN",
  "organizationId": "<uuid-org>",
  "messageSignature": null,
  "showAgentNameInChat": false,
  "actingOrganizationId": null,
  "actingOrganization": null,
  "organization": {
    "id": "<uuid-org>",
    "name": "Empresa Exemplo",
    "slug": "empresa-exemplo"
  },
  "hasApiAccessToken": true,
  "apiAccessTokenPrefix": "ocu_a1b2c3",
  "apiAccessTokenLastUsedAt": null,
  "organizationFeatures": {},
  "createdAt": "2026-01-15T10:00:00.000Z"
}`,
  },
  "/api/v1/auth/me/access-token": {
    successStatus: 200,
    exampleResponsePt: `GET — HTTP 200:
{
  "configured": true,
  "prefix": "ocu_a1b2c3",
  "lastUsedAt": "2026-07-01T14:30:00.000Z"
}

POST — HTTP 200 (token mostrado uma vez):
{
  "token": "ocu_<segredo-completo>",
  "prefix": "ocu_a1b2c3",
  "message": "Save this token now. It will not be shown again."
}

DELETE — HTTP 204 (sem corpo)`,
    extraErrors: [{ status: 403, descriptionPt: "Requer ADMIN no tenant (canManageProfileApiToken)." }],
  },
  "/api/v1/contacts": {
    successStatus: 200,
    exampleResponsePt: `GET — HTTP 200 (paginado):
{
  "data": [
    {
      "id": "<uuid>",
      "name": "Maria Silva",
      "phone": "+5511999990000",
      "email": "maria@exemplo.com",
      "tags": [{ "id": "<uuid>", "name": "VIP", "color": "#22c55e" }],
      "pipelineStageId": "<uuid>",
      "assignedToId": "<uuid>",
      "engagementScore": 72,
      "lastMessageAt": "2026-07-09T12:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "stats": {
    "withOpenDeals": 5,
    "avgEngagementOnPage": 68
  }
}

POST — HTTP 201: objeto Contact criado`,
  },
  "/api/v1/conversations": {
    successStatus: 200,
    exampleResponsePt: `GET — HTTP 200 (paginado):
{
  "data": [
    {
      "id": "<uuid>",
      "status": "OPEN",
      "priority": "MEDIUM",
      "inboxId": "<uuid>",
      "contactId": "<uuid>",
      "assignedToId": "<uuid>",
      "teamId": "<uuid>",
      "leadTypeId": null,
      "isUnread": true,
      "isStarred": false,
      "emailFolderId": null,
      "agentBotTriageActive": false,
      "contact": {
        "id": "<uuid>",
        "name": "Maria Silva",
        "phone": "+5511999990000",
        "hasAvatar": false,
        "thumbnail": null
      },
      "lastMessage": {
        "body": "Olá, preciso de ajuda",
        "createdAt": "2026-07-09T12:00:00.000Z",
        "direction": "INBOUND"
      },
      "createdAt": "2026-07-08T09:00:00.000Z",
      "updatedAt": "2026-07-09T12:00:00.000Z"
    }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 20
}`,
  },
  "/api/v1/messages": {
    successStatus: 201,
    exampleResponsePt: `HTTP 201 application/json:
{
  "message": {
    "id": "<uuid>",
    "conversationId": "<uuid>",
    "contactId": "<uuid>",
    "type": "TEXT",
    "direction": "OUTBOUND",
    "status": "SENT",
    "body": "Olá, em que posso ajudar?",
    "isPrivate": false,
    "createdAt": "2026-07-09T12:05:00.000Z"
  },
  "conversationId": "<uuid>"
}`,
    extraErrors: [ERR_422],
  },
  "/api/v1/tags": {
    successStatus: 200,
    exampleResponsePt: `GET — HTTP 200:
{
  "data": [
    { "id": "<uuid>", "name": "VIP", "color": "#22c55e" }
  ]
}

POST — HTTP 201: tag criada`,
  },
  "/api/v1/bots": {
    successStatus: 200,
    exampleResponsePt: `GET — HTTP 200:
{
  "data": [
    {
      "id": "<uuid>",
      "organizationId": "<uuid>",
      "name": "Bot FAQ",
      "description": null,
      "avatarUrl": null,
      "type": "WEBHOOK",
      "webhookUrl": "https://seu-servidor.com/hook",
      "config": null,
      "isActive": true,
      "inboxTokenConfigured": true,
      "webhookSecretConfigured": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "_count": { "interactions": 0 }
    }
  ]
}

POST — HTTP 201: bot criado (admin JWT)`,
    extraErrors: [{ status: 403, descriptionPt: "Mutations exigem JWT admin; ocb_ só leitura." }],
  },
  "/api/v1/inboxes": {
    successStatus: 200,
    exampleResponsePt: `GET — HTTP 200:
{
  "data": [
    {
      "id": "<uuid>",
      "name": "Suporte WhatsApp",
      "channelType": "WHATSAPP",
      "isDefault": true,
      "channelConfig": null,
      "agentBotId": null,
      "autoAssignEnabled": false,
      "ingestToken": "<token-opaco-admin>",
      "_count": { "members": 3, "conversations": 120 }
    }
  ]
}

POST — HTTP 201: caixa criada (admin)`,
  },
  "/api/v1/agent-bot/messages": {
    successStatus: 201,
    exampleResponsePt: `HTTP 201 application/json:
{
  "message": { "id": "<uuid>", "type": "TEXT", "body": "Resposta automática" },
  "conversationId": "<uuid>",
  "agent_bot_id": "<uuid-bot>"
}`,
    extraErrors: [ERR_422, { status: 403, descriptionPt: "Notas privadas (isPrivate) não permitidas." }],
  },
  "/api/v1/agent-bot/profile": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200 — mesmo formato que GET /api/v1/bots/:id:
{
  "id": "<uuid>",
  "name": "Bot FAQ",
  "type": "WEBHOOK",
  "isActive": true,
  "agent_bot_id": "<uuid>"
}`,
  },
  "/api/v1/pipeline/board": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200:
{
  "columns": [
    {
      "leadType": { "id": "<uuid>", "name": "Novo", "color": "#3b82f6", "order": 0 },
      "contacts": [
        { "id": "<uuid>", "name": "Maria", "phone": "+5511...", "dealValue": 1500 }
      ]
    }
  ]
}`,
  },
  "/api/v1/inboxes/:id/email-folders": {
    successStatus: 200,
    exampleResponsePt: `GET — HTTP 200:
{
  "data": [
    { "id": "<uuid>", "name": "Clientes VIP", "sortOrder": 0, "createdAt": "2026-07-09T10:00:00.000Z" }
  ]
}

POST — HTTP 201: pasta criada`,
    extraErrors: [{ status: 409, descriptionPt: "Já existe pasta com o mesmo nome nesta caixa." }],
  },
  "/api/v1/inboxes/:id/compose-email": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200 application/json:
{
  "conversationId": "<uuid>",
  "contactId": "<uuid>"
}`,
    extraErrors: [{ status: 422, descriptionPt: "SMTP não configurado ou envio falhou." }],
  },
  "/api/v1/conversations/:id/star": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200:
{
  "starred": true
}`,
  },
  "/api/v1/dashboard": {
    successStatus: 200,
    exampleResponsePt: `HTTP 200 — resumo do painel (contadores, conversas activas; e-mails ocultos excluídos quando configurado).`,
  },
};

const PAGINATED_PATHS = new Set([
  "/api/v1/contacts",
  "/api/v1/conversations",
  "/api/v1/conversations/audit",
  "/api/v1/users",
  "/api/v1/broadcasts",
  "/api/v1/reminders",
]);

function primaryMethod(methodField: string): string {
  return methodField.split("|")[0]?.trim().toUpperCase() ?? "GET";
}

function hasMutation(methodField: string): boolean {
  return /POST|PUT|PATCH|DELETE/i.test(methodField);
}

function inferSuccessStatus(methodField: string, path: string): number {
  const override = ROUTE_RESPONSE_OVERRIDES[path];
  if (override) return override.successStatus;
  const m = primaryMethod(methodField);
  if (m === "POST") return 201;
  if (m === "DELETE") return 204;
  if (m === "WS") return 101;
  return 200;
}

function inferResponseBody(methodField: string, path: string, status: number): string {
  const override = ROUTE_RESPONSE_OVERRIDES[path];
  if (override) return override.exampleResponsePt;

  const m = primaryMethod(methodField);

  if (status === 204) {
    return "HTTP 204 No Content — sem corpo.";
  }

  if (m === "GET" && PAGINATED_PATHS.has(path)) {
    return `HTTP 200 application/json:
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}`;
  }

  if (m === "GET" && path.includes(":id")) {
    return `HTTP 200 application/json:
{
  "id": "<uuid>",
  "...": "campos do recurso"
}`;
  }

  if (m === "GET") {
    return `HTTP 200 application/json:
{
  "data": []
}`;
  }

  if (m === "POST") {
    return `HTTP 201 application/json:
{
  "id": "<uuid>",
  "...": "recurso criado"
}`;
  }

  if (m === "PUT" || m === "PATCH") {
    return `HTTP 200 application/json:
{
  "id": "<uuid>",
  "...": "recurso actualizado"
}`;
  }

  if (m === "DELETE") {
    return "HTTP 204 No Content — sem corpo.";
  }

  if (methodField === "WS") {
    return "HTTP 101 Switching Protocols — ligação WebSocket estabelecida.";
  }

  return `HTTP ${status} — ver implementação em apps/api/src/routes.`;
}

function defaultErrors(auth: PublicApiDocAuth, methodField: string, path: string): PublicApiDocError[] {
  const override = ROUTE_RESPONSE_OVERRIDES[path];
  const errors: PublicApiDocError[] = [];

  if (auth === "none" || auth === "path_ingest_token") {
    if (hasMutation(methodField) || primaryMethod(methodField) === "GET") {
      errors.push(ERR_400);
    }
    if (path.includes("/public/") || path.includes("/webhooks/")) {
      errors.push(ERR_404);
    }
    return errors;
  }

  if (auth === "session_jwt" || auth === "session_jwt_or_api_access_token" || auth === "super_admin_jwt") {
    errors.push(ERR_401, ERR_403, ERR_404);
  } else if (auth === "agent_bot_bearer") {
    errors.push(ERR_401, ERR_403, ERR_404, ERR_422);
  } else if (auth === "session_jwt_or_bot_bearer_readonly") {
    errors.push(ERR_401, ERR_403, ERR_404);
  } else if (auth === "platform_app_bearer") {
    errors.push(ERR_401, ERR_404);
  }

  if (hasMutation(methodField)) {
    errors.push(ERR_400);
  }

  if (/POST|PUT|PATCH/i.test(methodField)) {
    if (path.includes("tags") || path.includes("teams") || path.includes("bots") || path.includes("email-folders")) {
      errors.push(ERR_409);
    }
  }

  if (path.includes("/messages") || path.includes("compose-email")) {
    errors.push(ERR_422);
  }

  if (path === "/api/v1/auth/login") {
    errors.push(ERR_429);
  }

  if (override?.extraErrors) {
    for (const e of override.extraErrors) {
      if (!errors.some((x) => x.status === e.status)) errors.push(e);
    }
  }

  return errors.sort((a, b) => a.status - b.status);
}

export function enrichEndpoint(ep: PublicApiDocEndpoint): PublicApiDocEndpointEnriched {
  const successStatus = inferSuccessStatus(ep.method, ep.path);
  return {
    ...ep,
    slug: endpointSlug(ep.path),
    successStatus,
    exampleResponsePt: inferResponseBody(ep.method, ep.path, successStatus),
    errors: defaultErrors(ep.auth, ep.method, ep.path),
  };
}

export function enrichDocumentationGroups(groups: PublicApiDocGroup[]): PublicApiDocGroupEnriched[] {
  return groups.map((g) => ({
    ...g,
    endpoints: g.endpoints.map(enrichEndpoint),
  }));
}
