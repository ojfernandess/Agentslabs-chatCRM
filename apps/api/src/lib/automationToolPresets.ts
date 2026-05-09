/**
 * Catálogo estático de ferramentas (MCP / API / ElevenLabs) para Automação.
 * Instâncias por organização ficam em `automation_custom_tools` com `config.presetKey`.
 */

export type AutomationPresetCategory = "MCP_NATIVE" | "ELEVENLABS" | "EMAIL_API" | "HTTP_CUSTOM";

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
    presetKey: "mcp_list_hotels",
    category: "MCP_NATIVE",
    name: "listar_hotéis",
    description: "Lista estabelecimentos/hotéis disponíveis para o contexto do agente.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      query: { type: "string", description: "Filtro opcional por nome ou localização" },
      limit: { type: "integer", description: "Máximo de resultados", default: 10 },
    }),
    defaultConfig: {
      presetKey: "mcp_list_hotels",
      nativeToolKey: "list_hotels",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "mcp_hotel_info",
    category: "MCP_NATIVE",
    name: "info_hotel",
    description: "Obtém detalhes de um estabelecimento/hotel por id ou nome.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema(
      {
        establishmentId: { type: "string", description: "ID do estabelecimento" },
        name: { type: "string", description: "Nome se o id for desconhecido" },
      },
      [],
    ),
    defaultConfig: {
      presetKey: "mcp_hotel_info",
      nativeToolKey: "get_hotel_info",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "mcp_list_entities",
    category: "MCP_NATIVE",
    name: "listar_entidades",
    description: "Lista entidades genéricas (CRM / cadastro).",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      entityType: { type: "string", description: "Tipo lógico de entidade" },
      limit: { type: "integer", default: 20 },
    }),
    defaultConfig: {
      presetKey: "mcp_list_entities",
      nativeToolKey: "list_entities",
      executor: "openconduit_webhook",
    },
  },
  {
    presetKey: "mcp_entity_info",
    category: "MCP_NATIVE",
    name: "obter_informações",
    description: "Obtém informação detalhada de uma entidade.",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      entityId: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "mcp_entity_info",
      nativeToolKey: "get_entity_info",
      executor: "openconduit_webhook",
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
    presetKey: "mcp_scheduling_google",
    category: "MCP_NATIVE",
    name: "agendar_google",
    description: "Agendamento via Google Calendar (integrador deve executar).",
    toolType: "MCP",
    parametersSchema: openAiObjectSchema({
      title: { type: "string" },
      start: { type: "string", description: "ISO 8601" },
      end: { type: "string", description: "ISO 8601" },
    }),
    defaultConfig: {
      presetKey: "mcp_scheduling_google",
      nativeToolKey: "scheduling_google",
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
