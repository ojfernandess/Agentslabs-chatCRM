/**
 * Convenções gerais da API — servidas na documentação pública.
 * Baseado em server.ts (rate limit), handlers de erro e padrões de listagem.
 */

export type PublicApiDocAuthRow = {
  tokenTypePt: string;
  prefix: string;
  howToObtainPt: string;
  whereToUsePt: string;
  whoCanUsePt: string;
};

export type PublicApiDocConventions = {
  errorFormatPt: string;
  errorExampleJson: string;
  paginationPt: string;
  paginationExampleJson: string;
  filtersPt: string;
  rateLimitPt: string;
  versioningPt: string;
  authTable: PublicApiDocAuthRow[];
};

export const PUBLIC_API_DOCUMENTATION_CONVENTIONS: PublicApiDocConventions = {
  errorFormatPt:
    "Respostas de erro HTTP usam JSON com três campos: `error` (rótulo curto, ex. «Bad Request»), `message` (texto legível) e `statusCode` (número HTTP repetido). Validação Zod devolve 400 com `message` descrevendo o primeiro problema. Não há campo `details` nem `code` separado no formato atual.",
  errorExampleJson: `{
  "error": "Bad Request",
  "message": "Invalid email or password format",
  "statusCode": 400
}`,
  paginationPt:
    "Rotas de listagem paginadas aceitam `page` (inteiro ≥ 1, predefinido 1) e `pageSize` (inteiro 1–100, predefinido 20). A resposta inclui `data` (array), `total` (contagem total), `page` e `pageSize`. Algumas rotas acrescentam `stats` (ex.: contactos). Rotas com paginação: GET /api/v1/contacts, GET /api/v1/conversations, GET /api/v1/conversations/audit, GET /api/v1/users, GET /api/v1/broadcasts, GET /api/v1/reminders, entre outras.",
  paginationExampleJson: `{
  "data": [
    {
      "id": "<uuid>",
      "name": "Maria Silva",
      "phone": "+5511999990000"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}`,
  filtersPt:
    "Filtros comuns (nem todas as rotas suportam todos):\n• `search` — texto livre (contactos, utilizadores)\n• `status` — estado (conversas: OPEN, PENDING, RESOLVED)\n• `inboxId`, `teamId`, `assignedToId`, `leadTypeId`, `mine` — conversas\n• `trash`, `starred`, `emailFolderId`, `q` — workspace de e-mail (com inboxId)\n• `hasEmail=1` — contactos com e-mail\n• `tag`, `stage`, `assignee` — contactos\n• `from` / `to` — relatórios e algumas listagens temporais",
  rateLimitPt:
    "Limite global: 400 pedidos por minuto por IP ou por prefixo de JWT de sessão (`@fastify/rate-limit` em server.ts). Rotas públicas (webhooks, /api/v1/public/*, media, WebSocket) estão na allowList e não contam esse limite. POST /api/v1/auth/login tem limite adicional: 15 tentativas por 15 minutos por IP.",
  versioningPt:
    "Todas as rotas documentadas estão sob o prefixo `/api/v1`. O campo `schemaVersion` no JSON desta documentação indica a versão do catálogo (não da API). Versões futuras (`/api/v2`) serão anunciadas no changelog; `/v1` mantém-se estável para integradores existentes.",
  authTable: [
    {
      tokenTypePt: "JWT de sessão",
      prefix: "—",
      howToObtainPt: "POST /api/v1/auth/login com email e palavra-passe",
      whereToUsePt: "Cabeçalho `Authorization: Bearer <jwt>` em /api/v1/…",
      whoCanUsePt: "SUPER_ADMIN, ADMIN, AGENT (conforme papel no tenant)",
    },
    {
      tokenTypePt: "Token de perfil",
      prefix: "ocu_",
      howToObtainPt: "POST /api/v1/auth/me/access-token (admin no tenant)",
      whereToUsePt: "Cabeçalho `api_access_token: ocu_…` ou `Authorization: Bearer ocu_…`",
      whoCanUsePt: "ADMIN (e SUPER_ADMIN com header `organization-id` / `?organizationId=`)",
    },
    {
      tokenTypePt: "Token de bot (inbox)",
      prefix: "ocb_",
      howToObtainPt: "POST /api/v1/bots/:id/inbox-token (admin)",
      whereToUsePt: "Cabeçalho `Authorization: Bearer ocb_…` em /api/v1/agent-bot/*",
      whoCanUsePt: "Integração do bot — mensagens, equipas, estado da conversa",
    },
    {
      tokenTypePt: "Token de ingestão",
      prefix: "—",
      howToObtainPt: "Gerado na caixa de entrada (campo ingestToken; só admin)",
      whereToUsePt: "Token no path: /api/v1/public/inbox/:token/… ou /public/channels/…",
      whoCanUsePt: "Webhooks de canal e widget (sem JWT)",
    },
    {
      tokenTypePt: "App de plataforma",
      prefix: "ocp_",
      howToObtainPt: "Criado em Super Admin → Aplicações",
      whereToUsePt: "Bearer em /api/v1/platform/*",
      whoCanUsePt: "Integrações de plataforma autorizadas",
    },
  ],
};
