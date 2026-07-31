import type { PublicApiDocEndpoint } from "./publicApiDocumentationCatalog.js";

/**
 * Equivalentes HTTP das ferramentas nativas do agente LLM
 * (`buscar_conhecimento`, `transfer_to_team`, `call_human`).
 */
export const PUBLIC_AGENT_NATIVE_TOOLS_API_DOCUMENTATION_ENDPOINTS: PublicApiDocEndpoint[] = [
  {
    method: "POST",
    path: "/api/v1/automation/knowledge-articles/search",
    auth: "session_jwt",
    descriptionEn:
      "HTTP equivalent of the native agent tool `buscar_conhecimento` — ranked knowledge-base search (lexical and/or semantic). Requires ADMIN in tenant. Optional `botId` scopes linked articles when the ranked set is empty.",
    descriptionPt:
      "Equivalente HTTP da ferramenta nativa `buscar_conhecimento` — pesquisa ranqueada na base de conhecimento (lexical e/ou semântica). Requer ADMIN no tenant. `botId` opcional restringe artigos ligados ao bot quando o ranking inicial vem vazio.",
    examplePayloadPt:
      'POST application/json (Authorization: Bearer <jwt-admin>):\n{\n  "query": "horário de funcionamento da loja",\n  "botId": "<uuid-bot-opcional>"\n}\n\nResposta inclui `data` (artigos), `ranking` (score + excerpt) e `searchMode` (lexical | semantic | cached).',
  },
  {
    method: "GET",
    path: "/api/v1/automations/teams",
    auth: "session_jwt_or_api_access_token",
    descriptionEn:
      "Helper for `transfer_to_team` / `call_human` — list organization teams and UUIDs. Same response as documented under Tenant API automations.",
    descriptionPt:
      "Auxiliar para `transfer_to_team` / `call_human` — listar equipas da organização com UUID. Mesma resposta documentada na API do tenant (automations).",
    examplePayloadPt:
      "Sem corpo. Autenticação: Authorization: Bearer <jwt> OU header api_access_token: ocu_... (admin no tenant).\n\nResposta 200: { \"data\": [ { \"id\": \"<uuid>\", \"name\": \"Suporte\", \"description\": null, \"_count\": { \"members\": 4 } } ] }",
  },
  {
    method: "POST",
    path: "/api/v1/automations/conversations/:id/transfer-team",
    auth: "session_jwt_or_api_access_token",
    descriptionEn:
      "HTTP equivalent of the native agent tool `transfer_to_team` — assigns the conversation to a team, sets status OPEN, clears assignee, and records an internal handoff note (same side effects as the LLM tool).",
    descriptionPt:
      "Equivalente HTTP da ferramenta nativa `transfer_to_team` — atribui a conversa a uma equipa, define estado OPEN, limpa atendente e regista nota interna de handoff (mesmos efeitos da ferramenta LLM).",
    examplePayloadPt:
      'Autenticação: Authorization: Bearer <jwt> OU header api_access_token: ocu_... (admin no tenant).\n\nPOST application/json:\n{\n  "teamId": "<uuid-equipa>",\n  "reason": "Cliente pediu falar com vendas (opcional)"\n}\n\nObtenha `teamId` em GET /api/v1/automations/teams.',
  },
  {
    method: "POST",
    path: "/api/v1/automations/conversations/:id/call-human",
    auth: "session_jwt_or_api_access_token",
    descriptionEn:
      "HTTP equivalent of the native agent tool `call_human` — opens the conversation for human agents (status OPEN, clears assignee), optionally routes to a team, and records an internal handoff note.",
    descriptionPt:
      "Equivalente HTTP da ferramenta nativa `call_human` — abre a conversa para atendentes humanos (estado OPEN, limpa atendente), opcionalmente encaminha para uma equipa e regista nota interna de handoff.",
    examplePayloadPt:
      'Autenticação: Authorization: Bearer <jwt> OU header api_access_token: ocu_... (admin no tenant).\n\nPOST application/json (campos opcionais):\n{\n  "teamId": "<uuid-equipa-opcional>",\n  "reason": "Cliente solicitou atendente humano"\n}\n\nSem `teamId`: apenas abre para a fila geral. Com `teamId`: atribui equipa antes do handoff (falha de equipa inválida não bloqueia a abertura).\n\n**Bot externo (ocb_):** POST /api/v1/agent-bot/conversations/:id/call-human — mesma semântica com Bearer ocb_<token>.',
  },
];
