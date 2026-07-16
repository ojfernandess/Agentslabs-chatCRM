/**
 * Catálogo estático de ferramentas (MCP / API / ElevenLabs) para Automação.
 * Instâncias por organização ficam em `automation_custom_tools` com `config.presetKey`.
 */

export type AutomationPresetCategory =
  | "MCP_NATIVE"
  | "GOOGLE_CALENDAR"
  | "ELEVENLABS"
  | "EMAIL_API"
  | "HTTP_CUSTOM"
  | "INTEGRATION_MARKETPLACE";

/** Categoria do cartão no marketplace (filtros da UI). */
export type AutomationMarketplaceCategory =
  | "EMAIL"
  | "MESSAGING"
  | "CRM"
  | "PAYMENTS"
  | "PRODUCTIVITY"
  | "LLM"
  | "DATA"
  | "AUTOMATION";

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
  /** Metadados opcionais para o hub / marketplace */
  marketplace?: {
    category: AutomationMarketplaceCategory;
    /** Nome do ícone Lucide (ex.: Mail) */
    icon: string;
    /** Ordenação “mais usadas” (maior = primeiro) */
    popularity: number;
    /** Cor de destaque (Tailwind) para gradiente do card */
    accent: string;
  };
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
    marketplace: { category: "EMAIL", icon: "Mail", popularity: 90, accent: "from-emerald-500/25 to-teal-600/10" },
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
    marketplace: { category: "EMAIL", icon: "Server", popularity: 78, accent: "from-slate-500/25 to-slate-600/10" },
  },
  {
    presetKey: "http_api_builder",
    category: "HTTP_CUSTOM",
    name: "HTTP / API (builder)",
    description:
      "Ferramenta HTTP genérica: base URL, método, path, headers, corpo e autenticação. O integrador ou o testador da consola executa o pedido.",
    toolType: "HTTP_API",
    parametersSchema: openAiObjectSchema({
      pathParams: { type: "object", description: "Substituições de path, ex.: { id: \"uuid\" }" },
      query: { type: "object" },
      headers: { type: "object" },
      body: { type: "object" },
    }),
    defaultConfig: {
      presetKey: "http_api_builder",
      executor: "http_client",
      baseUrl: "https://api.example.com",
      httpMethod: "GET",
      httpPath: "/",
      authType: "none",
      bearerToken: "",
      apiKeyHeader: "X-Api-Key",
      apiKeyValue: "",
      basicUser: "",
      basicPassword: "",
      customAuthHeader: "",
      customAuthValue: "",
      defaultHeaders: {},
      defaultQuery: {},
      bodyTemplate: {},
    },
    marketplace: { category: "AUTOMATION", icon: "Globe", popularity: 95, accent: "from-cyan-500/30 to-blue-600/10" },
  },
  {
    presetKey: "http_api_custom",
    category: "HTTP_CUSTOM",
    name: "HTTP API Customizada",
    description:
      "Consome um endpoint GET externo, mapeia contactos dinâmicos, aplica template WhatsApp e dispara campanha omnichannel com variáveis.",
    toolType: "HTTP_API_CUSTOM",
    parametersSchema: openAiObjectSchema({
      dryRun: { type: "boolean", description: "Apenas pré-visualizar sem criar campanha" },
    }),
    defaultConfig: {
      presetKey: "http_api_custom",
      executor: "http_custom_dispatch",
      baseUrl: "https://api.example.com",
      httpMethod: "GET",
      httpPath: "/contacts",
      authType: "none",
      bearerToken: "",
      apiKeyHeader: "X-Api-Key",
      apiKeyValue: "",
      basicUser: "",
      basicPassword: "",
      customAuthHeader: "",
      customAuthValue: "",
      defaultHeaders: {},
      defaultQuery: {},
      responseArrayPath: "",
      fieldMapping: {
        phone: "telefone",
        name: "nome",
        variables: [],
      },
      dispatch: {
        messageType: "TEXT",
        body: "Olá {{nome}}, sua fatura de {{valor}} vence em {{vencimento}}.",
        executionMode: "manual",
        autoCreateCampaign: true,
        autoStart: true,
        avoidDuplicates: true,
        campaignKind: "broadcast",
      },
      ui: { category: "Automação", icon: "Radio", accent: "from-rose-500/30 to-orange-600/10" },
    },
    marketplace: { category: "AUTOMATION", icon: "Radio", popularity: 92, accent: "from-rose-500/30 to-orange-600/10" },
  },
  {
    presetKey: "webhook_callback",
    category: "HTTP_CUSTOM",
    name: "Webhook (saída)",
    description: "Dispara um POST JSON para um URL configurável (útil com Pipedream, n8n, Make).",
    toolType: "WEBHOOK",
    parametersSchema: openAiObjectSchema({
      event: { type: "string" },
      payload: { type: "object" },
    }),
    defaultConfig: {
      presetKey: "webhook_callback",
      executor: "http_client",
      webhookUrl: "",
      httpMethod: "POST",
      signingSecret: "",
      authType: "none",
    },
    marketplace: { category: "AUTOMATION", icon: "Webhook", popularity: 88, accent: "from-violet-500/25 to-fuchsia-600/10" },
  },
  {
    presetKey: "int_twilio",
    category: "INTEGRATION_MARKETPLACE",
    name: "Twilio",
    description: "SMS, voz e canais Twilio. Configure Account SID, Auth Token e números.",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      to: { type: "string", description: "E.164" },
      body: { type: "string", description: "Texto SMS ou instrução" },
    }),
    defaultConfig: {
      presetKey: "int_twilio",
      provider: "twilio",
      accountSid: "",
      authToken: "",
      fromNumber: "",
      baseUrl: "https://api.twilio.com",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "MESSAGING", icon: "Phone", popularity: 85, accent: "from-red-500/20 to-rose-600/10" },
  },
  {
    presetKey: "int_evolution_api",
    category: "INTEGRATION_MARKETPLACE",
    name: "Evolution API",
    description:
      "Chamadas extra à API Evolution (ex.: envio programático). O canal WhatsApp da organização continua a ser configurado em Configurações — não duplique credenciais de canal aqui salvo necessidade de API auxiliar.",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      number: { type: "string" },
      text: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "int_evolution_api",
      provider: "evolution_api",
      apiBaseUrl: "",
      apiKey: "",
      instanceName: "",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "MESSAGING", icon: "Smartphone", popularity: 72, accent: "from-lime-500/20 to-green-700/10" },
  },
  {
    presetKey: "int_chatwoot",
    category: "INTEGRATION_MARKETPLACE",
    name: "Chatwoot",
    description: "API Chatwoot: conversas, contactos e mensagens.",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      action: { type: "string", description: "ex.: send_message, add_label" },
      payload: { type: "object" },
    }),
    defaultConfig: {
      presetKey: "int_chatwoot",
      provider: "chatwoot",
      baseUrl: "",
      accessToken: "",
      accountId: "",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "CRM", icon: "MessagesSquare", popularity: 80, accent: "from-indigo-500/25 to-blue-700/10" },
  },
  {
    presetKey: "int_stripe",
    category: "INTEGRATION_MARKETPLACE",
    name: "Stripe",
    description: "Pagamentos e billing Stripe (secret key restrita; preferir restricted keys).",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      action: { type: "string" },
      params: { type: "object" },
    }),
    defaultConfig: {
      presetKey: "int_stripe",
      provider: "stripe",
      secretKey: "",
      baseUrl: "https://api.stripe.com",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "PAYMENTS", icon: "CreditCard", popularity: 82, accent: "from-violet-500/30 to-purple-900/20" },
  },
  {
    presetKey: "int_google_sheets",
    category: "INTEGRATION_MARKETPLACE",
    name: "Google Sheets",
    description: "Leitura/escrita via Google Sheets API (OAuth ou service account JSON).",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      spreadsheetId: { type: "string" },
      range: { type: "string" },
      values: { type: "array", items: { type: "array" } },
    }),
    defaultConfig: {
      presetKey: "int_google_sheets",
      provider: "google_sheets",
      credentialsJson: "",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "PRODUCTIVITY", icon: "Table", popularity: 77, accent: "from-green-500/20 to-emerald-600/10" },
  },
  {
    presetKey: "int_slack",
    category: "INTEGRATION_MARKETPLACE",
    name: "Slack",
    description: "Slack Web API (Bot token).",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      channel: { type: "string" },
      text: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "int_slack",
      provider: "slack",
      botToken: "",
      baseUrl: "https://slack.com/api",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "PRODUCTIVITY", icon: "Hash", popularity: 84, accent: "from-purple-500/25 to-violet-800/10" },
  },
  {
    presetKey: "int_discord",
    category: "INTEGRATION_MARKETPLACE",
    name: "Discord",
    description: "Webhook ou Bot API Discord.",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      content: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "int_discord",
      provider: "discord",
      webhookUrl: "",
      botToken: "",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "MESSAGING", icon: "Gamepad2", popularity: 70, accent: "from-indigo-500/30 to-sky-700/10" },
  },
  {
    presetKey: "int_openai_api",
    category: "INTEGRATION_MARKETPLACE",
    name: "OpenAI API",
    description: "Chamadas diretas à API OpenAI (completions, embeddings) como ferramenta.",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      model: { type: "string" },
      input: { type: "string" },
    }),
    defaultConfig: {
      presetKey: "int_openai_api",
      provider: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "LLM", icon: "Sparkles", popularity: 92, accent: "from-teal-500/25 to-cyan-700/10" },
  },
  {
    presetKey: "int_anthropic_api",
    category: "INTEGRATION_MARKETPLACE",
    name: "Anthropic",
    description: "API Claude (Anthropic).",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      model: { type: "string" },
      max_tokens: { type: "number" },
      messages: { type: "array" },
    }),
    defaultConfig: {
      presetKey: "int_anthropic_api",
      provider: "anthropic",
      apiKey: "",
      baseUrl: "https://api.anthropic.com",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "LLM", icon: "Brain", popularity: 88, accent: "from-orange-500/25 to-amber-700/10" },
  },
  {
    presetKey: "int_groq_api",
    category: "INTEGRATION_MARKETPLACE",
    name: "Groq",
    description: "Inferência rápida via Groq Cloud API.",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      model: { type: "string" },
      messages: { type: "array" },
    }),
    defaultConfig: {
      presetKey: "int_groq_api",
      provider: "groq",
      apiKey: "",
      baseUrl: "https://api.groq.com/openai/v1",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "LLM", icon: "Zap", popularity: 75, accent: "from-yellow-500/20 to-orange-600/10" },
  },
  {
    presetKey: "int_postgres",
    category: "INTEGRATION_MARKETPLACE",
    name: "PostgreSQL",
    description: "Consultas parametrizadas (executadas pelo integrador; não exponha credenciais ao modelo).",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      sql: { type: "string" },
      params: { type: "array" },
    }),
    defaultConfig: {
      presetKey: "int_postgres",
      provider: "postgres",
      connectionString: "",
      readOnly: true,
      executor: "openconduit_webhook",
    },
    marketplace: { category: "DATA", icon: "Database", popularity: 68, accent: "from-blue-500/25 to-slate-700/10" },
  },
  {
    presetKey: "int_mysql",
    category: "INTEGRATION_MARKETPLACE",
    name: "MySQL",
    description: "Consultas MySQL/MariaDB via integrador.",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      sql: { type: "string" },
      params: { type: "array" },
    }),
    defaultConfig: {
      presetKey: "int_mysql",
      provider: "mysql",
      connectionString: "",
      readOnly: true,
      executor: "openconduit_webhook",
    },
    marketplace: { category: "DATA", icon: "Server", popularity: 62, accent: "from-orange-500/20 to-amber-900/10" },
  },
  {
    presetKey: "int_redis",
    category: "INTEGRATION_MARKETPLACE",
    name: "Redis",
    description: "Cache e filas Redis (comandos limitados pelo integrador).",
    toolType: "INTEGRATION",
    parametersSchema: openAiObjectSchema({
      command: { type: "string" },
      args: { type: "array" },
    }),
    defaultConfig: {
      presetKey: "int_redis",
      provider: "redis",
      url: "",
      executor: "openconduit_webhook",
    },
    marketplace: { category: "DATA", icon: "HardDrive", popularity: 58, accent: "from-red-500/20 to-rose-900/10" },
  },
];

const PRESET_MAP = new Map(AUTOMATION_TOOL_PRESETS.map((p) => [p.presetKey, p]));

export function getPresetByKey(key: string): AutomationToolPresetDefinition | undefined {
  return PRESET_MAP.get(key);
}
