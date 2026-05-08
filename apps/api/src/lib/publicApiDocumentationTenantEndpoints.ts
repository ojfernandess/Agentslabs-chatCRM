import type { PublicApiDocEndpoint } from "./publicApiDocumentationCatalog.js";

export const PUBLIC_TENANT_API_DOCUMENTATION_ENDPOINTS: PublicApiDocEndpoint[] = [
  {
    method: "GET",
    path: "/api/v1/dashboard",
    auth: "session_jwt",
    descriptionEn: "Dashboard summary.",
    descriptionPt: "Resumo do painel.",
    examplePayloadPt: "Sem corpo. Cabeçalho: Authorization: Bearer <jwt>",
  },
  {
    method: "GET",
    path: "/api/v1/reports",
    auth: "session_jwt",
    descriptionEn: "Reporting and analytics.",
    descriptionPt: "Relatórios e análise.",
    examplePayloadPt:
      "Sem corpo. Query comum (exemplos): ?from=2026-01-01&to=2026-01-31 — parâmetros exatos conforme relatório na UI.",
  },
  {
    method: "GET|POST",
    path: "/api/v1/contacts",
    auth: "session_jwt",
    descriptionEn: "List and create contacts.",
    descriptionPt: "Listar e criar contactos.",
    examplePayloadPt:
      'GET: sem corpo; query opcional ?page=1&pageSize=20&search=ana&tag=<uuid-tag>&stage=<uuid-etapa>&assignee=<uuid-user>.\n\nPOST application/json:\n{\n  "phone": "+5511999990000",\n  "name": "Maria Silva",\n  "notes": "Opcional",\n  "tags": ["<uuid-tag>"]\n}',
  },
  {
    method: "GET|PUT|DELETE",
    path: "/api/v1/contacts/:id",
    auth: "session_jwt",
    descriptionEn: "Contact CRUD and related sub-resources.",
    descriptionPt: "CRUD de contacto e sub-recursos.",
    examplePayloadPt:
      "GET/DELETE :id no path, sem corpo.\n\nPUT application/json (campos opcionais):\n{\n  \"name\": \"Novo nome\",\n  \"phone\": \"+5511888880000\",\n  \"notes\": null,\n  \"email\": \"maria@exemplo.com\",\n  \"accountId\": null,\n  \"lifecycleStage\": null,\n  \"pipelineStageId\": \"<uuid-etapa>\",\n  \"assignedToId\": \"<uuid-agente>\",\n  \"optedIn\": true\n}",
  },
  {
    method: "GET",
    path: "/api/v1/contacts/:id/messages",
    auth: "session_jwt",
    descriptionEn: "Timeline messages for contact.",
    descriptionPt: "Mensagens na cronologia do contacto.",
    examplePayloadPt: "Sem corpo. GET /api/v1/contacts/<uuid-contact>/messages",
  },
  {
    method: "POST|DELETE",
    path: "/api/v1/contacts/:id/tags",
    auth: "session_jwt",
    descriptionEn: "Tag assignments.",
    descriptionPt: "Atribuição de tags.",
    examplePayloadPt:
      'POST application/json:\n{\n  "tagIds": ["<uuid-tag-1>", "<uuid-tag-2>"]\n}\n\nDELETE: sem corpo — use /api/v1/contacts/:id/tags/:tagId',
  },
  {
    method: "PUT",
    path: "/api/v1/contacts/:id/stage",
    auth: "session_jwt",
    descriptionEn: "Pipeline stage update.",
    descriptionPt: "Atualizar etapa do pipeline.",
    examplePayloadPt:
      'Envie exatamente um dos campos (lead type OU etapa legada):\n{"leadTypeId": "<uuid-tipo-lead>"}\nou\n{"stageId": "<uuid-pipeline-stage>"}\nou null para limpar (ex.: {"leadTypeId": null}).',
  },
  {
    method: "GET|PUT",
    path: "/api/v1/conversations",
    auth: "session_jwt",
    descriptionEn: "List/update conversations (see route file for query params).",
    descriptionPt: "Listar/atualizar conversas.",
    examplePayloadPt:
      "GET: sem corpo. Query exemplo: ?page=1&pageSize=20&status=OPEN&inboxId=<uuid>&teamId=<uuid>&assignedToId=<uuid>&leadTypeId=<uuid>&mine=1&since=2026-01-01T00:00:00.000Z\n\nPUT de atualização aplica-se a /api/v1/conversations/:id (ver linha seguinte).",
  },
  {
    method: "GET",
    path: "/api/v1/conversations/audit",
    auth: "session_jwt",
    descriptionEn: "Conversation audit log.",
    descriptionPt: "Registo de auditoria de conversas.",
    examplePayloadPt:
      "Sem corpo. Query exemplo: ?status=RESOLVED&page=1&pageSize=20&inboxId=<uuid>&resolvedFrom=...&resolvedTo=...",
  },
  {
    method: "GET|PUT",
    path: "/api/v1/conversations/:id",
    auth: "session_jwt",
    descriptionEn: "Single conversation.",
    descriptionPt: "Conversa individual.",
    examplePayloadPt:
      'GET: sem corpo.\n\nPUT application/json (campos opcionais):\n{\n  "status": "RESOLVED",\n  "assignedToId": "<uuid-agente-ou-null>",\n  "teamId": "<uuid-equipa-ou-null>",\n  "closureReason": "Resolvido por telefone",\n  "leadTypeId": "<uuid>",\n  "closureValue": 1500.5\n}',
  },
  {
    method: "POST",
    path: "/api/v1/messages",
    auth: "session_jwt",
    descriptionEn: "Send message / create draft.",
    descriptionPt: "Enviar mensagem / rascunho.",
    examplePayloadPt:
      'Texto ao cliente:\n{\n  "contactId": "<uuid>",\n  "conversationId": "<uuid-opcional>",\n  "type": "TEXT",\n  "body": "Olá, em que posso ajudar?",\n  "isPrivate": false\n}\n\nMídia (URL pública HTTPS):\n{\n  "contactId": "<uuid>",\n  "type": "IMAGE",\n  "mediaUrl": "https://exemplo.com/foto.png",\n  "mediaType": "image/png"\n}\n\nModelo WhatsApp:\n{\n  "contactId": "<uuid>",\n  "type": "TEMPLATE",\n  "templateId": "<uuid-modelo>",\n  "templateBodyParameters": ["valor1", "valor2"]\n}\n\nNota interna:\n{\n  "contactId": "<uuid>",\n  "type": "TEXT",\n  "body": "Ligou reclamando da fatura",\n  "isPrivate": true\n}',
  },
  {
    method: "POST",
    path: "/api/v1/messages/upload-audio",
    auth: "session_jwt",
    descriptionEn: "Upload audio for messages.",
    descriptionPt: "Carregar áudio para mensagens.",
    examplePayloadPt:
      "multipart/form-data com campo de ficheiro de áudio (conforme cliente HTTP; não é JSON).",
  },
  {
    method: "POST",
    path: "/api/v1/messages/upload-media",
    auth: "session_jwt",
    descriptionEn: "Upload media attachment.",
    descriptionPt: "Carregar multimédia.",
    examplePayloadPt:
      "multipart/form-data com campo de ficheiro (imagem, vídeo, documento; conforme cliente HTTP).",
  },
  {
    method: "GET",
    path: "/api/v1/messages/:id",
    auth: "session_jwt",
    descriptionEn: "Get message by id.",
    descriptionPt: "Obter mensagem por id.",
    examplePayloadPt: "Sem corpo. GET /api/v1/messages/<uuid>",
  },
  {
    method: "GET",
    path: "/api/v1/tags",
    auth: "session_jwt",
    descriptionEn: "List organization tags (labels).",
    descriptionPt: "Listar etiquetas (tags) da organização.",
    examplePayloadPt: "Sem corpo. Resposta: array de tags (id, name, color, …), ordenado por nome.",
  },
  {
    method: "POST",
    path: "/api/v1/tags",
    auth: "session_jwt",
    descriptionEn: "Create tag.",
    descriptionPt: "Criar etiqueta.",
    examplePayloadPt:
      'POST application/json:\n{\n  "name": "VIP",\n  "color": "#22c55e"\n}\n(cor #RRGGBB)',
  },
  {
    method: "PUT",
    path: "/api/v1/tags/:id",
    auth: "session_jwt",
    descriptionEn: "Update tag.",
    descriptionPt: "Atualizar etiqueta.",
    examplePayloadPt:
      'PUT application/json:\n{\n  "name": "VIP Plus",\n  "color": "#16a34a"\n}',
  },
  {
    method: "DELETE",
    path: "/api/v1/tags/:id",
    auth: "session_jwt",
    descriptionEn: "Delete tag.",
    descriptionPt: "Eliminar etiqueta.",
    examplePayloadPt: "Sem corpo. DELETE /api/v1/tags/<uuid>",
  },
  {
    method: "GET",
    path: "/api/v1/pipeline/board",
    auth: "session_jwt",
    descriptionEn: "CRM funnel board: stages and contacts for kanban.",
    descriptionPt:
      "Listar funil CRM (quadro kanban): colunas correspondentes aos tipos de lead e contactos por etapa.",
    examplePayloadPt: "Sem corpo. Requer funil CRM (`crm_kanban`) ativo na organização.",
  },
  {
    method: "GET",
    path: "/api/v1/pipeline/stages",
    auth: "session_jwt",
    descriptionEn: "List pipeline stages.",
    descriptionPt: "Listar colunas do funil (espelho dos tipos de lead; requer funil CRM).",
    examplePayloadPt: "Sem corpo.",
  },
  {
    method: "POST",
    path: "/api/v1/pipeline/stages",
    auth: "session_jwt",
    descriptionEn: "Create stage (admin).",
    descriptionPt: "Criar etapa (admin).",
    examplePayloadPt:
      "POST pode devolver 400: colunas vêm dos Tipos de lead (Configurações). Sem payload típico de criação aqui — criar tipos de lead em /api/v1/lead-types.",
  },
  {
    method: "PUT|DELETE",
    path: "/api/v1/pipeline/stages/:id",
    auth: "session_jwt",
    descriptionEn: "Update or delete stage (admin).",
    descriptionPt: "Atualizar ou eliminar etapa (admin).",
    examplePayloadPt:
      "Administrador: ver código da rota para corpo exato; muitas operações de coluna passam por tipos de lead.",
  },
  {
    method: "GET",
    path: "/api/v1/crm/pipeline-stages",
    auth: "session_jwt",
    descriptionEn: "CRM pipeline stages list.",
    descriptionPt: "Lista de etapas CRM.",
    examplePayloadPt: "Sem corpo.",
  },
  {
    method: "GET",
    path: "/api/v1/crm/timeline",
    auth: "session_jwt",
    descriptionEn: "CRM timeline feed.",
    descriptionPt: "Cronologia CRM.",
    examplePayloadPt: "Sem corpo. Query conforme CRM (filtros opcionais na rota).",
  },
  {
    method: "GET|POST",
    path: "/api/v1/crm/accounts",
    auth: "session_jwt",
    descriptionEn: "CRM accounts.",
    descriptionPt: "Contas CRM.",
    examplePayloadPt:
      'GET: sem corpo (listagem).\n\nPOST application/json — campos típicos de conta (exemplo ilustrativo):\n{\n  "name": "Acme Ltda",\n  "website": "https://acme.com"\n}',
  },
  {
    method: "GET|PATCH",
    path: "/api/v1/crm/accounts/:id",
    auth: "session_jwt",
    descriptionEn: "Single CRM account.",
    descriptionPt: "Conta CRM individual.",
    examplePayloadPt:
      "GET: sem corpo.\n\nPATCH application/json — campos parciais conforme rota CRM (nome, website, etc.).",
  },
  {
    method: "GET|POST",
    path: "/api/v1/crm/products",
    auth: "session_jwt",
    descriptionEn: "CRM products.",
    descriptionPt: "Produtos CRM.",
    examplePayloadPt:
      'POST application/json (ilustrativo):\n{\n  "name": "Plano Pro",\n  "unitPrice": 99.9,\n  "currency": "BRL"\n}',
  },
  {
    method: "PATCH",
    path: "/api/v1/crm/products/:id",
    auth: "session_jwt",
    descriptionEn: "Update product.",
    descriptionPt: "Atualizar produto.",
    examplePayloadPt: 'PATCH application/json (campos parciais):\n{\n  "name": "Plano Pro (atualizado)",\n  "unitPrice": 119\n}',
  },
  {
    method: "GET|POST",
    path: "/api/v1/crm/deals",
    auth: "session_jwt",
    descriptionEn: "CRM deals list and create.",
    descriptionPt: "Listar e criar negócios.",
    examplePayloadPt:
      'GET: sem corpo.\n\nPOST application/json (ilustrativo — alinhar com schema da rota):\n{\n  "name": "Venda suporte 2026",\n  "accountId": "<uuid-conta>",\n  "pipelineStageId": "<uuid>",\n  "amount": 5000\n}',
  },
  {
    method: "GET|PATCH|DELETE",
    path: "/api/v1/crm/deals/:id",
    auth: "session_jwt",
    descriptionEn: "Deal detail, update, delete.",
    descriptionPt: "Detalhe, atualizar, eliminar negócio.",
    examplePayloadPt:
      "GET/DELETE: sem corpo.\n\nPATCH application/json — campos parciais do negócio (nome, valor, etapa, etc.).",
  },
  {
    method: "POST",
    path: "/api/v1/crm/deals/:id/line-items",
    auth: "session_jwt",
    descriptionEn: "Add deal line item.",
    descriptionPt: "Adicionar linha ao negócio.",
    examplePayloadPt:
      'POST application/json (ilustrativo):\n{\n  "productId": "<uuid-produto>",\n  "quantity": 2,\n  "unitPrice": 49.9\n}',
  },
  {
    method: "PATCH|DELETE",
    path: "/api/v1/crm/deals/:id/line-items/:lineId",
    auth: "session_jwt",
    descriptionEn: "Update or remove line item.",
    descriptionPt: "Atualizar ou remover linha.",
    examplePayloadPt:
      "DELETE: sem corpo.\n\nPATCH application/json — campos da linha (quantidade, preço, etc.) conforme rota.",
  },
  {
    method: "GET",
    path: "/api/v1/lead-types",
    auth: "session_jwt",
    descriptionEn: "List lead types (CRM funnel columns).",
    descriptionPt: "Listar tipos de lead (colunas do funil CRM).",
    examplePayloadPt:
      "Sem corpo. Resposta: array com id, name, color, order, valueRollup por coluna do funil.",
  },
  {
    method: "POST",
    path: "/api/v1/lead-types",
    auth: "session_jwt",
    descriptionEn: "Create lead type / funnel column (admin).",
    descriptionPt: "Criar tipo de lead / coluna do funil (admin).",
    examplePayloadPt:
      'POST application/json:\n{\n  "name": "Lead quente",\n  "color": "#ef4444",\n  "order": 1,\n  "valueRollup": "PIPELINE"\n}\n(valueRollup opcional: PIPELINE | WON | LOST | NONE)',
  },
  {
    method: "PUT",
    path: "/api/v1/lead-types/:id",
    auth: "session_jwt",
    descriptionEn: "Update lead type (admin).",
    descriptionPt: "Atualizar tipo de lead (admin).",
    examplePayloadPt:
      'PUT application/json (mesmo schema que POST):\n{\n  "name": "Lead morno",\n  "color": "#f97316",\n  "order": 2,\n  "valueRollup": "PIPELINE"\n}',
  },
  {
    method: "DELETE",
    path: "/api/v1/lead-types/:id",
    auth: "session_jwt",
    descriptionEn: "Delete lead type (admin).",
    descriptionPt: "Eliminar tipo de lead (admin).",
    examplePayloadPt: "Sem corpo. DELETE /api/v1/lead-types/<uuid>",
  },
  {
    method: "GET|POST|PUT|DELETE",
    path: "/api/v1/reminders",
    auth: "session_jwt",
    descriptionEn: "Reminders.",
    descriptionPt: "Lembretes.",
    examplePayloadPt:
      'POST application/json:\n{\n  "contactId": "<uuid-contacto>",\n  "note": "Ligar para confirmar horário",\n  "dueAt": "2026-05-10T15:00:00.000Z"\n}',
  },
  {
    method: "GET|POST|DELETE",
    path: "/api/v1/templates",
    auth: "session_jwt",
    descriptionEn: "Message templates.",
    descriptionPt: "Modelos de mensagem.",
    examplePayloadPt:
      'POST application/json:\n{\n  "name": "saudacao",\n  "body": "Olá {{1}}, tudo bem?",\n  "templateLanguage": "pt_BR"\n}',
  },
  {
    method: "POST",
    path: "/api/v1/templates/evolution",
    auth: "session_jwt",
    descriptionEn: "Sync templates from Evolution (admin).",
    descriptionPt: "Sincronizar modelos Evolution (admin).",
    examplePayloadPt: "Sem corpo ou {} conforme implementação — accionado por admin para puxar modelos do provedor Evolution.",
  },
  {
    method: "POST",
    path: "/api/v1/broadcasts/audience-preview",
    auth: "session_jwt",
    descriptionEn: "Preview broadcast audience.",
    descriptionPt: "Pré-visualizar audiência de campanha.",
    examplePayloadPt: 'POST application/json:\n{\n  "tagIds": ["<uuid-tag-1>", "<uuid-tag-2>"]\n}',
  },
  {
    method: "GET|POST|DELETE",
    path: "/api/v1/broadcasts",
    auth: "session_jwt",
    descriptionEn: "Broadcast campaigns CRUD.",
    descriptionPt: "CRUD de campanhas de difusão.",
    examplePayloadPt:
      'GET: sem corpo.\n\nPOST application/json (campanha texto):\n{\n  "name": "Promo maio",\n  "messageType": "TEXT",\n  "body": "Olá! Temos novidades.",\n  "tagIds": ["<uuid>"]\n}\n\nPOST com modelo (sem variáveis no corpo do modelo para campanha):\n{\n  "name": "Aviso modelo",\n  "messageType": "TEMPLATE",\n  "templateId": "<uuid-modelo-sem-variaveis>",\n  "tagIds": ["<uuid>"]\n}',
  },
  {
    method: "POST",
    path: "/api/v1/broadcasts/:id/start",
    auth: "session_jwt",
    descriptionEn: "Start sending a campaign.",
    descriptionPt: "Iniciar envio da campanha.",
    examplePayloadPt: "Sem corpo. POST /api/v1/broadcasts/<uuid-campanha>/start",
  },
  {
    method: "GET",
    path: "/api/v1/settings/notifications",
    auth: "session_jwt",
    descriptionEn: "Notification toggles.",
    descriptionPt: "Interruptores de notificação.",
    examplePayloadPt: "Sem corpo.",
  },
  {
    method: "GET",
    path: "/api/v1/settings/channel",
    auth: "session_jwt",
    descriptionEn: "Channel summary for UI.",
    descriptionPt: "Resumo do canal para a UI.",
    examplePayloadPt: "Sem corpo.",
  },
  {
    method: "GET|PUT",
    path: "/api/v1/settings",
    auth: "session_jwt",
    descriptionEn: "Organization settings (admin); masked secrets in responses.",
    descriptionPt: "Definições da organização (admin); segredos mascarados.",
    examplePayloadPt:
      "GET: sem corpo.\n\nPUT application/json — objeto de definições (campos dependem do canal/provedor); segredos nas respostas vêm mascarados.",
  },
  {
    method: "POST",
    path: "/api/v1/settings/test-connection",
    auth: "session_jwt",
    descriptionEn: "Test WhatsApp/provider connectivity (admin).",
    descriptionPt: "Teste de conectividade do fornecedor (admin).",
    examplePayloadPt: "Sem corpo ou {} — testa credenciais já guardadas nas definições.",
  },
  {
    method: "GET|POST",
    path: "/api/v1/settings/whatsapp-embedded",
    auth: "session_jwt",
    descriptionEn: "Embedded signup helpers (admin).",
    descriptionPt: "Auxiliares de embedded signup (admin).",
    examplePayloadPt:
      "GET: sem corpo (estado do fluxo).\n\nPOST: JSON conforme passo do embedded signup (códigos, tokens temporários Meta — ver rota).",
  },
  {
    method: "POST",
    path: "/api/v1/settings/evolution-qr/start",
    auth: "session_jwt",
    descriptionEn: "Start Evolution QR session (admin).",
    descriptionPt: "Iniciar sessão QR Evolution (admin).",
    examplePayloadPt: "POST sem corpo ou conforme rota para iniciar sessão Evolution QR.",
  },
  {
    method: "GET",
    path: "/api/v1/settings/evolution-qr/qr",
    auth: "session_jwt",
    descriptionEn: "Poll QR payload (admin).",
    descriptionPt: "Obter payload do QR (admin).",
    examplePayloadPt: "Sem corpo (polling do QR code).",
  },
  {
    method: "GET",
    path: "/api/v1/settings/evolution-qr/status",
    auth: "session_jwt",
    descriptionEn: "Connection status (admin).",
    descriptionPt: "Estado da ligação (admin).",
    examplePayloadPt: "Sem corpo.",
  },
  {
    method: "GET|POST|PUT|DELETE",
    path: "/api/v1/users",
    auth: "session_jwt",
    descriptionEn: "Users management.",
    descriptionPt: "Gestão de utilizadores.",
    examplePayloadPt:
      'GET: sem corpo.\n\nPOST application/json (admin):\n{\n  "email": "novo@exemplo.com",\n  "name": "Novo agente",\n  "password": "<minimo-8-caracteres>",\n  "role": "AGENT"\n}\n\nPUT /api/v1/users/:id — name, email, password ou role opcionais.',
  },
  {
    method: "GET|POST|PATCH|DELETE",
    path: "/api/v1/inboxes",
    auth: "session_jwt",
    descriptionEn: "Inboxes, members; admin to create/patch/delete.",
    descriptionPt: "Caixas e membros; admin para criar/editar.",
    examplePayloadPt:
      'GET: sem corpo.\n\nPOST application/json:\n{\n  "name": "Suporte WhatsApp",\n  "channelType": "WHATSAPP",\n  "channelConfig": null,\n  "isDefault": false\n}\n\nPOST /api/v1/inboxes/:id/members — {\"userId\": \"<uuid>\"}\n\nPATCH /api/v1/inboxes/:id — nome, channelConfig, etc.',
  },
  {
    method: "POST",
    path: "/api/v1/inboxes/:id/rotate-ingest-token",
    auth: "session_jwt",
    descriptionEn: "Rotate public ingest token for an inbox (admin).",
    descriptionPt: "Rodar token de ingestão público (admin).",
    examplePayloadPt: "Sem corpo. POST com id da caixa no path.",
  },
  {
    method: "GET|POST|PATCH|DELETE",
    path: "/api/v1/teams",
    auth: "session_jwt",
    descriptionEn: "Teams and memberships.",
    descriptionPt: "Equipas e membros.",
    examplePayloadPt:
      'POST application/json:\n{\n  "name": "Comercial",\n  "description": "Equipa de vendas (opcional)"\n}\n\nPOST /api/v1/teams/:id/members:\n{\n  "userId": "<uuid>",\n  "role": "MEMBER"\n}\n(role: TEAM_ADMIN | SUPERVISOR | MEMBER)\n\nPATCH /api/v1/teams/:id — campos parciais.',
  },
  {
    method: "GET",
    path: "/api/v1/bots",
    auth: "session_jwt",
    descriptionEn:
      "List all agent bots for the authenticated tenant organization. Requires user session JWT from POST /api/v1/auth/login (ADMIN or SUPER_ADMIN); do not use the Agent Bot Bearer ocb_ token here — use GET /api/v1/agent-bot/profile for that. The AGENT role receives 403. Ordered by most recently updated. Sensitive fields are never returned — use inboxTokenConfigured and webhookSecretConfigured.",
    descriptionPt:
      "Lista todos os bots da organização. Exige JWT de POST /api/v1/auth/login (ADMIN ou SUPER_ADMIN); não use Bearer ocb_ aqui — para isso use GET /api/v1/agent-bot/profile. O perfil AGENT recebe 403. Ordenado pelo mais recente. Sem segredos em claro — inboxTokenConfigured e webhookSecretConfigured.",
    examplePayloadPt:
      'Autenticação: JWT de utilizador (resposta `token` de POST /api/v1/auth/login), cabeçalho Authorization: Bearer <jwt>. Não use o token ocb_ do bot aqui — para validar o token do bot use GET /api/v1/agent-bot/profile.\n\nSem corpo.\n\nGET /api/v1/bots\n\nResposta 200 application/json:\n{\n  "data": [\n    {\n      "id": "<uuid>",\n      "organizationId": "<uuid>",\n      "name": "Bot FAQ",\n      "description": null,\n      "avatarUrl": null,\n      "type": "WEBHOOK",\n      "webhookUrl": "https://...",\n      "config": null,\n      "isActive": true,\n      "inboxTokenConfigured": true,\n      "webhookSecretConfigured": false,\n      "createdAt": "...",\n      "updatedAt": "...",\n      "_count": { "interactions": 0 }\n    }\n  ]\n}',
  },
  {
    method: "GET",
    path: "/api/v1/bots/:id",
    auth: "session_jwt",
    descriptionEn:
      "Fetch one bot by id scoped to the organization. Same JWT session auth as GET /api/v1/bots (not ocb_). Returns 404 if the id does not belong to this tenant.",
    descriptionPt:
      "Obter um bot pelo id no tenant. Mesmo JWT de sessão que GET /api/v1/bots (não use ocb_). 404 fora da organização.",
    examplePayloadPt:
      'Autenticação: JWT de POST /api/v1/auth/login (não use Bearer ocb_). Sem corpo.\n\nGET /api/v1/bots/<uuid-do-bot>\n\nResposta 200: um objeto bot (mesma forma que cada elemento de GET /api/v1/bots, sem segredos). 404 se não existir.',
  },
  {
    method: "POST|PATCH|DELETE",
    path: "/api/v1/bots",
    auth: "session_jwt",
    descriptionEn: "Create, update, or delete bots; inbox tokens and interactions (admin for most writes).",
    descriptionPt: "Criar, atualizar ou apagar bots; tokens de inbox e interações (admin na maior parte dos writes).",
    examplePayloadPt:
      'Autenticação nas operações acima: JWT de sessão (login ADMIN). O token ocb_ do bot não é aceite nestes paths — ver GET /api/v1/agent-bot/profile.\n\nPOST /api/v1/bots — application/json (admin):\n{\n  "name": "Bot FAQ",\n  "webhookUrl": "https://seu-servidor.com/agent-bot-webhook",\n  "type": "CUSTOM",\n  "isActive": true\n}\n\nResposta 201: objeto do bot com `id` (UUID único e estável por bot, estilo Chatwoot).\n\nPATCH /api/v1/bots/:id — campos parciais (admin).\n\nDELETE /api/v1/bots/:id — admin, 204.\n\nPOST /api/v1/bots/:id/inbox-token — gera token de inbox (admin).\n\nGET /api/v1/bots/:id/interactions — lista interações (admin).\n\nPOST /api/v1/bots/:id/interactions — registo de interação (admin):\n{\n  "direction": "INBOUND",\n  "payload": { "text": "..." },\n  "conversationId": "<uuid-opcional>"\n}',
  },
];
