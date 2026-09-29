# Roadmap — Latência e throughput de mensagens (Meta / bot)

> Criado: 2026-09-28  
> Princípio: **evolução incremental**, sem mudar comportamento do bot sem opt-in explícito.  
> Escopo: quatro melhorias de alto impacto identificadas na investigação de latência inbound/outbound.

---

## Legenda

| Símbolo | Significado |
|---------|-------------|
| ✅ | Concluído |
| 🚧 | Em implementação |
| 📋 | Planejado |
| ⏸️ | Adiado |
| ⚠️ | Risco de mudança de comportamento |

---

## Visão geral

| # | Iniciativa | Impacto | Esforço | Risco | Ordem sugerida |
|---|------------|---------|---------|-------|----------------|
| 1 | Índice em `whatsappPhoneNumberId` | Médio (lookup webhook) | Baixo (~1–2 dias) | Baixo | **Fase 0** |
| 2 | Webhook Meta 200 cedo + fila | Alto (throughput, retries Meta) | Médio (~1–2 semanas) | Médio | **Fase 1** |
| 3 | Transcrição assíncrona | Alto (TTFR do bot em áudio) | Médio–alto (~2 semanas) | **Alto** ⚠️ | **Fase 2** |
| 4 | Streaming do bot (`streamingEnabled`) | Alto (percepção do usuário) | Médio (~1–2 semanas) | Médio | **Fase 3** ✅ |

**Dependências:**

```
Fase 0 (índice) ──► acelera webhook síncrono e worker
Fase 1 (fila)     ──► base para mover transcrição/timeline/tags para worker
Fase 2 (transcrição) ──► idealmente após Fase 1 (job na mesma fila)
Fase 3 (streaming) ──► independente; validar com outbound estável
```

**Métricas de sucesso (todas as fases):**

| Métrica | Baseline atual (estimado) | Alvo |
|---------|---------------------------|------|
| p95 tempo até HTTP 200 no webhook Meta | ~500ms–5s+ (transcrição, DB) | < 100ms |
| p95 lookup org por `phone_number_id` | O(n) inboxes WhatsApp | < 10ms |
| p95 TTFR bot (texto) | dominado por LLM | −0% (sem mudança) |
| p95 TTFR bot (áudio, com transcrição) | LLM + transcrição sequencial | −30–60% (Fase 2, opt-in) |
| p95 primeira mensagem visível ao contacto (streaming) | após LLM completo | −40–70% percepção |
| Taxa de retry Meta (5xx/timeout) | a medir em produção | −50%+ |

---

## Estado atual (referência de código)

### Webhook Meta síncrono

`apps/api/src/routes/webhooks.ts` — `handleWhatsAppPost` processa tudo antes do `reply.send()`:

1. Resolve org/inbox (`findOrganizationByMetaPhoneNumberId`)
2. Cria/atualiza contacto e conversa
3. Download de mídia (alguns paths)
4. Persiste mensagem
5. **Broadcast WS** (~linha 708) — UI já vê a mensagem
6. **Transcrição** áudio/imagem (~717) — bloqueia pipeline
7. Timeline, auto-tags, dispatch do bot

A Meta reenvia o webhook se não recebe 200 rápido → duplicatas e carga extra.

### Lookup de inbox

`apps/api/src/lib/inboxWhatsappConfig.ts` — `findOrganizationByMetaPhoneNumberId`:

- `findMany` em **todas** as inboxes `WHATSAPP`
- Parse JSON de `channelConfig` por linha
- Fallback em `Settings.whatsappPhoneNumberId` (já indexável no schema)

`Settings` já tem coluna `whatsappPhoneNumberId`; **Inbox** guarda o ID só em `channelConfig` JSON.

### Transcrição bloqueia bot

- `maybeTranscribeInboundAudioMessage` / `maybeTranscribeInboundImageMessage`
- Bot usa `message.body` em `agentBotWebhook.ts` (~210)
- Áudio chega com `body` vazio → bot depende da transcrição hoje

### Streaming

- Config: `agentEngine.streamingEnabled` (LangGraph/observabilidade)
- Envio ao contacto: `clientOutboundStreamingEnabled` + `createClientOutboundTokenStream` em `agentNativeLlm.ts`
- Default: **tudo desligado**
- WhatsApp: chunks ~180 chars, múltiplas mensagens outbound (sem edição in-place)

### Infra de fila existente

- BullMQ: `agentEngineQueue.ts`, `broadcastQueue.ts`
- Redis já usado em produção para agent engine e campanhas

---

## Fase 0 — Índice `whatsappPhoneNumberId` 📋

**Problema:** cada webhook Meta faz scan de todas as caixas WhatsApp da plataforma.

**Solução:** coluna indexada + backfill + manter sincronizado no save da inbox.

