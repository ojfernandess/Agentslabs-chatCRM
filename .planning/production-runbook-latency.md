# Runbook — Latência e filas (OpenConduit)

> Operações para incidentes após deploy das fases A0–A4 / B0–B5.

---

## Sintomas rápidos

| Sintoma | Verificar primeiro |
|---------|-------------------|
| Meta reenvia webhooks / duplicatas | `metaInboundQueue.metrics.enqueueDuplicateCount`, dedupe Redis |
| HTTP 200 lento no webhook | `productionSlo.metaWebhookHttpP95Ms`, CPU API |
| Mensagens atrasadas na UI | `metaInboundQueue.jobCounts`, worker logs |
| Bot não responde | `agentEngineQueue.metrics.syncFallbackRatePercent`, Redis |
| CPU API alta | `PROCESS_ROLE=api` sem workers; filas no mesmo processo |

---

## 1. Redis indisponível

**Efeito:** filas BullMQ caem; fallback síncrono no HTTP (webhook Meta segura conexão).

**Diagnóstico:**
```bash
curl -s http://localhost:3000/health | jq '.agentEngineQueue,.observability'
docker compose ps redis
docker compose logs redis --tail 50
```

**Mitigação imediata:**
1. Restaurar Redis (`docker compose up -d redis`).
2. Reiniciar `api` e `worker` (reconectam filas).
3. Se urgente: `META_INBOUND_QUEUE_ENABLED=false` + `AGENT_ENGINE_EXECUTION_QUEUE_ENABLED=false` (rollback — aumenta CPU API).

**Pós-incidente:** confirmar `queueOperational: true` no dashboard super-admin.

---

## 2. Worker preso / backlog

**Diagnóstico:**
```bash
curl -s -H "Authorization: Bearer $SUPER_JWT" \
  "$PUBLIC_URL/api/v1/super/message-processing/dashboard" | jq '.metaInboundQueue,.agentEngineQueue,.productionSlo'
docker compose logs worker --tail 100 | grep -E "meta inbound|agent-engine|failed"
```

Métricas:
- `metaInboundQueue.jobCounts.waiting` — fila Meta inbound
- `metaInboundQueue.jobCounts.failed` — jobs mortos (investigar stack nos logs)
- `productionSlo.metaInboundQueueLagP95Ms` — lag enqueue → processamento

**Mitigação:**
1. Escalar workers: `docker compose up -d --scale worker=2` (se compose suportar) ou subir `agent-worker` profile `split-agent`.
2. Aumentar `AGENT_ENGINE_CONCURRENCY` no agent-worker.
3. Reiniciar worker com jobs stalled: BullMQ retenta até `attempts` (meta-inbound: 3).

---

## 3. Replay de jobs Meta inbound

Jobs usam idempotência por `wamid` (Redis + UNIQUE DB). **Reenviar o mesmo payload Meta é seguro** (dedupe).

Para reprocessar mensagem perdida:
1. Identificar `wamid` nos logs: `grep wamid worker`.
2. Se job em `failed` no BullMQ: usar Bull Board / `redis-cli` ou re-post do webhook de teste com novo `wamid` se for simulação.

**Não** apagar dedupe Redis em massa sem coordenação — pode criar duplicatas na BD.

---

## 4. Rollback por feature flag

| Flag | Rollback |
|------|----------|
| `META_INBOUND_QUEUE_ENABLED=false` | Webhook Meta síncrono (path legado) |
| `AGENT_ENGINE_EXECUTION_QUEUE_ENABLED=false` | Bot inline no worker/API |
| `INBOUND_MEDIA_DEFER_DOWNLOAD_ENABLED=false` | Download mídia antes do WS |
| `CLIENT_OUTBOUND_STREAMING_ALLOWED=false` | Desliga streaming WhatsApp global |
| `PROCESS_ROLE=all` | Monolito (dev/emergência) |

Alterar `.env` → `docker compose up -d api worker` (rebuild se necessário).

---

## 5. Logs úteis

```bash
# Early 200 + tempo HTTP
docker compose logs api | grep "Meta inbound webhook enqueued"

# Lag fila
docker compose logs worker | grep "meta inbound queue job completed"

# Fallback agent
docker compose logs api worker | grep "sync fallback"
```

---

## 6. Contactos / escalação

- Dashboard: Super Admin → Message Processing Monitor (ou `GET /api/v1/super/message-processing/dashboard`)
- Health: `GET /health` (role, observability, agentEngineQueue)
- Plano arquitetural: [architecture-correction-plan.md](./architecture-correction-plan.md)
