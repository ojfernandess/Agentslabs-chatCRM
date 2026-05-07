/**
 * Catálogo estático de rotas HTTP (sem segredos, tokens ou IDs reais).
 * Atualizar quando se adicionarem routers — a página pública só é servida se o super admin ativar.
 */

export type PublicApiDocAuth =
  | "none"
  | "session_jwt"
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
      },
      {
        method: "GET|POST",
        path: "/api/v1/public/csat/:token",
        auth: "path_ingest_token",
        descriptionEn: "Customer satisfaction survey page token flow (GET view, POST submit).",
        descriptionPt: "Fluxo do inquérito CSAT com token no URL (GET visualização, POST submissão).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/inbox/:token/inbound",
        auth: "path_ingest_token",
        descriptionEn: "Legacy generic channel JSON ingest (participantId, body, etc.).",
        descriptionPt: "Ingestão JSON genérica legada por token (participantId, body, etc.).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/inbox/:token/telegram",
        auth: "path_ingest_token",
        descriptionEn: "Telegram Bot API update webhook (legacy path under /public/inbox).",
        descriptionPt: "Webhook de updates do Telegram (caminho legado sob /public/inbox).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/inbox/:token/twilio",
        auth: "path_ingest_token",
        descriptionEn: "Twilio SMS/voice callback (form body; legacy path).",
        descriptionPt: "Callback Twilio SMS/voz (form body; caminho legado).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/contacts/:contactIdentifier/messages",
        auth: "path_ingest_token",
        descriptionEn:
          "Native client-style message post for Website/API channel inboxes (JSON: content, optional name, email, echo_id).",
        descriptionPt:
          "Envio estilo Client API para caixas Website/API (JSON: content, name, email, echo_id opcionais).",
      },
      {
        method: "GET|POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/facebook",
        auth: "path_ingest_token",
        descriptionEn: "Facebook Messenger Graph webhook verification (GET) and messaging events (POST).",
        descriptionPt: "Webhook Graph do Messenger — verificação (GET) e eventos (POST).",
      },
      {
        method: "GET|POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/instagram",
        auth: "path_ingest_token",
        descriptionEn: "Instagram Messaging Graph webhook (GET verify, POST events).",
        descriptionPt: "Webhook Graph Instagram Messaging (GET verificação, POST eventos).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/telegram",
        auth: "path_ingest_token",
        descriptionEn: "Telegram native webhook path (Bot updates JSON).",
        descriptionPt: "Webhook nativo Telegram (JSON de updates do bot).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/line",
        auth: "path_ingest_token",
        descriptionEn: "LINE Messaging API webhook (events JSON).",
        descriptionPt: "Webhook LINE Messaging API (JSON de eventos).",
      },
      {
        method: "POST|OPTIONS",
        path: "/api/v1/public/channels/inboxes/:token/twilio",
        auth: "path_ingest_token",
        descriptionEn: "Twilio native callback URL for SMS/Voice channel inboxes.",
        descriptionPt: "URL nativa Twilio para caixas SMS/Voz.",
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
      },
      {
        method: "GET|POST",
        path: "/webhooks/meta/whatsapp",
        auth: "none",
        descriptionEn: "Shared Meta / Cloud API webhook for embedded WhatsApp signup flows.",
        descriptionPt: "Webhook partilhado Meta / Cloud API para fluxos embedded.",
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
        descriptionEn: "Sign in (returns JWT; do not log or expose tokens in client-side docs).",
        descriptionPt: "Início de sessão (devolve JWT; não documentar tokens em exemplos públicos).",
      },
      {
        method: "POST",
        path: "/api/v1/auth/logout",
        auth: "session_jwt",
        descriptionEn: "Sign out current session.",
        descriptionPt: "Terminar sessão atual.",
      },
      {
        method: "GET",
        path: "/api/v1/auth/me",
        auth: "session_jwt",
        descriptionEn: "Current user and organization context.",
        descriptionPt: "Utilizador atual e contexto da organização.",
      },
      {
        method: "PATCH",
        path: "/api/v1/auth/me",
        auth: "session_jwt",
        descriptionEn: "Update profile fields for current user.",
        descriptionPt: "Atualizar perfil do utilizador atual.",
      },
      {
        method: "POST",
        path: "/api/v1/auth/me/password",
        auth: "session_jwt",
        descriptionEn: "Change password.",
        descriptionPt: "Alterar palavra-passe.",
      },
      {
        method: "POST",
        path: "/api/v1/auth/exit-user-impersonation",
        auth: "session_jwt",
        descriptionEn: "Exit super-admin user impersonation when applicable.",
        descriptionPt: "Sair da impersonação de utilizador (super admin).",
      },
    ],
  },
  {
    id: "tenant_api",
    titleEn: "Tenant API (authenticated agents/admins)",
    titlePt: "API do tenant (agentes/admins autenticados)",
    endpoints: [
      { method: "GET", path: "/api/v1/dashboard", auth: "session_jwt", descriptionEn: "Dashboard summary.", descriptionPt: "Resumo do painel." },
      { method: "GET", path: "/api/v1/reports", auth: "session_jwt", descriptionEn: "Reporting and analytics.", descriptionPt: "Relatórios e análise." },
      { method: "GET|POST", path: "/api/v1/contacts", auth: "session_jwt", descriptionEn: "List and create contacts.", descriptionPt: "Listar e criar contactos." },
      { method: "GET|PUT|DELETE", path: "/api/v1/contacts/:id", auth: "session_jwt", descriptionEn: "Contact CRUD and related sub-resources.", descriptionPt: "CRUD de contacto e sub-recursos." },
      { method: "GET", path: "/api/v1/contacts/:id/messages", auth: "session_jwt", descriptionEn: "Timeline messages for contact.", descriptionPt: "Mensagens na cronologia do contacto." },
      { method: "POST|DELETE", path: "/api/v1/contacts/:id/tags", auth: "session_jwt", descriptionEn: "Tag assignments.", descriptionPt: "Atribuição de tags." },
      { method: "PUT", path: "/api/v1/contacts/:id/stage", auth: "session_jwt", descriptionEn: "Pipeline stage update.", descriptionPt: "Atualizar etapa do pipeline." },
      { method: "GET|PUT", path: "/api/v1/conversations", auth: "session_jwt", descriptionEn: "List/update conversations (see route file for query params).", descriptionPt: "Listar/atualizar conversas." },
      { method: "GET", path: "/api/v1/conversations/audit", auth: "session_jwt", descriptionEn: "Conversation audit log.", descriptionPt: "Registo de auditoria de conversas." },
      { method: "GET|PUT", path: "/api/v1/conversations/:id", auth: "session_jwt", descriptionEn: "Single conversation.", descriptionPt: "Conversa individual." },
      { method: "POST", path: "/api/v1/messages", auth: "session_jwt", descriptionEn: "Send message / create draft.", descriptionPt: "Enviar mensagem / rascunho." },
      { method: "POST", path: "/api/v1/messages/upload-audio", auth: "session_jwt", descriptionEn: "Upload audio for messages.", descriptionPt: "Carregar áudio para mensagens." },
      { method: "POST", path: "/api/v1/messages/upload-media", auth: "session_jwt", descriptionEn: "Upload media attachment.", descriptionPt: "Carregar multimédia." },
      { method: "GET", path: "/api/v1/messages/:id", auth: "session_jwt", descriptionEn: "Get message by id.", descriptionPt: "Obter mensagem por id." },
      { method: "GET|POST|PUT|DELETE", path: "/api/v1/tags", auth: "session_jwt", descriptionEn: "Tags CRUD.", descriptionPt: "CRUD de tags." },
      { method: "GET", path: "/api/v1/pipeline/board", auth: "session_jwt", descriptionEn: "Pipeline board data.", descriptionPt: "Dados do quadro do pipeline." },
      { method: "GET", path: "/api/v1/pipeline/stages", auth: "session_jwt", descriptionEn: "List pipeline stages.", descriptionPt: "Listar etapas do pipeline." },
      { method: "POST", path: "/api/v1/pipeline/stages", auth: "session_jwt", descriptionEn: "Create stage (admin).", descriptionPt: "Criar etapa (admin)." },
      { method: "PUT|DELETE", path: "/api/v1/pipeline/stages/:id", auth: "session_jwt", descriptionEn: "Update or delete stage (admin).", descriptionPt: "Atualizar ou eliminar etapa (admin)." },
      { method: "GET", path: "/api/v1/crm/pipeline-stages", auth: "session_jwt", descriptionEn: "CRM pipeline stages list.", descriptionPt: "Lista de etapas CRM." },
      { method: "GET", path: "/api/v1/crm/timeline", auth: "session_jwt", descriptionEn: "CRM timeline feed.", descriptionPt: "Cronologia CRM." },
      { method: "GET|POST", path: "/api/v1/crm/accounts", auth: "session_jwt", descriptionEn: "CRM accounts.", descriptionPt: "Contas CRM." },
      { method: "GET|PATCH", path: "/api/v1/crm/accounts/:id", auth: "session_jwt", descriptionEn: "Single CRM account.", descriptionPt: "Conta CRM individual." },
      { method: "GET|POST", path: "/api/v1/crm/products", auth: "session_jwt", descriptionEn: "CRM products.", descriptionPt: "Produtos CRM." },
      { method: "PATCH", path: "/api/v1/crm/products/:id", auth: "session_jwt", descriptionEn: "Update product.", descriptionPt: "Atualizar produto." },
      { method: "GET|POST", path: "/api/v1/crm/deals", auth: "session_jwt", descriptionEn: "CRM deals list and create.", descriptionPt: "Listar e criar negócios." },
      { method: "GET|PATCH|DELETE", path: "/api/v1/crm/deals/:id", auth: "session_jwt", descriptionEn: "Deal detail, update, delete.", descriptionPt: "Detalhe, atualizar, eliminar negócio." },
      { method: "POST", path: "/api/v1/crm/deals/:id/line-items", auth: "session_jwt", descriptionEn: "Add deal line item.", descriptionPt: "Adicionar linha ao negócio." },
      { method: "PATCH|DELETE", path: "/api/v1/crm/deals/:id/line-items/:lineId", auth: "session_jwt", descriptionEn: "Update or remove line item.", descriptionPt: "Atualizar ou remover linha." },
      { method: "GET|POST|PUT|DELETE", path: "/api/v1/lead-types", auth: "session_jwt", descriptionEn: "Lead types.", descriptionPt: "Tipos de lead." },
      { method: "GET|POST|PUT|DELETE", path: "/api/v1/reminders", auth: "session_jwt", descriptionEn: "Reminders.", descriptionPt: "Lembretes." },
      { method: "GET|POST|DELETE", path: "/api/v1/templates", auth: "session_jwt", descriptionEn: "Message templates.", descriptionPt: "Modelos de mensagem." },
      { method: "POST", path: "/api/v1/templates/evolution", auth: "session_jwt", descriptionEn: "Sync templates from Evolution (admin).", descriptionPt: "Sincronizar modelos Evolution (admin)." },
      { method: "POST", path: "/api/v1/broadcasts/audience-preview", auth: "session_jwt", descriptionEn: "Preview broadcast audience.", descriptionPt: "Pré-visualizar audiência de campanha." },
      { method: "GET|POST|DELETE", path: "/api/v1/broadcasts", auth: "session_jwt", descriptionEn: "Broadcast campaigns CRUD.", descriptionPt: "CRUD de campanhas de difusão." },
      { method: "POST", path: "/api/v1/broadcasts/:id/start", auth: "session_jwt", descriptionEn: "Start sending a campaign.", descriptionPt: "Iniciar envio da campanha." },
      { method: "GET", path: "/api/v1/settings/notifications", auth: "session_jwt", descriptionEn: "Notification toggles.", descriptionPt: "Interruptores de notificação." },
      { method: "GET", path: "/api/v1/settings/channel", auth: "session_jwt", descriptionEn: "Channel summary for UI.", descriptionPt: "Resumo do canal para a UI." },
      { method: "GET|PUT", path: "/api/v1/settings", auth: "session_jwt", descriptionEn: "Organization settings (admin); masked secrets in responses.", descriptionPt: "Definições da organização (admin); segredos mascarados." },
      { method: "POST", path: "/api/v1/settings/test-connection", auth: "session_jwt", descriptionEn: "Test WhatsApp/provider connectivity (admin).", descriptionPt: "Teste de conectividade do fornecedor (admin)." },
      { method: "GET|POST", path: "/api/v1/settings/whatsapp-embedded", auth: "session_jwt", descriptionEn: "Embedded signup helpers (admin).", descriptionPt: "Auxiliares de embedded signup (admin)." },
      { method: "POST", path: "/api/v1/settings/evolution-qr/start", auth: "session_jwt", descriptionEn: "Start Evolution QR session (admin).", descriptionPt: "Iniciar sessão QR Evolution (admin)." },
      { method: "GET", path: "/api/v1/settings/evolution-qr/qr", auth: "session_jwt", descriptionEn: "Poll QR payload (admin).", descriptionPt: "Obter payload do QR (admin)." },
      { method: "GET", path: "/api/v1/settings/evolution-qr/status", auth: "session_jwt", descriptionEn: "Connection status (admin).", descriptionPt: "Estado da ligação (admin)." },
      { method: "GET|POST|PUT|DELETE", path: "/api/v1/users", auth: "session_jwt", descriptionEn: "Users management.", descriptionPt: "Gestão de utilizadores." },
      { method: "GET|POST|PATCH|DELETE", path: "/api/v1/inboxes", auth: "session_jwt", descriptionEn: "Inboxes, members; admin to create/patch/delete.", descriptionPt: "Caixas e membros; admin para criar/editar." },
      { method: "POST", path: "/api/v1/inboxes/:id/rotate-ingest-token", auth: "session_jwt", descriptionEn: "Rotate public ingest token for an inbox (admin).", descriptionPt: "Rodar token de ingestão público (admin)." },
      { method: "GET|POST|PATCH|DELETE", path: "/api/v1/teams", auth: "session_jwt", descriptionEn: "Teams and memberships.", descriptionPt: "Equipas e membros." },
      { method: "GET|POST|PATCH|DELETE", path: "/api/v1/bots", auth: "session_jwt", descriptionEn: "Bots, inbox tokens, interactions (admin for some).", descriptionPt: "Bots, tokens de inbox, interações." },
    ],
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
      },
    ],
  },
  {
    id: "agent_bot",
    titleEn: "Agent Bot HTTP API",
    titlePt: "API HTTP do Agent Bot",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/agent-bot/messages",
        auth: "agent_bot_bearer",
        descriptionEn:
          "Outbound message from configured agent bot (Bearer token issued per bot; not a user JWT).",
        descriptionPt:
          "Mensagem de saída do bot configurado (Bearer do bot; não é JWT de utilizador).",
      },
      {
        method: "PATCH",
        path: "/api/v1/agent-bot/conversations/:id",
        auth: "agent_bot_bearer",
        descriptionEn: "Set conversation status OPEN or PENDING for handoff/triage.",
        descriptionPt: "Definir estado da conversa OPEN ou PENDING (handoff/triagem).",
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
      },
      {
        method: "GET",
        path: "/api/v1/platform/stats",
        auth: "platform_app_bearer",
        descriptionEn: "Aggregated stats scoped to platform app credentials.",
        descriptionPt: "Estatísticas agregadas no âmbito da app de plataforma.",
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
      },
    ],
  },
];
