# Plano de correções arquiteturais — OpenConduit

> Criado: 2026-09-29  
> Princípio: **evolução incremental**, sem mudar comportamento operacional sem opt-in explícito.  
> Relacionado: [message-latency-roadmap.md](./message-latency-roadmap.md)

---

## Legenda

| Símbolo | Significado |
|---------|-------------|
| ✅ | Concluído |
| 🚧 | Em implementação |
| 📋 | Planejado |
| ⏸️ | Adiado |

---

## Visão geral

| Trilho | Fases | Esforço | Impacto CPU | Impacto latência |
|--------|-------|---------|-------------|------------------|
| **A** — Latência webhook → contacto | A0–A3 | ~5–6 semanas | Médio | Alto |
| **B** — Isolamento CPU / arquitetura | B0–B5 | ~4–5 semanas | **Alto** | Médio |

**Sequência mínima recomendada:** B0 → A0 → B1 → A1 (esta entrega: **B0 + A0**).

---

## Estado atual (baseline)

| Área | Status |
|------|--------|
| Cache per-turn (tools, KB, history) | ✅ |
| Trace deferral inbound | ✅ |
| Fila agent engine (B0) | ✅ env `AGENT_ENGINE_EXECUTION_QUEUE_ENABLED` |
| Índice `Inbox.whatsappPhoneNumberId` | ✅ A0 |
| Webhook Meta 200 cedo + fila | ✅ A1 |
| Transcrição assíncrona inbound | ✅ A2 |
| Worker dedicado (`PROCESS_ROLE`) | ✅ B1 |
| Agent worker dedicado + concurrency | ✅ B2 |
| WebSocket rooms + debounce | ✅ B4 |
| Observabilidade P50/P95 + alertas | ✅ B5 |
| Streaming outbound WhatsApp | ✅ A3 |
| Quick wins latência (Fase 4) | ✅ |
| Checklist pré-produção | ✅ [pre-production-checklist.md](./pre-production-checklist.md) |
| PgBouncer / pool tuning | ✅ B3 |

**Infra:** API + bot + CRM + WS + 11 schedulers no mesmo processo Node; BullMQ in-process (agent 2, CRM 3, broadcast 2).

---

## Trilho B — Isolamento de CPU

### Fase B0 — Ativar fila do agent engine ✅ (implementado)

**Problema:** bot roda inline no processo HTTP quando `executionQueueEnabled=false` ou fila indisponível.

**Solução:**

1. Variável de plataforma `AGENT_ENGINE_EXECUTION_QUEUE_ENABLED=true` — activa fila para todos os bots exceto os com `executionQueueEnabled: false` explícito no `behaviorConfig`.
2. Métricas de enqueue vs fallback síncrono em `getAgentEngineQueueDiagnostics()`.
3. Documentação em `.env.example` (rollback = env `false` ou opt-out por bot).

| # | Tarefa | Arquivos |
|---|--------|----------|
| B0.1 | Env `AGENT_ENGINE_EXECUTION_QUEUE_ENABLED` | `config.ts`, `.env.example` |
| B0.2 | Resolver flag plataforma + opt-out por bot | `parseAgentEngineConfig.ts` |
| B0.3 | Contadores enqueue / fallback | `agentEngineQueueMetrics.ts`, `agentBotWebhook.ts` |
| B0.4 | Diagnostics atualizados | `agentEngineQueue.ts` |

**Aceite:** com Redis operacional e env=true, turnos do bot saem do webhook; fallback < 1% em condições normais.

**Rollback:** `AGENT_ENGINE_EXECUTION_QUEUE_ENABLED=false` ou `agentEngine.executionQueueEnabled: false` no bot.

---

### Fase B1 — `PROCESS_ROLE`: separar API de workers ✅ (implementado)

**Problema:** um Node executa HTTP + BullMQ + schedulers.

```
api:     PROCESS_ROLE=api
worker:  PROCESS_ROLE=worker
agent:   PROCESS_ROLE=agent-worker  (opcional)
```

| # | Tarefa | Arquivos |
|---|--------|----------|
| B1.1 | `PROCESS_ROLE` em config | `config.ts` |
| B1.2 | Condicionar workers/schedulers em `server.ts` | `server.ts` |
| B1.3 | Serviço `worker` no docker-compose | `docker-compose.yml` |

**Aceite:** CPU container API < 200% sob carga de webhook.

---

