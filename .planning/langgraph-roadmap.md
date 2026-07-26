# Roadmap LangGraph — OpenNexo Agent Engine

> Atualizado: 2026-07-26  
> Princípio: **evolução incremental**, retrocompatibilidade, baixo risco.

---

## Legenda de status

| Símbolo | Significado |
|---------|-------------|
| ✅ | Concluído |
| 🚧 | Em implementação |
| 📋 | Planejado |
| ⏸️ | Adiado (dependência externa ou alto risco) |
| 🔒 | Legacy — manter compatível, não substituir |

---

## Fase 0 — Auditoria (concluída)

| Item | Status |
|------|--------|
| Mapeamento StateGraph 8 nós | ✅ |
| Execution Supervisor estrutural (9 checks) | ✅ |
| Integração LLM supervisor → LangGraph | ✅ |
| Fix routing `routeAfterSupervisor` | ✅ |
| `executeViaAgentEngineWithResult()` | ✅ |
| Timeout grafo 120s | ✅ |
| Bloqueio resposta após retries (strict) | ✅ |

---

## Fase 1 — Melhorias sugeridas (baixo risco) ✅ concluída

### 1.1 Indexação KB — chunk agregado `##` + `###`

**Problema:** Secções pai vazias com subsecções `###` indexadas separadamente → vector search falha em catálogos (quartos, planos, produtos).

**Solução:** Reutilizar `aggregateH2WithChildH3Sections` em `chunkMarkdownSections` (indexação).

| Tarefa | Status |
|--------|--------|
| Agregar `###` filhos no chunking de indexação | ✅ |
| Teste Brooklin / catálogo multi-suíte | ✅ |
| Reindexar artigos existentes (operação manual/admin) | ✅ |

**Risco:** Baixo — mesma lógica já validada em `extractMarkdownSectionForQuery`.

---

### 1.2 Eventos estruturados do grafo (observabilidade)

**Problema:** Trace só tinha nós; faltavam eventos tipados (start/end/edge/retry/checkpoint/stream).

**Solução:** `AgentGraphEvent` + `ExecutionTraceBuilder.emitEvent()`.

| Tarefa | Status |
|--------|--------|
| Tipos `AgentGraphEvent` | ✅ |
| Emissão em LangGraphRuntime | ✅ |
| Expor eventos no inspector (`observability: full`) | ✅ |

**Risco:** Baixo — additive only.

---

### 1.3 Checkpoint — abstração + factory

**Problema:** `MemorySaver` in-memory; sem resume operacional nem persistência.

**Solução:** `createAgentGraphCheckpointer(kind)` — `memory` (default) | `redis` (fallback memory até adapter).

| Tarefa | Status |
|--------|--------|
| `AgentCheckpointFactory.ts` | ✅ |
| Config `checkpointStore` em `agentEngine` | ✅ |
| `graph.getState()` para debug/resume scaffold | ✅ |
| API `GET /agent-engine/checkpoint/:conversationId/:messageId` | ✅ |
| Registry partilhado por org | ✅ |
| Adapter Redis (`@langchain/langgraph-checkpoint-redis`) | ✅ ShallowRedisSaver + fallback mirror |
| Mirror JSON em Redis (plain ioredis) | ✅ |

**Risco:** Baixo com default `memory` (comportamento actual).

---

### 1.4 Streaming LangGraph

**Problema:** Só `graph.invoke()` — sem eventos parciais para UI.

**Solução:** `streamingEnabled` → `graph.stream()` + log por nó no `executionLog`.

| Tarefa | Status |
|--------|--------|
| Stream mode em LangGraphRuntime | ✅ |
| Config + toggle UI (runtime langgraph) | ✅ |
| SSE/WebSocket para frontend live | ✅ (SSE) |

**Risco:** Baixo — opt-in, fallback invoke.

---

### 1.5 Human-in-the-Loop (scaffold)

**Problema:** Sem aprovação humana antes de enviar respostas reprovadas pelo supervisor.

**Solução:** `HumanInTheLoopStore` in-memory + API approve/reject + config `humanInTheLoopEnabled`.

| Tarefa | Status |
|--------|--------|
| Store + rotas API | ✅ |
| Registo pending quando supervisor reprova + HITL on | ✅ |
| UI fila de aprovações | ✅ |
| LangGraph `interrupt()` nativo | ✅ |

**Risco:** Baixo — opt-in; default off.

---

### 1.6 Unificar supervisores (LLM + estrutural)

**Problema:** Dois supervisores (agentNativeLlm + LangGraph) sem coordenação clara.

**Solução:** Modo configurável `supervisorMode: structural | llm | both` (default `both` quando enabled).

| Tarefa | Status |
|--------|--------|
| Propagar `llmSupervisorApproved` ao grafo | ✅ |
| Flag `supervisorMode` | ✅ |
| Evitar double LLM call quando só structural | ✅ |

**Risco:** Médio — requer testes de regressão em strict mode.

---

### 1.7 Langfuse / OpenTelemetry