### Tarefas

| # | Tarefa | Arquivos | Estimativa |
|---|--------|----------|------------|
| 0.1 | Adicionar `whatsappPhoneNumberId String?` em `Inbox` + índice `@@index([whatsappPhoneNumberId])` | `prisma/schema.prisma`, migration | 2h |
| 0.2 | Backfill: ler `channelConfig` de inboxes existentes e popular coluna | script `apps/api/src/scripts/backfillInboxWhatsappPhoneNumberId.ts` | 4h |
| 0.3 | Escrever coluna em create/update de inbox WhatsApp | `inboxWhatsappConfig.ts`, rotas `inboxes.ts` | 4h |
| 0.4 | Refatorar `findOrganizationByMetaPhoneNumberId` → `findFirst` na coluna; manter fallback JSON para linhas não backfilled | `inboxWhatsappConfig.ts` | 4h |
| 0.5 | Refatorar `findWhatsappInboxByPhoneNumberId` (mesmo padrão, scoped por org) | `inboxWhatsappConfig.ts` | 2h |
| 0.6 | Testes unitários lookup + migration em staging | `inboxWhatsappConfig.test.ts` | 4h |

### Critérios de aceite

- [ ] Lookup por `phone_number_id` usa índice (confirmar com `EXPLAIN` em staging)
- [ ] Zero regressão em orgs com Settings legado (sem inbox dedicada)
- [ ] Novas inboxes populam coluna automaticamente

### Risco

**Baixo** — additive, fallback mantém compatibilidade.

---

## Fase 1 — Webhook Meta: 200 cedo + processamento em fila ✅

**Problema:** webhook segura conexão HTTP durante DB, mídia, transcrição e bot → timeouts e retries da Meta.

**Solução:** responder `200` após validação mínima + enfileirar job idempotente.

### Design proposto

```
POST /webhooks/whatsapp
  ├─ validar assinatura / payload
  ├─ dedupe rápido (wamid em Redis ou DB leve)
  ├─ enqueue MetaInboundJob { wamid, phoneNumberId, payload, receivedAt }
  └─ reply 200 ( < 100ms )

Worker MetaInboundJob
  ├─ resolver org/inbox (Fase 0)
  ├─ upsert contact/conversation/message (idempotente por wamid)
  ├─ broadcast WS (mensagem criada)
  ├─ enqueue sub-jobs: transcription, timeline, auto-tags, bot dispatch
  └─ marcar job concluído
```

### Tarefas

| # | Tarefa | Arquivos | Estimativa |
|---|--------|----------|------------|
| 1.1 | Definir `MetaInboundJob` payload + idempotency key (`wamid`) | `apps/api/src/lib/metaInboundQueue.ts` (novo) | 1d |
| 1.2 | Extrair lógica de `handleWhatsAppPost` para `processMetaInboundWebhook(job)` | `webhooks.ts`, `metaInboundProcessor.ts` | 2d |
| 1.3 | Handler HTTP fino: validar → dedupe → enqueue → 200 | `webhooks.ts` | 1d |
| 1.4 | Worker BullMQ + registro em `server.ts` (padrão `broadcastQueue`) | `metaInboundQueue.ts`, `server.ts` | 1d |
| 1.5 | Dedupe: `Message.externalId` unique ou Redis SET com TTL 24h | schema / Redis | 0.5d |
| 1.6 | Status callbacks Meta (delivered/read) — manter rápido ou mesma fila | `webhooks.ts` | 0.5d |
| 1.7 | Feature flag `META_INBOUND_QUEUE_ENABLED` (rollback = path síncrono) | env + config | 0.5d |
| 1.8 | Métricas: tempo até 200, lag da fila, jobs falhos, duplicatas ignoradas | logs / Langfuse / Prometheus | 1d |
| 1.9 | Testes: payload duplicado, worker retry, falha parcial | testes integração | 1d |

### Critérios de aceite

- [ ] p95 HTTP 200 < 100ms com fila ligada
- [ ] Mesmo resultado funcional que path síncrono (mensagem + WS + bot)
- [ ] Retry da Meta não cria mensagem duplicada
- [ ] Flag desliga fila sem deploy

### Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Job falha após 200 → mensagem perdida | Retry BullMQ + dead-letter + alerta; idempotência no worker |
| Ordem de eventos (status antes de message) | Worker ordena por `timestamp` ou buffer curto por conversa |
| Redis indisponível | Fallback síncrono (flag) ou degrade graceful documentado |
| Latência WS ligeiramente maior | Aceitável vs retries; opcional fast-path só para broadcast |

### O que **não** mover na v1 da fila

- Transcrição e bot podem ficar no mesmo worker inicialmente (menor diff)
- Na Fase 2, extrair transcrição para sub-job

