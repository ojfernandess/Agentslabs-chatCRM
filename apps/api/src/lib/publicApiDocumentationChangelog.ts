export type PublicApiDocChangelogEntry = {
  date: string;
  schemaVersion: number;
  titlePt: string;
  changesPt: string[];
  breaking: boolean;
};

export const PUBLIC_API_DOCUMENTATION_CHANGELOG: PublicApiDocChangelogEntry[] = [
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