### Fase B2 — Worker dedicado agent-engine ✅ (implementado)

`PROCESS_ROLE=agent-worker` + `AGENT_ENGINE_DEDICATED_WORKER=true` no worker geral.

| # | Tarefa | Arquivos |
|---|--------|----------|
| B2.1 | Role `agent-worker` | `processRole.ts`, `worker.ts`, `docker-entrypoint.sh` |
| B2.2 | `AGENT_ENGINE_CONCURRENCY` | `config.ts`, `agentEngineQueue.ts` |
| B2.3 | Rate limit por org (Redis) | `agentEngineOrgRateLimit.ts`, métricas |
| B2.4 | Split filas no worker geral | `backgroundWorkers.ts` |
| B2.5 | Compose profile `split-agent` | `docker-compose.yml`, `.env.example` |

---

### Fase B3 — Banco e queries ✅ (implementado)

Pool Prisma (`PRISMA_CONNECTION_LIMIT`), `DIRECT_DATABASE_URL` + PgBouncer opcional (profile `pgbouncer`),
UNIQUE parcial `(conversation_id, provider_msg_id)`, índice CRM por `trigger_config->>'type'`,
filtro DB em `dispatchCrmFlowTrigger` para triggers específicos.

| # | Tarefa | Arquivos |
|---|--------|----------|
| B3.1 | Pool URL + directUrl | `prismaDatasourceUrl.ts`, `db.ts`, `schema.prisma` |
| B3.2 | Dedupe wamid por conversa | migration `20260929140000_b3_*` |
| B3.3 | CRM trigger filter no DB | `crmFlowTriggerFilters.ts`, `crmFlowExecutor.ts` |
| B3.4 | PgBouncer compose (opt-in) | `docker-compose.yml`, `.env.example` |

---

### Fase B4 — WebSocket ✅ (implementado)

Rooms por `conversationId` para `message.*` / typing; `conversation.updated` com debounce server-side (350ms).
Cliente subscreve na página de detalhe (`workspace.subscribe`).

| # | Tarefa | Arquivos |
|---|--------|----------|
| B4.1 | Rooms + fallback org | `workspaceHub.ts` |
| B4.2 | Debounce `conversation.updated` | `workspaceConversationUpdatedDebounce.ts` |
| B4.3 | Protocolo WS subscribe | `workspace.ts`, `workspaceSocketSubscribe.ts` |
| B4.4 | Subscrição no detalhe | `ConversationDetailPage.tsx`, `WorkspaceRealtime.tsx` |

---

### Fase B5 — Observabilidade ✅ (implementado)

Sampler de latência (inbound/outbound/prisma), P50/P95 em ring buffers, alertas operacionais
(CPU, event loop lag, fallback fila agent, P95 inbound, backlog), extensão em `/health` e worker health,
dashboard super-admin `GET /message-processing/dashboard`, limites `mem_limit`/`cpus` no compose.

| # | Tarefa | Arquivos |
|---|--------|----------|
| B5.1 | Percentis + ring buffers | `platform-observability/percentile.ts`, `latencySampler.ts` |
| B5.2 | Alertas + thresholds env | `platformAlerts.ts`, `config.ts` |
| B5.3 | Dashboard + health extension | `platformDashboard.ts`, `server.ts`, `backgroundWorkers.ts` |
| B5.4 | Hooks amostragem | `store.ts`, `db.ts` |
| B5.5 | Super route dashboard | `superMessageProcessingMonitor.ts` |
| B5.6 | Limites Docker | `docker-compose.yml`, `.env.example` |
| B5.7 | Testes | `percentile.test.ts`, `platformAlerts.test.ts` |

---

## Trilho A — Latência e throughput

### Fase A0 — Índice `whatsappPhoneNumberId` em Inbox ✅ (implementado)

**Problema:** `findOrganizationByMetaPhoneNumberId` faz `findMany` em todas as inboxes WhatsApp + parse JSON.

**Solução:** coluna indexada + backfill + sync em create/update.

| # | Tarefa | Arquivos |
|---|--------|----------|
| A0.1 | Coluna + índice | `schema.prisma`, migration |
| A0.2 | Backfill migration + script | `backfillInboxWhatsappPhoneNumberId.ts` |
| A0.3 | Sync coluna ao gravar `channelConfig` | `inboxWhatsappConfig.ts`, `inboxes.ts`, `whatsappOrgSync.ts`, … |
| A0.4 | Lookup indexado + fallback JSON | `inboxWhatsappConfig.ts` |
| A0.5 | Testes unitários | `inboxWhatsappConfig.test.ts` |

