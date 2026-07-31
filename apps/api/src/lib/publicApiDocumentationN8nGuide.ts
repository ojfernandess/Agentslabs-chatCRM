/**
 * Guia n8n — bot externo, webhook e call_human (documentação pública).
 */

export type PublicApiDocGuideSection = {
  id: string;
  titlePt: string;
  bodyPt?: string;
  codeLabelPt?: string;
  codePt?: string;
  bulletsPt?: string[];
};

export type PublicApiDocN8nGuide = {
  titlePt: string;
  introPt: string;
  sequenceDiagramMermaid: string;
  sections: PublicApiDocGuideSection[];
};

export const PUBLIC_API_DOCUMENTATION_N8N_GUIDE: PublicApiDocN8nGuide = {
  titlePt: "Integração n8n — bot externo e call_human",
  introPt:
    "Este guia explica como ligar o OpenNexo CRM a um fluxo n8n (ou outro orquestrador) usando o token do bot `ocb_...`. A organização é detectada automaticamente pelo token — não envie `organizationId` nas rotas `/api/v1/agent-bot/*`.",
  sequenceDiagramMermaid: `sequenceDiagram
  participant Cliente
  participant CRM as OpenNexo CRM
  participant Bot as Seu bot externo (n8n)
  participant API as API OpenNexo

  Cliente->>CRM: Mensagem WhatsApp
  CRM->>Bot: POST webhook (message_created)
  Note over Bot: conversation.id no payload
  Bot->>Bot: Decide escalar para humano
  Bot->>API: POST .../call-human (Bearer ocb_)
  API->>CRM: Conversa OPEN + nota interna
  Bot->>API: POST .../messages (opcional)
  CRM->>Cliente: Mensagem de transição`,
  sections: [
    {
      id: "webhook-entrada",
      titlePt: "Webhook de entrada (CRM → n8n)",
      bodyPt:
        "Configure o URL do webhook n8n na página Bots do CRM. Quando chega uma mensagem, o CRM envia POST para o `webhookUrl` do bot com o evento `message_created`. Guarde `conversation.id` e `contact.id` — usa-os nas chamadas de volta à API.",
      codeLabelPt: "Exemplo de payload (message_created)",
      codePt: `{
  "event": "message_created",
  "version": "openconduit-v1",
  "agent_bot_id": "<uuid-do-bot>",
  "account": { "id": "<uuid-organizacao>" },
  "inbox_id": "<uuid-caixa>",
  "conversation": {
    "id": "<uuid-conversa>",
    "status": "PENDING",
    "contact_id": "<uuid-contacto>",
    "inbox_id": "<uuid-caixa>"
  },
  "contact": {
    "id": "<uuid-contacto>",
    "name": "Maria Silva",
    "phone": "+5511999990000"
  },
  "message": {
    "id": "<uuid-mensagem>",
    "direction": "INBOUND",
    "type": "TEXT",
    "body": "Quero falar com um atendente"
  }
}`,
    },
    {
      id: "organizacao-auto",
      titlePt: "Como funciona a detecção da organização",
      bodyPt:
        "Cada bot externo tem um token `ocb_...` emitido na página Bots. Em todas as rotas `/api/v1/agent-bot/*`, o CRM valida o token e aplica automaticamente o `organizationId` desse bot. Um token = uma organização. Para vários clientes, use credenciais `ocb_` diferentes no n8n (workflows ou ambientes separados).",
      bulletsPt: [
        "Configure uma vez no n8n: variável `CRM_BASE_URL` (ex.: https://chat.seudominio.com) e credencial Header Auth `Authorization: Bearer ocb_...`.",
        "Não é necessário enviar `organizationId` no body, query ou path das rotas agent-bot.",
        "O campo `account.id` no webhook é informativo; nas chamadas de API com `ocb_` não precisa reenviá-lo.",
        "Valide o token: GET /api/v1/agent-bot/profile",
      ],
    },
    {
      id: "opcao-a",
      titlePt: "Opção A — Recomendada para n8n (token ocb_)",
      bodyPt:
        "Use POST /api/v1/agent-bot/conversations/:id/call-human com o mesmo Bearer `ocb_...` do bot. Paridade total com a ferramenta nativa `call_human`: estado OPEN, nota interna de handoff e `awaitingHumanHandoff`.",
      codeLabelPt: "n8n — nó HTTP Request (call_human)",
      codePt: `Método: POST
URL: {{ $env.CRM_BASE_URL }}/api/v1/agent-bot/conversations/{{ $json.conversation.id }}/call-human

Authentication: Header Auth
  Name: Authorization
  Value: Bearer {{ $env.OCB_TOKEN }}

Headers:
  Content-Type: application/json

Body (JSON):
{
  "reason": "{{ $json.message.body }}",
  "teamId": "{{ $json.teamIdOpcional }}"
}

Nota: omita "teamId" ou envie null se não quiser equipa específica.`,
    },
    {
      id: "opcao-b",
      titlePt: "Opção B — call_human completo (integração server-side / admin)",
      bodyPt:
        "Alternativa para backends com token de automação admin (`ocu_...`) ou JWT de ADMIN — não use `ocb_` nesta rota.",
      codeLabelPt: "POST /api/v1/automations/conversations/:id/call-human",
      codePt: `POST {{CRM_BASE_URL}}/api/v1/automations/conversations/<conversation-id>/call-human
Authorization: Bearer ocu_<token-perfil-admin>
# ou Authorization: Bearer <jwt-admin>

Content-Type: application/json

{
  "teamId": "<uuid-equipa-opcional>",
  "reason": "Cliente solicitou atendente humano"
}`,
    },
    {
      id: "teamid",
      titlePt: "teamId é opcional",
      bodyPt: "Em ambos os endpoints (`agent-bot` e `automations`), o campo `teamId` NÃO é obrigatório.",
      codeLabelPt: "Sem equipa — fila geral",
      codePt: `POST .../conversations/{{conversation.id}}/call-human
Authorization: Bearer ocb_<token>

{}

# ou apenas:
{ "reason": "Cliente pediu atendente humano" }`,
      bulletsPt: [
        "Sem teamId: conversa OPEN, atendente limpo, nota interna — entra na fila geral de humanos.",
        "Com teamId: tenta atribuir equipa antes do handoff (GET /api/v1/agent-bot/teams para UUIDs).",
        "Se teamId for inválido, a abertura para humanos NÃO é bloqueada.",
        "Para transferência obrigatória a equipa, prefira POST .../transfer-team ou PATCH .../team.",
      ],
    },
    {
      id: "quando-escalar",
      titlePt: "Quando escalar (lógica no n8n)",
      bodyPt: "Exemplos de condições no nó IF/Switch do n8n antes de chamar call-human:",
      bulletsPt: [
        "Cliente pede humano/atendente (palavras-chave: «atendente», «humano», «falar com alguém»).",
        "O teu LLM ou regra de negócio não consegue responder com confiança.",
        "Timeout ou erro numa tool HTTP externa.",
        "Intenção de reclamação ou pedido fora do escopo do bot.",
      ],
      codeLabelPt: "Exemplo — expressão IF no n8n",
      codePt: `{{ $json.message.body.toLowerCase().match(/humano|atendente|pessoa|falar com/) !== null }}`,
    },
    {
      id: "fluxo-completo-n8n",
      titlePt: "Fluxo n8n completo (exemplo)",
      bodyPt: "Ordem sugerida de nós após o Webhook trigger:",
      bulletsPt: [
        "1. Webhook — recebe message_created",
        "2. IF — deve escalar para humano?",
        "3. HTTP Request — POST .../call-human (ramo sim)",
        "4. HTTP Request — POST .../messages com texto de transição (opcional)",
        "5. HTTP Request — POST .../messages com resposta do bot (ramo não)",
      ],
      codeLabelPt: "n8n — avisar o cliente após handoff (opcional)",
      codePt: `Método: POST
URL: {{ $env.CRM_BASE_URL }}/api/v1/agent-bot/messages

Authorization: Bearer {{ $env.OCB_TOKEN }}
Content-Type: application/json

{
  "contactId": "{{ $json.contact.id }}",
  "conversationId": "{{ $json.conversation.id }}",
  "type": "TEXT",
  "body": "Estou a transferir para um atendente humano. Aguarde um momento, por favor."
}`,
    },
    {
      id: "resposta-call-human",
      titlePt: "Resposta do endpoint call-human",
      codeLabelPt: "HTTP 200",
      codePt: `{
  "ok": true,
  "teamId": "<uuid-opcional-ou-null>",
  "teamName": "Suporte",
  "message": "Conversa aberta para atendimento humano."
}`,
      bodyPt:
        "Efeitos no CRM: conversa com status OPEN, `assignedToId` limpo, nota interna privada com resumo do handoff, flag `awaitingHumanHandoff`, notificação em tempo real no workspace.",
    },
    {
      id: "resumo",
      titlePt: "Resumo",
      bulletsPt: [
        "Webhook CRM → n8n traz conversation.id — não precisa de organizationId na API agent-bot.",
        "Handoff recomendado: POST /api/v1/agent-bot/conversations/:id/call-human com Bearer ocb_.",
        "teamId opcional — omita para fila geral.",
        "Alternativa admin: POST /api/v1/automations/conversations/:id/call-human com ocu_ ou JWT.",
        "Equipas: GET /api/v1/agent-bot/teams",
        "Validar token: GET /api/v1/agent-bot/profile",
      ],
    },
  ],
};
