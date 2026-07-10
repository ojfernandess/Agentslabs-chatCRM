/**
 * Catálogo estático de rotas HTTP (sem segredos, tokens ou IDs reais).
 * Atualizar quando se adicionarem routers — a página pública só é servida se o super admin ativar.
 */

import { PUBLIC_TENANT_API_DOCUMENTATION_ENDPOINTS } from "./publicApiDocumentationTenantEndpoints.js";
import { PUBLIC_EMAIL_API_DOCUMENTATION_ENDPOINTS } from "./publicApiDocumentationEmailEndpoints.js";

export type PublicApiDocAuth =
  | "none"
  | "session_jwt"
  | "session_jwt_or_api_access_token"
  | "session_jwt_or_bot_bearer_readonly"
  | "super_admin_jwt"
  | "agent_bot_bearer"
  | "platform_app_bearer"
  | "path_ingest_token";

export type PublicApiDocEndpoint = {
  method: string;
  path: string;
  auth: PublicApiDocAuth;
  descriptionEn: string;
  descriptionPt: string;
  /** Exemplo de corpo / query / form em PT-BR (sem segredos reais). */
  examplePayloadPt: string;
};

export type PublicApiDocGroup = {
  id: string;
  titleEn: string;
  titlePt: string;
  endpoints: PublicApiDocEndpoint[];
};