---

## Fase 2 — Transcrição assíncrona ✅

**Problema:** `maybeTranscribeInboundAudioMessage` / `maybeTranscribeInboundImageMessage` bloqueiam o dispatch do bot.

**Objetivo:** reduzir TTFR em mídia **sem** degradar qualidade das respostas do bot.

### Opções (escolher uma como default)

| Opção | Bot antes da transcrição? | Comportamento | Recomendação |
|-------|---------------------------|---------------|--------------|
| **A — Side-effect async** | Não | Transcrição em paralelo só para timeline/UI; bot espera (ou fila dedicada antes do bot) | **v1 — mais segura** |
| **B — Bot com placeholder** | Sim, com `[áudio recebido]` | Bot genérico; re-turn opcional após transcrição | v2 experimental |
| **C — Gate por tipo de agente** | Config por bot | `waitForTranscription: true/false` | v2 após A |
| **D — Transcrição streaming** | Parcial | STT incremental alimenta bot | futuro |

**Recomendação:** implementar **Opção A** na primeira entrega; expor **Opção C** como flag no `behaviorConfig` na segunda.

### Design (Opção A)

```
Worker inbound
  ├─ criar mensagem (body vazio se áudio)
  ├─ broadcast WS
  ├─ se AUDIO/IMAGE e transcrição habilitada:
  │     enqueue TranscriptionJob (não bloqueia)
  ├─ dispatch bot:
  │     se AUDIO/IMAGE → aguardar TranscriptionJob OU timeout (ex. 15s) → fallback
  └─ TranscriptionJob → atualiza body → WS message.updated → (opcional) não re-dispara bot
```

Para **ganho real de TTFR** com qualidade preservada, o bot ainda espera transcrição — o ganho vem de **paralelizar** transcrição com outras tarefas (timeline, tags) e de **não segurar o HTTP 200** (Fase 1).

Para **ganho com bot antes**, só Opção B/C com flag explícita.

### Tarefas

| # | Tarefa | Arquivos | Estimativa |
|---|--------|----------|------------|
| 2.1 | Extrair transcrição para `TranscriptionJob` | `audioTranscription.ts`, `imageTranscription.ts`, nova fila | 2d |
| 2.2 | `message.updated` WS após transcrição (UI já suporta?) | `workspaceMessageBroadcast.ts`, web | 1d |
| 2.3 | Bot gate: `await transcription` com timeout configurável | `agentBotWebhook.ts`, `channelInboxIngest.ts` | 1d |
| 2.4 | Flag `agentEngine.waitForInboundTranscription` (default `true`) | `parseAgentEngineConfig.ts` | 0.5d |
| 2.5 | (Opcional v2) `dispatchBotAfterTranscription: false` + segundo turno | `agentBotWebhook.ts` | 2d |
| 2.6 | Testes: áudio sem transcrição, timeout, imagem OCR | testes | 1d |

### Critérios de aceite

- [x] Com flag default: respostas do bot em áudio **iguais** às atuais
- [x] UI mostra transcrição quando pronta (sem reload)
- [x] Com flag opt-in: bot responde antes (`waitForInboundTranscription: false`)

### Risco

**Alto** se bot disparar sem `body` — mitigar com default conservador e testes de regressão em conversas de áudio reais.

---

## Fase 3 — Streaming do bot para o contacto ✅

**Problema:** contacto só vê resposta após LLM terminar (~3–15s); percepção de lentidão.

**Solução:** ativar `clientOutboundStreamingEnabled` (e alinhar naming com `streamingEnabled` na UI).

### Estado atual

- `createClientOutboundTokenStream` — flush ~180 chars, múltiplas mensagens WhatsApp
- `agentNativeLlm.ts` — `onTokenDelta` já wired se `clientOutboundStreamingEnabled`
- `streamingEnabled` — separado (grafo/Langfuse); **não** envia ao WhatsApp sozinho

### Tarefas

| # | Tarefa | Arquivos | Estimativa |
|---|--------|----------|------------|
| 3.1 | Documentar e unificar flags: `streamingEnabled` → também liga `clientOutboundStreamingEnabled` quando canal suporta | `parseAgentEngineConfig.ts` | 0.5d |
| 3.2 | UI admin: toggle "Resposta em partes (WhatsApp)" com aviso (várias bolhas) | painel agente / automation | 1d |
| 3.3 | Garantir LangGraph runtime repassa `onTokenDelta` | `LangGraphRuntime`, executors | 2d |
| 3.4 | Evitar dupla entrega: stream + mensagem final única | `agentNativeLlm.ts`, `outboundMessage.ts` | 1d |
| 3.5 | Typing indicator: ligar durante stream | `BotTypingIndicator`, webhook outbound | 0.5d |
| 3.6 | Limites Meta: rate limit entre chunks, tamanho mínimo/máximo | `clientOutboundTokenStream.ts` | 1d |
| 3.7 | Feature flag por org + métricas (chunk count, tempo até 1º chunk) | config, logs | 0.5d |
| 3.8 | Testes E2E: stream desligado = 1 mensagem; ligado = N chunks sem duplicar texto final | testes | 1d |