**Aceite:** lookup p95 < 10ms; zero regressão orgs legadas (Settings fallback mantido).

---

### Fase A1 — Webhook Meta: 200 cedo + fila ✅ (implementado)

Ver [message-latency-roadmap.md](./message-latency-roadmap.md) Fase 1.

---

### Fase A2 — Transcrição assíncrona ✅ (implementado)

Transcrição em paralelo com timeline; bot aguarda com timeout (`INBOUND_TRANSCRIPTION_TIMEOUT_MS`, default 15s).
Flag por bot: `agentEngine.waitForInboundTranscription` (default `true`). WS `message.updated` com `body` após transcrição.

| # | Tarefa | Arquivos |
|---|--------|----------|
| A2.1 | Pipeline paralelo + gate | `inboundTranscriptionPipeline.ts`, `whatsappInboundProcessor.ts`, `channelInboxIngest.ts` |
| A2.2 | `message.updated` com body | `workspaceMessageBroadcast.ts`, web WS |
| A2.3 | Timeout configurável | `config.ts`, `.env.example` |
| A2.4 | Flag `waitForInboundTranscription` | `parseAgentEngineConfig.ts`, `types.ts` |
| A2.5 | Testes | `inboundTranscriptionPipeline.test.ts` |

---

### Fase A4 — Quick wins de latência ✅ (implementado)

Ver [message-latency-roadmap.md](./message-latency-roadmap.md) Fase 4.

---

### Fase A3 — Streaming outbound WhatsApp ✅ (implementado)

`streamingEnabled` activa também `clientOutboundStreamingEnabled` (opt-out explícito).
Chunks ~180 chars com throttle entre envios; sem dupla entrega (`clientStreamDelivered`).
Propagação `onTokenDelta` no path LangGraph/outros runtimes.

| # | Tarefa | Arquivos |
|---|--------|----------|
| A3.1 | Unificar flags streaming | `parseAgentEngineConfig.ts` |
| A3.2 | Rate limit + métricas chunks | `clientOutboundTokenStream.ts`, `config.ts` |
| A3.3 | Propagação runtime + evitar duplo flush | `agentNativeLlm.ts`, `types.ts` |
| A3.4 | UI + i18n aviso várias bolhas | `AgentEnginePanel.tsx`, `messages.ts` |
| A3.5 | Testes | `clientOutboundTokenStream.test.ts`, `agentEngine.test.ts` |

---

## Métricas de sucesso global

| Métrica | Baseline | Alvo |
|---------|----------|------|
| CPU API sob carga webhook | ~300–500% | < 200% (após B1) |
| p95 lookup `phone_number_id` | O(n) inboxes | < 10ms (A0) |
| p95 HTTP 200 webhook Meta | 500ms–5s+ | < 100ms (A1) |
| % fallback síncrono agent queue | alto | < 1% (B0) |

---

## O que NÃO mudar

- Lógica handoff / GATE C18 (sem pedido explícito)
- Prompts e playbooks
- Billing (já deduplicado)
- Path CRM no webhook WhatsApp (análise separada)

---

## Histórico de entregas

| Data | Fase | Commit / notas |
|------|------|----------------|
| 2026-09-28 | Perf 1–4 | Cache per-turn, trace deferral |
| 2026-09-29 | B0 + A0 | Fila agent + índice webhook |
| 2026-09-29 | B1 | PROCESS_ROLE api/worker + docker-compose worker |
| 2026-09-29 | A1 | META_INBOUND_QUEUE_ENABLED + fila BullMQ |
| 2026-09-29 | A2 | Transcrição assíncrona + WS body update |
| 2026-09-29 | B2 | agent-worker + AGENT_ENGINE_CONCURRENCY + rate limit org |
| 2026-09-29 | B3 | Pool Prisma + dedupe wamid + CRM filter DB + PgBouncer profile |
| 2026-09-29 | B4 | WS rooms + debounce conversation.updated |
| 2026-09-29 | B5 | P50/P95 + alertas + dashboard + limites Docker |
| 2026-09-29 | A3 | Streaming outbound WhatsApp + unificação flags |
| 2026-09-29 | A4 | Quick wins: cache bot ctx, timeline async, WS mídia cedo |
