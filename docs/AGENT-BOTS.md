# Agent bots (automação WhatsApp)

Este documento descreve o fluxo **OpenConduit** para bots que respondem no WhatsApp. O desenho segue o padrão comum de **webhook de entrada + API de resposta autenticada** usado em várias plataformas de suporte.

## Configuração (tenant)

1. **Definir um bot** na página **Bots** (URL de webhook, opcionalmente segredo para assinatura HMAC).
2. Em **Configurações**, associar esse bot como **Agent bot** quando existir webhook ativo: conversas novas no WhatsApp podem entrar em **PENDENTE** (`PENDING`) para o bot atuar antes do humano.
3. O bot recebe um **token de inbox** (`ocb_...`) para chamar a API de resposta.

## Dois tipos de autenticação (como no Chatwoot: sessão vs token de integração)

| Uso | Cabeçalho | Onde |
|-----|-----------|------|
| **Gestão de bots na API tenant** (criar, PATCH, apagar, `inbox-token`, interações) | `Authorization: Bearer <JWT>` — campo `token` de **`POST /api/v1/auth/login`** com utilizador **ADMIN** ou **SUPER_ADMIN** no contexto da organização | `POST/PATCH/DELETE /api/v1/bots`, etc. |
| **Leitura do próprio bot na API `/bots`** (um único token no integrador) | `Authorization: Bearer ocb_...` | **`GET /api/v1/bots`** (resposta: um item na lista) ou **`GET /api/v1/bots/<uuid-do-bot>`** (o `uuid` tem de ser o deste bot) |
| **Automação do bot** (respostas WhatsApp, handoff) | `Authorization: Bearer ocb_...` | **`/api/v1/agent-bot/*`**: `GET /profile`, `POST /messages`, `PATCH /conversations/:id` |

Se um integrador enviar **`ocb_...`** num **POST/PATCH/DELETE** em **`/api/v1/bots`**, a API responde **401** com `code: AGENT_BOT_TOKEN_NOT_ALLOWED`.

Para **listar todos os bots** ou **criar** bot, continue a usar **JWT** de login. O token **`ocb_`** em **GET** `/api/v1/bots` só devolve **o próprio** bot (compatível com sistemas que pedem “JWT” mas na prática aceitam o token gerado na UI do bot).

Para obter **`agent_bot_id`** com o token do bot, pode usar **`GET /api/v1/agent-bot/profile`** ou **`GET /api/v1/bots`** com o mesmo Bearer.

## Entrada: webhook para o seu serviço

Após uma mensagem **recebida** (inbound) persistida, se o modo agent bot estiver ativo para a organização, o OpenConduit envia um **POST** para `webhookUrl` do bot com JSON contendo:

- `event`: `"message_created"`
- `version`: `"openconduit-v1"`
- `agent_bot_id`: UUID do bot (mesmo valor que `agent_bot.id`; alias estilo Chatwoot no topo do JSON)
- `inbox_id`: UUID estável da **caixa de entrada** (igual ao `id` em `GET /api/v1/inboxes`, no modelo Chatwoot)
- `inbox`: `{ id, name, channel }` — `channel` é o tipo da caixa em minúsculas (ex.: `whatsapp`, `website`)
- `account`, `conversation`, `contact`, `message` (metadados e corpo; em `conversation` também consta `inbox_id`)
- `agent_bot`: id, nome e tipo do bot

Cabeçalhos úteis: `X-OpenConduit-Event`, `X-OpenConduit-Signature` (se houver `webhookSecret`).

Implementação: `apps/api/src/lib/agentBotWebhook.ts`, chamada a partir de `apps/api/src/routes/webhooks.ts` após processar a mensagem do WhatsApp.

## Saída: responder ao cliente

- **Identidade / validar token do bot:** `GET /api/v1/agent-bot/profile` **ou** `GET /api/v1/bots` com `Authorization: Bearer ocb_<token>` — resposta com um bot em `data` (integrações que só têm um campo “JWT”/API).
- **Base:** `POST /api/v1/agent-bot/messages` — resposta `201` inclui `agent_bot_id` (UUID do bot que enviou).
- **Autenticação:** `Authorization: Bearer ocb_<token>` (token mostrado na UI do bot).
- **Corpo:** mesmo contrato de envio de mensagem que o painel usa (contacto/conversa, texto, anexos conforme `sendMessageSchema`).

O serviço do bot deve mapear `conversation.id` e `contact.id` do webhook para o próximo envio.

Implementação: `apps/api/src/routes/agentBotInbox.ts`.

## Handoff humano / devolver ao bot

- `PATCH /api/v1/agent-bot/conversations/:id` com `{ "status": "OPEN" }` ou `{ "status": "PENDING" }` (mesmo token Bearer).

`OPEN` coloca a conversa na fila humana; `PENDING` devolve à fila do bot, quando aplicável.

## Verificação de implementação

| Etapa | Estado |
|--------|--------|
| Disparo do webhook só em inbound com agent bot ativo | Sim (`webhooks.ts` + `dispatchAgentBotWebhook`) |
| Payload JSON versionado (`openconduit-v1`) | Sim |
| Resposta outbound autenticada por token de bot | Sim (`authenticateAgentBot`) |
| Assinatura HMAC opcional no outbound | Sim (`X-OpenConduit-Signature`) |
| Transição de estado OPEN/PENDING via API do bot | Sim |

Para mais detalhes de campos, inspecione `buildAgentBotWebhookPayload` e os schemas Zod em `agentBotInbox.ts` / `messagePayload.ts`.