### Critérios de aceite

- [x] Primeiro chunk ao contacto em < 2s após início LLM (rede normal; depende do modelo)
- [x] Texto final idêntico ao modo não-streaming
- [x] Sem mensagem duplicada no thread (`clientStreamDelivered`)
- [x] Funciona em Meta Cloud; Evolution usa mesmo `deliverOutboundWhatsAppMessage`

### Riscos

| Risco | Mitigação |
|-------|-----------|
| Várias bolhas confundem usuário | Copy na UI; chunk maior (300 chars) configurável |
| Rate limit Meta | Throttle entre sends; backoff |
| Tools mid-stream | Buffer até tool call; flush após tool |

---

## Fase 4 — Quick wins relacionados ✅

| Item | Status | Arquivos |
|------|--------|----------|
| Omitir `conversation.updated` em nova mensagem (só `message.created`) | ✅ | `workspaceMessageBroadcast.ts` |
| Cache `getAgentBotDispatchContextForInbox` (TTL 60s) | ✅ | `agentBotDispatchContextCache.ts`, `agentBotTriage.ts` |
| Timeline + auto-tags fire-and-forget (não bloqueiam bot) | ✅ | `whatsappInboundProcessor.ts` |
| WS cedo + download mídia em background | ✅ opt-in | `inboundMediaDeferredDownload.ts`, `INBOUND_MEDIA_DEFER_DOWNLOAD_ENABLED` |
| UI: `updatedAt` local + `message.updated` com mediaUrl | ✅ | `ConversationDetailPage.tsx`, `WorkspaceRealtime.tsx` |

---

## Cronograma sugerido

| Semana | Entrega |
|--------|---------|
| S1 | Fase 0 completa + métricas baseline |
| S2–S3 | Fase 1 (fila webhook) em staging → canary produção |
| S4–S5 | Fase 2 Opção A + flag conservadora |
| S6–S7 | Fase 3 streaming + UI admin |
| S8 | Hardening, dashboards, documentação operacional |

**Total estimado:** 6–8 semanas (1 engineer), ou 4–5 semanas com 2 engineers (Fase 1 + 3 em paralelo após Fase 0).

---

## Checklist pré-produção (todas as fases)

Ver **[pre-production-checklist.md](./pre-production-checklist.md)** (checklist operacional completo).

| Item | Status | Referência |
|------|--------|------------|
| Dashboard p95 webhook / lag / TTFR / retry Meta | ✅ instrumentado | `GET /api/v1/super/message-processing/dashboard` → `productionSlo` |
| Runbook Redis / worker / replay | ✅ | [production-runbook-latency.md](./production-runbook-latency.md) |
| Feature flags documentadas | ✅ | `.env.example` + checklist §3 |
| Teste de carga webhook | ✅ script | `apps/api/scripts/load-test-meta-inbound-webhook.mjs` |
| Conta Meta real | 📋 manual | checklist §5 |

---

## Referências

| Tópico | Arquivo |
|--------|---------|
| Webhook Meta | `apps/api/src/routes/webhooks.ts` |
| Lookup phone ID | `apps/api/src/lib/inboxWhatsappConfig.ts` |
| Transcrição áudio/imagem | `apps/api/src/lib/audioTranscription.ts`, `imageTranscription.ts` |
| Pipeline bot | `apps/api/src/lib/agentBotWebhook.ts` |
| Streaming outbound | `apps/api/src/lib/clientOutboundTokenStream.ts`, `agentNativeLlm.ts` |
| Config engine | `apps/api/src/lib/agent-engine/config/parseAgentEngineConfig.ts` |
| Fila existente | `apps/api/src/lib/agent-engine/queue/agentEngineQueue.ts`, `broadcastQueue.ts` |

---

## Decisões em aberto (resolver antes de Fase 2/3)

1. **Transcrição:** default permanece “bot espera” (A) ou produto aceita respostas genéricas em áudio (B/C)?
2. **Streaming:** uma bolha longa com edição (impossível no WhatsApp) vs várias bolhas — copy para o cliente final?
3. **Fila:** Redis dedicado para inbound ou partilhar com `agentEngineQueue`?
4. **Dedupe:** constraint DB em `externalId` global ou por org?

---

*Documento para implementação futura — não altera comportamento em produção até cada fase ser mergeada com flag.*
