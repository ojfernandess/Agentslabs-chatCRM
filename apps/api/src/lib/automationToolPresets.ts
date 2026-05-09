/**
 * Catálogo estático de ferramentas (MCP / API / ElevenLabs) para Automação.
 * Instâncias por organização ficam em `automation_custom_tools` com `config.presetKey`.
 */

export type AutomationPresetCategory =
  | "MCP_NATIVE"
  | "GOOGLE_CALENDAR"
  | "ELEVENLABS"
  | "EMAIL_API"
  | "HTTP_CUSTOM";

export interface AutomationToolPresetDefinition {
  presetKey: string;
  category: AutomationPresetCategory;
  name: string;
  description: string;
  toolType: string;
  /** JSON schema estilo OpenAI function parameters */
  parametersSchema: Record<string, unknown>;
  /** Valores por defeito; credenciais preenchidas na UI */
  defaultConfig: Record<string, unknown>;
}

const openAiObjectSchema = (properties: Record<string, unknown>, required?: string[]): Record<string, unknown> => ({
  type: "object",
  properties,
  ...(required?.length ? { required } : {}),
});

export const AUTOMATION_TOOL_PRESETS: AutomationToolPresetDefinition[] = [
  {
    presetKey: "mcp_list_teams",
    category: "MCP_NATIVE",
    name: "listar_equipas",
    description:
      "Lista equipas da organização. HTTP: GET /api/v1/agent-bot/teams (Bearer ocb_… do bot).",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({}),
    defaultConfig: {
      presetKey: "mcp_list_teams",
      nativeToolKey: "list_teams",
      executor: "openconduit_agent_bot",
      httpMethod: "GET",
      httpPath: "/api/v1/agent-bot/teams",
    },
  },
  {
    presetKey: "mcp_list_pipeline_stages",
    category: "MCP_NATIVE",
    name: "listar_etapas_funil",
    description:
      "Lista colunas do funil CRM (lead types). HTTP: GET /api/v1/agent-bot/lead-types (Bearer ocb_…).",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({}),
    defaultConfig: {
      presetKey: "mcp_list_pipeline_stages",
      nativeToolKey: "list_pipeline_stages",
      executor: "openconduit_agent_bot",
      httpMethod: "GET",
      httpPath: "/api/v1/agent-bot/lead-types",
    },
  },
  {
    presetKey: "mcp_assign_conversation_team",
    category: "MCP_NATIVE",
    name: "atribuir_equipa_conversa",
    description:
      "Atribui equipa (e opcionalmente agente) a uma conversa. HTTP: PATCH /api/v1/agent-bot/conversations/{conversationId}/team com JSON { teamId, assignedToId? }.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema(
      {
        conversationId: { type: "string", description: "UUID da conversa" },
        teamId: { type: "string", description: "UUID da equipa ou null para limpar" },
        assignedToId: { type: "string", description: "UUID do utilizador (opcional); deve pertencer à equipa" },
      },
      ["conversationId"],
    ),
    defaultConfig: {
      presetKey: "mcp_assign_conversation_team",
      nativeToolKey: "assign_team_to_conversation",
      executor: "openconduit_agent_bot",
      httpMethod: "PATCH",
      httpPathTemplate: "/api/v1/agent-bot/conversations/{conversationId}/team",
    },
  },
  {
    presetKey: "mcp_set_conversation_status",
    category: "MCP_NATIVE",
    name: "definir_estado_conversa",
    description:
      "Define estado da conversa (OPEN = handoff humano, PENDING = fila do bot). HTTP: PATCH /api/v1/agent-bot/conversations/{conversationId} com { status }.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema(
      {
        conversationId: { type: "string" },
        status: { type: "string", enum: ["OPEN", "PENDING"], description: "OPEN ou PENDING" },
      },
      ["conversationId", "status"],
    ),
    defaultConfig: {
      presetKey: "mcp_set_conversation_status",
      nativeToolKey: "set_conversation_status",
      executor: "openconduit_agent_bot",
      httpMethod: "PATCH",
      httpPathTemplate: "/api/v1/agent-bot/conversations/{conversationId}",
    },
  },
  {
    presetKey: "mcp_knowledge_search",
    category: "MCP_NATIVE",
    name: "buscar_conhecimento",
    description: "Pesquisa na base de conhecimento da organização.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      query: { type: "string", description: "Texto da pesquisa" },
    }),
    defaultConfig: {
      presetKey: "mcp_knowledge_search",
      nativeToolKey: "knowledge_search",
      executor: "openconduit_kb",
    },
  },
  {
    presetKey: "google_calendar_oauth",
    category: "GOOGLE_CALENDAR",
    name: "agendar_google",
    description:
      "Google Calendar API: OAuth 2.0 (offline refresh_token), calendar_id, disponibilidade e agendas ligadas. Integrador: trocar refresh_token por access_token e chamar calendar.events.insert (ver documentação Google Calendar API).",
    toolType: "GOOGLE_CALENDAR",
    parametersSchema: openAiObjectSchema(
      {
        title: { type: "string", description: "Título do evento" },
        start: { type: "string", description: "Início em ISO 8601 (timezone explícito recomendado)" },
        end: { type: "string", description: "Fim em ISO 8601" },
        calendar_name: {
          type: "string",
          description: "Nome amigável da agenda (ver connectedCalendars); omite para calendar_id principal",
        },
        description: { type: "string", description: "Descrição / notas do evento" },
      },
      ["title", "start", "end"],
    ),
    defaultConfig: {
      presetKey: "google_calendar_oauth",
      nativeToolKey: "scheduling_google",
      executor: "google_calendar_api",
      auth_mode: "oauth",
      client_id: "",
      client_secret: "",
      refresh_token: "",
      calendar_id: "primary",
      availability: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
      connectedCalendars: [{ id: "primary", name: "Principal" }],
    },
  },
  {
    presetKey: "mcp_consultar_agendas",
    category: "MCP_NATIVE",
    name: "consultar_agendas",
    description:
      "Lista ou filtra agendas configuradas (connectedCalendars da ferramenta Google Calendar). O integrador implementa no webhook usando o mesmo OAuth.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      calendar_name: { type: "string", description: "Filtrar por nome exibido (opcional)" },
    }),
    defaultConfig: {
      presetKey: "mcp_consultar_agendas",
      nativeToolKey: "list_google_calendars",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "mcp_scheduling_outlook",
    category: "MCP_NATIVE",
    name: "agendar_outlook",
    description: "Agendamento via Microsoft Outlook / Graph (integrador deve executar).",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      title: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "mcp_scheduling_outlook",
      nativeToolKey: "scheduling_outlook",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "mcp_call_human",
    category: "MCP_NATIVE",
    name: "call_human",
    description: "Pedir transferência para atendente humano.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      reason: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "mcp_call_human",
      nativeToolKey: "call_human",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "mcp_end_conversation",
    category: "MCP_NATIVE",
    name: "end_conversation",
    description: "Encerrar conversa de forma explícita.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      summary: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "mcp_end_conversation",
      nativeToolKey: "end_conversation",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "mcp_ping",
    category: "MCP_NATIVE",
    name: "ping",
    description: "Verificação de vida / latência do fluxo.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({}),
    defaultConfig: {
      presetKey: "mcp_ping",
      nativeToolKey: "ping",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "elevenlabs_tts",
    category: "ELEVENLABS",
    name: "ElevenLabs TTS",
    description: "Text-to-speech ElevenLabs para respostas em áudio do agente.",
    toolType: "ELEVENLABS",
    parametersSchema: openAiObjectSchema({
      text: { type: "string", description: "Texto a sintetizar" },
      voiceId: { type: "string", description: "ID da voz ElevenLabs" },
    }),
    defaultConfig: {
      presetKey: "elevenlabs_tts",
      apiKey: "",
      /** Base URL; síntese: POST {apiBaseUrl}/text-to-speech/{voiceId} com header xi-api-key */
      apiBaseUrl: "https://api.elevenlabs.io/v1",
      voiceId: "",
      modelId: "eleven_multilingual_v2",
    },
  },
  {
    presetKey: "email_resend",
    category: "EMAIL_API",
    name: "Resend",
    description: "Envio de e-mail via API Resend.",
    toolType: "EMAIL_API",
    parametersSchema: openAiObjectSchema({
      to: { type: "string" },
      subject: { type: "string" },
      html: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "email_resend",
      provider: "resend",
      apiKey: "",
      fromEmail: "",
      baseUrl: "https://api.resend.com",
    },
  },
  {
    presetKey: "email_gmail",
    category: "EMAIL_API",
    name: "Gmail (API)",
    description: "Envio via Gmail API (OAuth / token de aplicação).",
    toolType: "EMAIL_API",
    parametersSchema: openAiObjectSchema({
      to: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "email_gmail",
      provider: "gmail",
      accessToken: "",
      refreshToken: "",
      fromEmail: "",
    },
  },
  {
    presetKey: "email_sendgrid",
    category: "EMAIL_API",
    name: "SendGrid",
    description: "Envio via SendGrid v3 API.",
    toolType: "EMAIL_API",
    parametersSchema: openAiObjectSchema({
      to: { type: "string" },
      subject: { type: "string" },
      html: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "email_sendgrid",
      provider: "sendgrid",
      apiKey: "",
      fromEmail: "",
      baseUrl: "https://api.sendgrid.com/v3",
    },
  },
  {
    presetKey: "email_mailgun",
    category: "EMAIL_API",
    name: "Mailgun",
    description: "Envio via Mailgun API.",
    toolType: "EMAIL_API",
    parametersSchema: openAiObjectSchema({
      to: { type: "string" },
      subject: { type: "string" },
      text: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "email_mailgun",
      provider: "mailgun",
      apiKey: "",
      domain: "",
      baseUrl: "",
    },
  },
  {
    presetKey: "email_smtp",
    category: "EMAIL_API",
    name: "SMTP",
    description: "Envio via servidor SMTP genérico.",
    toolType: "EMAIL_API",
    parametersSchema: openAiObjectSchema({
      to: { type: "string" },
      subject: { type: "string" },
      text: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "email_smtp",
      provider: "smtp",
      host: "",
      port: 587,
      username: "",
      password: "",
      fromEmail: "",
      secure: false,
    },
  },
];

const PRESET_MAP = new Map(AUTOMATION_TOOL_PRESETS.map((p) => [p.presetKey, p]));

export function getPresetByKey(key: string): AutomationToolPresetDefinition | undefined {
  return PRESET_MAP.get(key);
}
