/**
 * Modelos de dados principais — campos extraídos de apps/api/prisma/schema.prisma.
 */

export type PublicApiDocSchemaField = {
  name: string;
  type: string;
  required: boolean;
  enumValues?: string[];
  descriptionPt: string;
};

export type PublicApiDocResourceSchema = {
  id: string;
  namePt: string;
  descriptionPt: string;
  fields: PublicApiDocSchemaField[];
};

export const PUBLIC_API_DOCUMENTATION_SCHEMAS: PublicApiDocResourceSchema[] = [
  {
    id: "user",
    namePt: "User",
    descriptionPt: "Utilizador do tenant ou super admin da plataforma.",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador único" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome completo" },
      { name: "displayName", type: "string | null", required: false, descriptionPt: "Apelido no chat" },
      { name: "email", type: "string", required: true, descriptionPt: "Email único global" },
      {
        name: "role",
        type: "enum",
        required: true,
        enumValues: ["SUPER_ADMIN", "ADMIN", "AGENT"],
        descriptionPt: "Papel de acesso",
      },
      { name: "organizationId", type: "uuid | null", required: false, descriptionPt: "Tenant (null para SUPER_ADMIN sem org)" },
      { name: "avatarUrl", type: "string | null", required: false, descriptionPt: "URL da foto de perfil" },
      { name: "messageSignature", type: "string | null", required: false, descriptionPt: "Assinatura nas mensagens" },
      { name: "showAgentNameInChat", type: "boolean", required: false, descriptionPt: "Mostrar nome do agente no chat" },
      { name: "createdAt", type: "datetime (ISO)", required: true, descriptionPt: "Data de criação" },
    ],
  },
  {
    id: "contact",
    namePt: "Contact",
    descriptionPt: "Contacto/cliente da organização.",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador único" },
      { name: "phone", type: "string", required: true, descriptionPt: "Telefone E.164 (único por org)" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome de exibição" },
      { name: "email", type: "string | null", required: false, descriptionPt: "Email principal" },
      { name: "notes", type: "string | null", required: false, descriptionPt: "Notas internas" },
      { name: "optedIn", type: "boolean", required: false, descriptionPt: "Consentimento de contacto" },
      { name: "lifecycleStage", type: "string | null", required: false, descriptionPt: "Etapa de ciclo de vida" },
      { name: "pipelineStageId", type: "uuid | null", required: false, descriptionPt: "Etapa legada do pipeline" },
      { name: "assignedToId", type: "uuid | null", required: false, descriptionPt: "Agente responsável" },
      { name: "accountId", type: "uuid | null", required: false, descriptionPt: "Conta CRM associada" },
      { name: "organizationId", type: "uuid", required: true, descriptionPt: "Tenant" },
      { name: "createdAt", type: "datetime", required: true, descriptionPt: "Criação" },
      { name: "updatedAt", type: "datetime", required: true, descriptionPt: "Última atualização" },
    ],
  },
  {
    id: "conversation",
    namePt: "Conversation",
    descriptionPt: "Thread de atendimento (ticket) ligada a contacto e caixa.",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador único" },
      {
        name: "status",
        type: "enum",
        required: true,
        enumValues: ["OPEN", "PENDING", "RESOLVED"],
        descriptionPt: "Estado do atendimento",
      },
      {
        name: "priority",
        type: "enum | null",
        required: false,
        enumValues: ["LOW", "MEDIUM", "HIGH", "URGENT"],
        descriptionPt: "Prioridade",
      },
      { name: "inboxId", type: "uuid", required: true, descriptionPt: "Caixa de entrada" },
      { name: "contactId", type: "uuid", required: true, descriptionPt: "Contacto" },
      { name: "assignedToId", type: "uuid | null", required: false, descriptionPt: "Agente atribuído" },
      { name: "teamId", type: "uuid | null", required: false, descriptionPt: "Equipa" },
      { name: "leadTypeId", type: "uuid | null", required: false, descriptionPt: "Coluna do funil CRM" },
      { name: "closureReason", type: "string | null", required: false, descriptionPt: "Motivo de encerramento" },
      { name: "closureValue", type: "number | null", required: false, descriptionPt: "Valor comercial no encerramento" },
      { name: "deletedAt", type: "datetime | null", required: false, descriptionPt: "Soft-delete (lixeira e-mail)" },
      { name: "isUnread", type: "boolean", required: false, descriptionPt: "Não lida para o utilizador (resposta API)" },
      { name: "isStarred", type: "boolean", required: false, descriptionPt: "Favorito e-mail (por utilizador)" },
      { name: "emailFolderId", type: "uuid | null", required: false, descriptionPt: "Pasta personalizada e-mail" },
      { name: "createdAt", type: "datetime", required: true, descriptionPt: "Abertura" },
      { name: "updatedAt", type: "datetime", required: true, descriptionPt: "Última atividade" },
    ],
  },
  {
    id: "inbox",
    namePt: "Inbox",
    descriptionPt: "Caixa de entrada multicanal (estilo Chatwoot).",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "UUID estável da caixa" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome visível" },
      { name: "description", type: "string | null", required: false, descriptionPt: "Descrição" },
      {
        name: "channelType",
        type: "enum",
        required: true,
        enumValues: ["WEBSITE", "FACEBOOK", "WHATSAPP", "SMS", "EMAIL", "API", "TELEGRAM", "LINE", "INSTAGRAM", "VOICE"],
        descriptionPt: "Tipo de canal",
      },
      { name: "channelConfig", type: "object | null", required: false, descriptionPt: "Config SMTP/IMAP, WhatsApp, etc." },
      { name: "isDefault", type: "boolean", required: false, descriptionPt: "Caixa predefinida" },
      { name: "agentBotId", type: "uuid | null", required: false, descriptionPt: "Bot de triagem desta caixa" },
      { name: "autoAssignEnabled", type: "boolean", required: false, descriptionPt: "Atribuição automática a membros" },
      { name: "ingestToken", type: "string | null", required: false, descriptionPt: "Token de webhook (só admin na API)" },
    ],
  },
  {
    id: "bot",
    namePt: "Bot",
    descriptionPt: "Agent bot / webhook de automação.",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador do bot" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome" },
      { name: "description", type: "string | null", required: false, descriptionPt: "Descrição" },
      {
        name: "type",
        type: "enum",
        required: true,
        enumValues: ["WEBHOOK", "DIALOGFLOW", "CUSTOM"],
        descriptionPt: "Tipo de integração",
      },
      { name: "webhookUrl", type: "string | null", required: false, descriptionPt: "URL de eventos recebidos" },
      { name: "isActive", type: "boolean", required: true, descriptionPt: "Bot activo" },
      { name: "inboxTokenConfigured", type: "boolean", required: false, descriptionPt: "ocb_ gerado (resposta API)" },
      { name: "webhookSecretConfigured", type: "boolean", required: false, descriptionPt: "Segredo HMAC configurado" },
      { name: "organizationId", type: "uuid", required: true, descriptionPt: "Tenant" },
    ],
  },
  {
    id: "tag",
    namePt: "Tag",
    descriptionPt: "Etiqueta de contacto/conversa.",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome (único por org)" },
      { name: "color", type: "string", required: true, descriptionPt: "Cor #RRGGBB" },
      { name: "organizationId", type: "uuid", required: true, descriptionPt: "Tenant" },
    ],
  },
  {
    id: "lead_type",
    namePt: "LeadType",
    descriptionPt: "Coluna do funil CRM (kanban).",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome da coluna" },
      { name: "color", type: "string | null", required: false, descriptionPt: "Cor opcional" },
      { name: "order", type: "integer", required: true, descriptionPt: "Ordem no quadro" },
      { name: "valueRollup", type: "boolean", required: false, descriptionPt: "Somar valores de deals" },
    ],
  },
  {
    id: "pipeline_stage",
    namePt: "PipelineStage",
    descriptionPt: "Etapa legada do pipeline (contactos).",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome da etapa" },
      { name: "order", type: "integer", required: true, descriptionPt: "Ordem" },
      { name: "pipelineId", type: "uuid", required: true, descriptionPt: "Pipeline pai" },
    ],
  },
  {
    id: "deal",
    namePt: "Deal",
    descriptionPt: "Negócio/oportunidade CRM.",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador" },
      { name: "title", type: "string", required: true, descriptionPt: "Título do negócio" },
      {
        name: "status",
        type: "enum",
        required: true,
        enumValues: ["OPEN", "WON", "LOST"],
        descriptionPt: "Estado",
      },
      { name: "value", type: "number | null", required: false, descriptionPt: "Valor monetário" },
      { name: "primaryContactId", type: "uuid | null", required: false, descriptionPt: "Contacto principal" },
      { name: "ownerId", type: "uuid | null", required: false, descriptionPt: "Responsável" },
      { name: "leadTypeId", type: "uuid | null", required: false, descriptionPt: "Coluna do funil" },
    ],
  },
  {
    id: "message",
    namePt: "Message",
    descriptionPt: "Mensagem numa conversa.",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador" },
      {
        name: "type",
        type: "enum",
        required: true,
        enumValues: ["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "TEMPLATE"],
        descriptionPt: "Tipo de conteúdo",
      },
      {
        name: "direction",
        type: "enum",
        required: true,
        enumValues: ["INBOUND", "OUTBOUND"],
        descriptionPt: "Entrada ou saída",
      },
      {
        name: "status",
        type: "enum",
        required: false,
        enumValues: ["SENT", "DELIVERED", "READ", "FAILED"],
        descriptionPt: "Estado de entrega",
      },
      { name: "body", type: "string | null", required: false, descriptionPt: "Texto" },
      { name: "isPrivate", type: "boolean", required: false, descriptionPt: "Nota interna" },
      { name: "conversationId", type: "uuid", required: true, descriptionPt: "Conversa" },
      { name: "contactId", type: "uuid", required: true, descriptionPt: "Contacto" },
    ],
  },
  {
    id: "broadcast",
    namePt: "Broadcast",
    descriptionPt: "Campanha de envio em massa (BroadcastCampaign).",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome da campanha" },
      {
        name: "status",
        type: "enum",
        required: true,
        enumValues: ["DRAFT", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
        descriptionPt: "Estado da campanha",
      },
      {
        name: "channel",
        type: "enum",
        required: true,
        enumValues: ["WHATSAPP", "EMAIL", "SMS", "TELEGRAM", "INSTAGRAM", "MESSENGER", "PUSH", "WEBHOOK", "VOICE"],
        descriptionPt: "Canal de envio",
      },
      {
        name: "scheduleType",
        type: "enum",
        required: false,
        enumValues: ["IMMEDIATE", "SCHEDULED", "RECURRING", "EVENT"],
        descriptionPt: "Tipo de agendamento",
      },
      { name: "inboxId", type: "uuid | null", required: false, descriptionPt: "Caixa de origem" },
      { name: "templateId", type: "uuid | null", required: false, descriptionPt: "Modelo WhatsApp" },
    ],
  },
  {
    id: "template",
    namePt: "Template",
    descriptionPt: "Modelo de mensagem WhatsApp aprovado (WhatsAppTemplate).",
    fields: [
      { name: "id", type: "uuid", required: true, descriptionPt: "Identificador interno" },
      { name: "name", type: "string", required: true, descriptionPt: "Nome do modelo" },
      { name: "language", type: "string", required: true, descriptionPt: "Código de idioma (ex. pt_BR)" },
      { name: "category", type: "string", required: false, descriptionPt: "Categoria Meta" },
      { name: "status", type: "string", required: false, descriptionPt: "Estado de aprovação Meta" },
      { name: "body", type: "string", required: false, descriptionPt: "Corpo do modelo" },
    ],
  },
];
