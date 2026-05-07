# Agent bots (automação WhatsApp)

Este documento descreve o fluxo **OpenConduit** para bots que respondem no WhatsApp. O desenho segue o padrão comum de **webhook de entrada + API de resposta autenticada** usado em várias plataformas de suporte.

## Configuração (tenant)

1. **Definir um bot** na página **Bots** (URL de webhook, opcionalmente segredo para assinatura HMAC).
2. Em **Configurações**, associar esse bot como **Agent bot** quando existir webhook ativo: conversas novas no WhatsApp podem entrar em **PENDENTE** (`PENDING`) para o bot atuar antes do humano.
3. O bot recebe um **token de inbox** (`ocb_...`) para chamar a API de resposta.

## Entrada: webhook para o seu serviço

Após uma mensagem **recebida** (inbound) persistida, se o modo agent bot estiver ativo para a organização, o OpenConduit envia um **POST** para `webhookUrl` do bot com JSON contendo:

- `event`: `"message_created"`
- `version`: `"openconduit-v1"`
- `account`, `conversation`, `contact`, `message` (metadados e corpo)
- `agent_bot`: id, nome e tipo do bot

Cabeçalhos úteis: `X-OpenConduit-Event`, `X-OpenConduit-Signature` (se houver `webhookSecret`).

Implementação: `apps/api/src/lib/agentBotWebhook.ts`, chamada a partir de `apps/api/src/routes/webhooks.ts` após processar a mensagem do WhatsApp.

## Saída: responder ao cliente

- **Base:** `POST /api/v1/agent-bot/messages`
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