export const PUBLIC_API_DOCUMENTATION_GROUPS: PublicApiDocGroup[] = [
  {
    id: "core",
    titleEn: "Core",
    titlePt: "Núcleo",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        auth: "none",
        descriptionEn: "Health check for load balancers and monitoring.",
        descriptionPt: "Verificação de estado para balanceadores e monitorização.",
        examplePayloadPt: "Sem corpo. Exemplo: GET /health",
      },
    ],
  },
  {
    id: "public_ingest",
    titleEn: "Public — channel ingest & CSAT",
    titlePt: "Público — ingestão de canais e CSAT",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/messages/media/:name",
        auth: "none",
        descriptionEn:
          "Download message media by opaque filename (high-entropy name acts as capability; used by WhatsApp providers).",
        descriptionPt:
          "Descarga de multimédia por nome opaco (ficheiro de alta entropia como capacidade; usado por fornecedores WhatsApp).",
        examplePayloadPt:
          "Sem corpo. GET com nome opaco no path (ex.: /api/v1/messages/media/a1b2c3d4e5f6789012345678abcdef12.webm).",
      },
      {
        method: "GET|POST",
        path: "/api/v1/public/csat/:token",
        auth: "path_ingest_token",
        descriptionEn: "Customer satisfaction survey page token flow (GET view, POST submit).",
        descriptionPt: "Fluxo do inquérito CSAT com token no URL (GET visualização, POST submissão).",
        examplePayloadPt:
          "GET: sem corpo (token no path).\n\nPOST application/json:\n{\n  \"score\": 5,\n  \"comment\": \"Atendimento ótimo (opcional)\"\n}\n(score inteiro de 1 a 5)",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/inbox/:token/inbound",
        auth: "path_ingest_token",
        descriptionEn: "Legacy generic channel JSON ingest (participantId, body, etc.).",
        descriptionPt: "Ingestão JSON genérica legada por token (participantId, body, etc.).",
        examplePayloadPt:
          'POST application/json (exemplo ilustrativo):\n{\n  "participantId": "visitante-uuid-ou-id-externo",\n  "body": "Olá, preciso de ajuda",\n  "type": "TEXT"\n}\n(estrutura exata pode variar — token no path.)',
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/inbox/:token/telegram",
        auth: "path_ingest_token",
        descriptionEn: "Telegram Bot API update webhook (legacy path under /public/inbox).",
        descriptionPt: "Webhook de updates do Telegram (caminho legado sob /public/inbox).",
        examplePayloadPt:
          "POST application/json — corpo típico de update do Bot API, ex.:\n{\n  \"update_id\": 10001,\n  \"message\": {\n    \"message_id\": 1,\n    \"chat\": { \"id\": 123456789, \"type\": \"private\" },\n    \"text\": \"Olá\"\n  }\n}",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/inbox/:token/twilio",
        auth: "path_ingest_token",
        descriptionEn: "Twilio SMS/voice callback (form body; legacy path).",
        descriptionPt: "Callback Twilio SMS/voz (form body; caminho legado).",
        examplePayloadPt:
          "POST application/x-www-form-urlencoded:\nFrom=%2B5511999990000&Body=Olá+equipe&MessageSid=SMxxxxxxxx",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/contacts/:contactIdentifier/messages",
        auth: "path_ingest_token",
        descriptionEn:
          "Native client-style message post for Website/API channel inboxes (JSON: content, optional name, email, echo_id).",
        descriptionPt:
          "Envio estilo Client API para caixas Website/API (JSON: content, name, email, echo_id opcionais).",
        examplePayloadPt:
          'POST application/json (contactIdentifier no path = id estável do visitante):\n{\n  "content": "Mensagem do widget",\n  "name": "Visitante (opcional)",\n  "email": "visitante@exemplo.com (opcional)",\n  "echo_id": "opcional-id-de-deduplicação"\n}',
      },
      {
        method: "GET|POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/facebook",
        auth: "path_ingest_token",
        descriptionEn: "Facebook Messenger Graph webhook verification (GET) and messaging events (POST).",
        descriptionPt: "Webhook Graph do Messenger — verificação (GET) e eventos (POST).",
        examplePayloadPt:
          "GET query (verificação): hub.mode=subscribe&hub.verify_token=<token-configurado-na-caixa>&hub.challenge=<string>\n\nPOST application/json — payload Graph Messenger (estrutura entry/messaging; ver documentação Meta).",
      },
      {
        method: "GET|POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/instagram",
        auth: "path_ingest_token",
        descriptionEn: "Instagram Messaging Graph webhook (GET verify, POST events).",
        descriptionPt: "Webhook Graph Instagram Messaging (GET verificação, POST eventos).",
        examplePayloadPt:
          "GET: idem Messenger (hub.mode, hub.verify_token, hub.challenge).\n\nPOST: payload Graph semelhante ao do Messenger para mensagens Instagram.",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/telegram",
        auth: "path_ingest_token",
        descriptionEn: "Telegram native webhook path (Bot updates JSON).",
        descriptionPt: "Webhook nativo Telegram (JSON de updates do bot).",
        examplePayloadPt:
          "POST application/json — update do Telegram Bot API (mesmo formato do exemplo acima para /public/inbox/.../telegram).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/line",
        auth: "path_ingest_token",
        descriptionEn: "LINE Messaging API webhook (events JSON).",
        descriptionPt: "Webhook LINE Messaging API (JSON de eventos).",
        examplePayloadPt:
          'POST application/json:\n{\n  "events": [\n    {\n      "type": "message",\n      "source": { "userId": "Uxxxxxxxx" },\n      "message": { "type": "text", "id": "...", "text": "Olá" }\n    }\n  ]\n}',
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/twilio",
        auth: "path_ingest_token",
        descriptionEn: "Twilio native callback URL for SMS/Voice channel inboxes.",
        descriptionPt: "URL nativa Twilio para caixas SMS/Voz.",
        examplePayloadPt:
          "POST application/x-www-form-urlencoded (igual ao webhook legado):\nFrom=...&Body=...&MessageSid=...",
      },
    ],
  },
  {
    id: "webhooks_whatsapp",
    titleEn: "Webhooks — WhatsApp / Meta",
    titlePt: "Webhooks — WhatsApp / Meta",
    endpoints: [
      {
        method: "GET|POST",
        path: "/webhooks/whatsapp/:organizationId",
        auth: "none",
        descriptionEn:
          "Organization-scoped WhatsApp webhook (verify + inbound; configured per tenant in settings).",
        descriptionPt:
          "Webhook WhatsApp por organização (verificação + entrada; configurado por tenant nas definições).",
        examplePayloadPt:
          "GET (verificação Meta): query hub.mode, hub.verify_token, hub.challenge (valores definidos nas definições do canal).\n\nPOST: corpo JSON do webhook WhatsApp Cloud API / parceiro (estrutura Meta; sem segredos aqui).",
      },
      {
        method: "GET|POST",
        path: "/webhooks/meta/whatsapp",
        auth: "none",
        descriptionEn: "Shared Meta / Cloud API webhook for embedded WhatsApp signup flows.",
        descriptionPt: "Webhook partilhado Meta / Cloud API para fluxos embedded.",
        examplePayloadPt:
          "GET/POST: payloads conforme documentação Meta WhatsApp Business / Cloud API (verificação GET + eventos POST).",
      },
    ],
  },
  {
    id: "auth",
    titleEn: "Authentication",
    titlePt: "Autenticação",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/auth/login",
        auth: "none",
        descriptionEn:
          "Sign in (returns `token` JWT in the body — use as Authorization: Bearer <token> on tenant routes; ADMIN/SUPER_ADMIN required for bot management).",
        descriptionPt:
          "Início de sessão (resposta com `token` — usar como Authorization: Bearer <token> nas rotas do tenant; gestão de bots exige ADMIN ou SUPER_ADMIN).",
        examplePayloadPt:
          'POST application/json:\n{\n  "email": "usuario@exemplo.com",\n  "password": "<sua_senha>"\n}\n\nResposta 200: { "token": "<jwt>", "user": { ... } } — use o campo `token` em Authorization: Bearer <jwt> nas rotas autenticadas (utilizador ADMIN ou SUPER_ADMIN no tenant).',
      },
      {
        method: "POST",
        path: "/api/v1/auth/logout",
        auth: "session_jwt",
        descriptionEn: "Sign out current session.",
        descriptionPt: "Terminar sessão atual.",
        examplePayloadPt: "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>",
      },
      {
        method: "GET",
        path: "/api/v1/auth/me",
        auth: "session_jwt",
        descriptionEn: "Current user and organization context.",
        descriptionPt: "Utilizador atual e contexto da organização.",
        examplePayloadPt: "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>",
      },
      {
        method: "PATCH",
        path: "/api/v1/auth/me",
        auth: "session_jwt",
        descriptionEn: "Update profile fields for current user.",
        descriptionPt: "Atualizar perfil do utilizador atual.",
        examplePayloadPt:
          'PATCH application/json (campos opcionais — alinhado à API):\n{\n  "name": "Novo nome",\n  "displayName": "Apelido no chat (ou null)",\n  "messageSignature": "Assinatura nas mensagens (ou null)",\n  "showAgentNameInChat": true\n}',
      },
      {
        method: "POST",
        path: "/api/v1/auth/me/password",
        auth: "session_jwt",
        descriptionEn: "Change password.",
        descriptionPt: "Alterar palavra-passe.",
        examplePayloadPt:
          'POST application/json:\n{\n  "currentPassword": "<atual>",\n  "newPassword": "<nova_senha>"\n}',
      },
      {
        method: "POST",
        path: "/api/v1/auth/exit-user-impersonation",
        auth: "session_jwt",
        descriptionEn: "Exit super-admin user impersonation when applicable.",
        descriptionPt: "Sair da impersonação de utilizador (super admin).",
        examplePayloadPt: "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>",
      },
      {
        method: "GET",
        path: "/api/v1/auth/me/access-token",
        auth: "session_jwt",
        descriptionEn: "Read profile API token status (admin in tenant).",
        descriptionPt: "Ler estado do token de API no perfil (admin no tenant).",
        examplePayloadPt:
          "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>. Resposta: { configured, prefix, lastUsedAt }.",
      },
      {
        method: "POST",
        path: "/api/v1/auth/me/access-token",
        auth: "session_jwt",
        descriptionEn: "Generate/rotate profile API token (admin in tenant).",
        descriptionPt: "Gerar/rodar token de API do perfil (admin no tenant).",
        examplePayloadPt:
          "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>. Resposta inclui `token` (mostrado apenas uma vez).",
      },
      {
        method: "DELETE",
        path: "/api/v1/auth/me/access-token",
        auth: "session_jwt",
        descriptionEn: "Revoke current profile API token (admin in tenant).",
        descriptionPt: "Revogar token de API atual do perfil (admin no tenant).",
        examplePayloadPt: "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>.",
      },
    ],
  },
  {
    id: "tenant_api",
    titleEn: "Tenant API (authenticated agents/admins)",
    titlePt: "API do tenant (agentes/admins autenticados)",
    endpoints: PUBLIC_TENANT_API_DOCUMENTATION_ENDPOINTS,
  },
  {
    id: "email_workspace",
    titleEn: "Email workspace",
    titlePt: "Workspace de e-mail",
    endpoints: PUBLIC_EMAIL_API_DOCUMENTATION_ENDPOINTS,
  },
  {
    id: "websocket",
    titleEn: "WebSocket",
    titlePt: "WebSocket",
    endpoints: [
      {
        method: "WS",
        path: "/api/v1/ws",
        auth: "session_jwt",
        descriptionEn: "Realtime workspace WebSocket (see server implementation for handshake).",
        descriptionPt: "WebSocket em tempo real do workspace (ver implementação do servidor).",
        examplePayloadPt:
          "Não é pedido HTTP com JSON. Abrir wss://<host>/api/v1/ws com cookie de sessão (ou credencial que o cliente use); handshake e mensagens conforme o servidor em workspaceHub.",
      },
    ],
  },
  {
    id: "agent_bot",
    titleEn: "Agent Bot HTTP API",
      titlePt: "API HTTP do Agent Bot (Bearer ocb_)",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/agent-bot/profile",
        auth: "agent_bot_bearer",
        descriptionEn:
          "Returns the bot for this inbox token — validate `ocb_...` and read `id` / `agent_bot_id`. Same data shape as GET /api/v1/bots/:id when using a user JWT. For read-only list with only `ocb_`, you may also call GET /api/v1/bots (response `data` has one entry). Creating or mutating bots still requires admin JWT. When the CRM POSTs inbound events to your bot `webhookUrl`, the JSON includes `inbox_id` and `inbox` with the stable inbox UUID (same as each inbox `id` from GET /api/v1/inboxes, Chatwoot-style).",
        descriptionPt:
          "Devolve o bot deste token de inbox — validar `ocb_...` e ler `id` / `agent_bot_id`. Mesmo formato que GET /api/v1/bots/:id com JWT de utilizador. Só com `ocb_` também pode usar GET /api/v1/bots (lista com um elemento em `data`). Criar ou alterar bots continua a exigir JWT de admin. Quando o CRM envia POST de eventos recebidos para o `webhookUrl` do bot, o JSON inclui `inbox_id` e `inbox` com o UUID estável da caixa (o mesmo `id` de GET /api/v1/inboxes, estilo Chatwoot).",
        examplePayloadPt:
          "Authorization: Bearer ocb_<token-do-bot>\n\nGET sem corpo.\n\nResposta 200: dados públicos do bot (como GET /api/v1/bots/:id), com `agent_bot_id` igual ao `id`.\n\nAlternativa só leitura: GET /api/v1/bots com o mesmo cabeçalho — `data` contém apenas este bot.",
      },
      {
        method: "GET",
        path: "/api/v1/agent-bot/lead-types",
        auth: "agent_bot_bearer",
        descriptionEn:
          "List funnel columns (lead types) for the organization — metadata only, no full board/contacts. For the complete kanban with contacts use JWT or profile token on GET /api/v1/pipeline/board.",
        descriptionPt:
          "Listar colunas do funil (tipos de lead) da organização — só metadados, sem board completo nem listagem de contactos. Para o quadro kanban com contactos use JWT ou token de perfil em GET /api/v1/pipeline/board.",
        examplePayloadPt:
          "Authorization: Bearer ocb_<token-do-bot>\n\nGET sem corpo.\n\nResposta 200: { \"data\": [ { \"id\", \"name\", \"color\", \"order\", \"valueRollup\" } ] }",
      },
      {
        method: "GET",
        path: "/api/v1/agent-bot/teams",
        auth: "agent_bot_bearer",
        descriptionEn:
          "List organization teams for routing (same shape as GET /api/v1/automations/teams). Use team `id` when assigning a conversation via PATCH /api/v1/agent-bot/conversations/:id/team.",
        descriptionPt:
          "Listar equipas da organização para roteamento (mesmo formato que GET /api/v1/automations/teams). Use o `id` da equipa ao atribuir a conversa com PATCH /api/v1/agent-bot/conversations/:id/team.",
        examplePayloadPt:
          "Authorization: Bearer ocb_<token-do-bot>\n\nGET sem corpo.\n\nResposta 200: { \"data\": [ { \"id\": \"<uuid>\", \"name\": \"...\", \"description\": null, \"_count\": { \"members\": 3 } } ] }",
      },
      {
        method: "POST",
        path: "/api/v1/agent-bot/messages",
        auth: "agent_bot_bearer",
        descriptionEn:
          "Outbound message from configured agent bot (Bearer token issued per bot; not a user JWT).",
        descriptionPt:
          "Mensagem de saída do bot configurado (Bearer do bot; não é JWT de utilizador).",
        examplePayloadPt:
          'Authorization: Bearer ocb_<token-do-bot>\n\nPOST application/json (mesmo schema que /api/v1/messages, sem isPrivate):\n{\n  "contactId": "<uuid>",\n  "conversationId": "<uuid-opcional>",\n  "type": "TEXT",\n  "body": "Resposta automática do bot"\n}\n\nResposta 201: { "message": {...}, "conversationId": "<uuid>", "agent_bot_id": "<uuid-do-bot>" }',
      },
      {
        method: "PATCH",
        path: "/api/v1/agent-bot/conversations/:id/team",
        auth: "agent_bot_bearer",
        descriptionEn:
          "Assign or clear the conversation team and optional assignee (same rules as PATCH /api/v1/automations/conversations/:id/team, but using the bot inbox token). `assignedToId` must be a member of `teamId` when both are set.",
        descriptionPt:
          "Atribuir ou limpar equipa da conversa e atendente opcional (mesmas regras que PATCH /api/v1/automations/conversations/:id/team, com token de inbox do bot). Se enviar ambos, `assignedToId` tem de pertencer a `teamId`.",
        examplePayloadPt:
          'Authorization: Bearer ocb_<token-do-bot>\n\nPATCH application/json:\n{\n  "teamId": "<uuid-equipa-ou-null>",\n  "assignedToId": "<uuid-agente-opcional-ou-null>"\n}\n\n`assignedToId` pode ser omitido para não alterar o atendente.',
      },
      {
        method: "PATCH",
        path: "/api/v1/agent-bot/conversations/:id",
        auth: "agent_bot_bearer",
        descriptionEn: "Set conversation status OPEN or PENDING for handoff/triage.",
        descriptionPt: "Definir estado da conversa OPEN ou PENDING (handoff/triagem).",
        examplePayloadPt: 'PATCH application/json:\n{\n  "status": "PENDING"\n}\n(OPEN ou PENDING)',
      },
    ],
  },
  {
    id: "platform_app",
    titleEn: "Platform application API",
    titlePt: "API de aplicação de plataforma",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/platform/me",
        auth: "platform_app_bearer",
        descriptionEn: "Verify platform app token and return identity metadata.",
        descriptionPt: "Validar token da aplicação de plataforma e metadados.",
        examplePayloadPt: "Sem corpo. Cabeçalho: Authorization: Bearer <platform_app_token>",
      },
      {
        method: "GET",
        path: "/api/v1/platform/stats",
        auth: "platform_app_bearer",
        descriptionEn: "Aggregated stats scoped to platform app credentials.",
        descriptionPt: "Estatísticas agregadas no âmbito da app de plataforma.",
        examplePayloadPt: "Sem corpo. Cabeçalho: Authorization: Bearer <platform_app_token>",
      },
    ],
  },
  {
    id: "super_admin",
    titleEn: "Super admin API",
    titlePt: "API de super administrador",
    endpoints: [
      {
        method: "GET|POST|PUT|PATCH|DELETE",
        path: "/api/v1/super/*",
        auth: "super_admin_jwt",
        descriptionEn:
          "Platform operations: orgs, users, audit, feature flags, platform settings, WhatsApp embedded, Evolution. Requires SUPER_ADMIN role.",
        descriptionPt:
          "Operações de plataforma: organizações, utilizadores, auditoria, feature flags, definições globais, WhatsApp embedded, Evolution. Requer papel SUPER_ADMIN.",
        examplePayloadPt:
          "Cabeçalho: Authorization: Bearer <jwt-super-admin>\n\nGET: sem corpo (ex.: /api/v1/super/organizations).\n\nPOST/PATCH: JSON conforme rota, ex. PATCH definição:\n{\n  \"publicSystemDocumentationEnabled\": true\n}\n(consultar rotas em apps/api/src/routes/super.ts ou documentação interna.)",
      },
    ],
  },
];
