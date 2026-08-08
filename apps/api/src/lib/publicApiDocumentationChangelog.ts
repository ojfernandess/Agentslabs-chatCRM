export type PublicApiDocChangelogEntry = {
  date: string;
  schemaVersion: number;
  titlePt: string;
  changesPt: string[];
  breaking: boolean;
};

export const PUBLIC_API_DOCUMENTATION_CHANGELOG: PublicApiDocChangelogEntry[] = [
  {
    date: "2026-08-08",
    schemaVersion: 14,
    titlePt: "Send Message e Send Template na documentação",
    changesPt: [
      "POST /api/v1/messages documentado em duas entradas: Send Message (texto WhatsApp) e Send Template (modelo Business)",
      "Exemplos curl, regras da janela 24h e mapeamento templateBodyParameters → components da Meta Cloud API",
      "Paridade Agent Bot: Send Message / Send Template em POST /api/v1/agent-bot/messages",
      "GET /api/v1/templates com nota para obter templateId",
    ],
    breaking: false,
  },
  {
    date: "2026-07-31",
    schemaVersion: 13,
    titlePt: "Guia n8n — bot externo e call_human",
    changesPt: [
      "Nova secção «Integração n8n» na documentação pública: fluxo webhook → handoff, diagrama de sequência, Opção A (ocb_) vs Opção B (automations)",
      "Exemplos prontos para nós HTTP Request no n8n, teamId opcional e detecção automática de organização pelo token",
    ],
    breaking: false,
  },
  {
    date: "2026-07-31",
    schemaVersion: 12,
    titlePt: "Agent Bot — call_human para bots externos",
    changesPt: [
      "POST /api/v1/agent-bot/conversations/:id/call-human — handoff humano com token ocb_ (paridade com automations/call-human)",
      "Documentação Agent Bot HTTP API e ferramentas nativas actualizadas",
    ],
    breaking: false,
  },
  {
    date: "2026-07-31",
    schemaVersion: 11,
    titlePt: "Ferramentas nativas do agente — equivalentes HTTP",
    changesPt: [
      "Nova secção «Ferramentas nativas do agente»: buscar_conhecimento → POST /api/v1/automation/knowledge-articles/search",
      "transfer_to_team → POST /api/v1/automations/conversations/:id/transfer-team",
      "call_human → POST /api/v1/automations/conversations/:id/call-human",
      "GET /api/v1/automations/teams documentado como auxiliar de roteamento (UUID de equipa)",
    ],
    breaking: false,
  },
  {
    date: "2026-07-10",
    schemaVersion: 10,
    titlePt: "Documentação v10 — respostas, convenções e modelos",
    changesPt: [
      "Exportação Postman Collection v2.1 em GET /api/v1/public/system-documentation/postman",
      "Exemplos de resposta de sucesso e tabela de erros HTTP por rota",
      "Secção «Convenções gerais» (erros, paginação, filtros, rate limit, versionamento)",
      "Secção «Modelos de dados» com enums extraídos do schema Prisma",
      "Tabela de autenticação, âncoras por endpoint e pesquisa na navegação",
      "Guia de workspace de e-mail e blocos de código sem truncamento horizontal",
    ],
    breaking: false,
  },
  {
    date: "2026-07-09",
    schemaVersion: 9,
    titlePt: "Workspace de e-mail",
    changesPt: [
      "Novos endpoints: pastas personalizadas, favoritos, compose-email, sync-email",
      "Filtros GET /conversations: trash, starred, emailFolderId, q",
      "GET /contacts?hasEmail=1 para autocomplete no compose",
      "Dashboard exclui e-mails com emailHideFromConversations",
    ],
    breaking: false,
  },
  {
    date: "2026-07-08",
    schemaVersion: 8,
    titlePt: "Rebranding OpenNexo CRM na documentação pública",
    changesPt: [
      "Remoção de referências «OpenConduit» nos textos da doc pública",
      "Token de perfil ocu_ documentado nas rotas de automação",
    ],
    breaking: false,
  },
];