| Tarefa | Status |
|--------|--------|
| Spans por nó LangGraph | ✅ |
| Export tokens/tools para Langfuse | ✅ |
| Config `LANGFUSE_*` em `.env.example` | ✅ |

**Risco:** Baixo — sidecar observability.

---

### 1.8 Queue / Scheduler

| Tarefa | Status |
|--------|--------|
| Fila BullMQ/Redis para execuções longas | ✅ |
| Prioridade por conversa VIP (URGENT/HIGH) | ✅ |
| Fallback síncrono se Redis indisponível | ✅ |

**Risco:** Médio — opt-in via `executionQueueEnabled`; default off.

---

## Fase 2 — Funcionalidades avançadas ✅ concluída (exc. 2.1/2.2 adiados)

### 2.1 Multi-Agent real (CrewAI / AutoGen SDK)

| Estado | Notas |
|--------|-------|
| 🔒 Legacy wrappers | `CrewAIRuntime`, `AutoGenRuntime` mantidos como orquestração interna |
| ⏸️ SDK externo | Requer deps + isolamento; criar `crewai-v2` runtime separado |

**Incompatibilidade:** Substituir wrappers quebraria configs existentes → **nova implementação paralela**.

---

### 2.2 Parallel Execution nativa LangGraph

| Estado | Notas |
|--------|-------|
| ⏸️ | Tool rounds paralelos exigem refactor de `generateNativeAgentReplyCore` |
| ✅ | Avaliar `Send` API LangGraph — ver `.planning/langgraph-send-api-evaluation.md` |
| 📋 | POC `parallelKbPrefetch` (Send × artigos pinned) | ✅ |

---

### 2.3 Commands / HITL / Resume operacional (LangGraph nativo)

| Tarefa | Status |
|--------|--------|
| Scaffold API HITL + checkpoint GET | ✅ |
| HITL persistência Redis (ioredis) | ✅ |
| Checkpoint mirror JSON em Redis | ✅ |
| `interrupt()` + nó `human_review` | ✅ |
| Resume via `Command` após aprovação | ✅ |
| Approve → entrega mensagem ao cliente | ✅ |
| Config `humanInTheLoopNativeEnabled` + UI | ✅ |
| `@langchain/langgraph-checkpoint-redis` full | ✅ ShallowRedisSaver (opt-in `checkpointStore: redis` + Redis Stack) |

---

### 2.4 Graph-level streaming para cliente final

| Tarefa | Status |
|--------|--------|
| Backend stream logs | ✅ |
| SSE `GET /agent-engine/events/stream/:threadId` | ✅ |
| Redis pub/sub cross-worker | ✅ |
| 📋 WhatsApp/Web chat token streaming | ✅ chunks outbound (`clientOutboundStreamingEnabled`) |
| ✅ Token streaming LLM → event bus SSE | `clientTokenStreamingEnabled` |
| Inspector SSE live (execuções RUNNING) | ✅ |

---

## Fase 3 — Queue + streaming cliente ✅ concluída

| Item | Status |
|------|--------|
| 1.8 BullMQ `agent-engine-replies` | ✅ |
| 2.4 Token SSE (Inspector) | ✅ |
| 2.4 WhatsApp token/chunk outbound | ✅ (`clientOutboundStreamingEnabled`) |
| 2.2 Send API POC KB parallel | ✅ (`parallelKbPrefetchEnabled`) |

---

## Fase 4 — Checkpoint Redis nativo ✅ concluída

| Item | Status |
|------|--------|
| `ShallowRedisSaver` cross-worker resume | ✅ |
| Fallback MemorySaver + mirror JSON | ✅ |
| `GET /agent-engine/redis/status` → `redisStackCheckpoint` | ✅ |

### 2.5 Cancelamento AbortSignal no grafo

| Estado | Notas |
|--------|-------|
| ✅ Timeout 120s | Alternativa implementada |
| ⏸️ AbortSignal | LangGraph JS limitado; avaliar por versão |

---

## Cronograma sugerido

```
2026-Q3  Fase 1.1–1.5  (indexação, eventos, checkpoint factory, stream, HITL scaffold)
2026-Q3  Fase 1.6–1.7  (supervisor unificado, Langfuse)
2026-Q4  Fase 1.8 + 2.3 (queue, checkpoint Redis, HITL nativo)
2027-Q1  Fase 2.1–2.2  (multi-agent SDK, paralelismo)
```

---

## Critérios de done por fase

- [x] Testes unitários passam (`agentEngine`, `supervisor`, `knowledgeMarkdownChunking`)
- [x] Default `runtime: openconduit` inalterado
- [x] Novas flags opt-in com default conservador
- [x] Documentação em `.planning/langgraph-roadmap.md` actualizada
- [x] Sem alteração de APIs públicas CRM (só extensões additive)

---

## Referências

- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)
- [LangGraph Docs](https://langchain-ai.github.io/langgraph/)
- Auditoria interna: conversa 2026-07-26 (Execution Supervisor + LangGraphRuntime)
