# Checklist pré-produção — Latência e throughput

> Completar antes de canary/produção com tráfego Meta real.  
> Relacionado: [message-latency-roadmap.md](./message-latency-roadmap.md)

---

## 1. Dashboard e SLOs

| Item | Como validar | Alvo |
|------|----------------|------|
| P95 HTTP 200 webhook Meta | `GET /api/v1/super/message-processing/dashboard` → `productionSlo.metaWebhookHttpP95Ms` | < 100ms (com fila) |
| Lag fila meta-inbound | `productionSlo.metaInboundQueueLagP95Ms`, `metaInboundQueue.jobCounts` | p95 < 30s; waiting estável |
| TTFR bot (texto) | `productionSlo.botInboundP95Ms` | baseline + sem regressão |
| Fallback síncrono agent | `productionSlo.agentSyncFallbackRatePercent` | < 1% |
| Retry/dedupe Meta | `productionSlo.metaWebhookRetryRatePercent` | monitorar picos |

**Endpoints:**
- `GET /health` — alertas leves (`observability`)
- `GET /api/v1/super/message-processing/dashboard?windowMinutes=60` — dashboard completo (super-admin JWT)

**Alertas env (ajustar em produção):**
- `PLATFORM_ALERT_META_WEBHOOK_HTTP_P95_MS=500`
- `PLATFORM_ALERT_META_INBOUND_LAG_MS=30000`
- `PLATFORM_ALERT_INBOUND_P95_MS=15000`
- `PLATFORM_ALERT_AGENT_SYNC_FALLBACK_PERCENT=5`

- [ ] Dashboard acessível com super-admin
- [ ] `productionSlo` populado após tráfego de teste
- [ ] Alertas documentados no monitoramento externo (opcional: scrape `/health`)

---

## 2. Runbook operacional

- [ ] Equipa leu [production-runbook-latency.md](./production-runbook-latency.md)
- [ ] Procedimento Redis down testado em staging
- [ ] Procedimento worker restart documentado no deploy

---

## 3. Feature flags (staging → produção)

Copiar bloco **Message latency** de [.env.example](../.env.example).

| Fase | Variável | Produção recomendada |
|------|----------|---------------------|
| B0 | `AGENT_ENGINE_EXECUTION_QUEUE_ENABLED=true` | ✅ |
| B1 | `PROCESS_ROLE=api` + serviço `worker` | ✅ |
| A1 | `META_INBOUND_QUEUE_ENABLED=true` | ✅ após Redis OK |
| A2 | `INBOUND_TRANSCRIPTION_TIMEOUT_MS=15000` | ✅ default |
| A3 | streaming por bot (`streamingEnabled`) | opt-in |
| A4 | `AGENT_BOT_DISPATCH_CONTEXT_CACHE_TTL_MS=60000` | ✅ |
| A4 | `INBOUND_MEDIA_DEFER_DOWNLOAD_ENABLED` | canary opt-in |
| B3 | `DIRECT_DATABASE_URL`, `PRISMA_CONNECTION_LIMIT` | ✅ |
| B5 | `PLATFORM_ALERT_*` | ✅ |

- [ ] `.env` produção revisado contra `.env.example`
- [ ] Rollback flags testados em staging (secção 4 do runbook)

---

## 4. Teste de carga (webhook Meta)

```bash
cd apps/api
node scripts/load-test-meta-inbound-webhook.mjs \
  --url "https://<host>/webhooks/whatsapp/<orgId>/<inboxId>" \
  --phone-number-id "<meta_phone_number_id>" \
  --rps 10 --duration 30
```

Pré-requisitos: `META_INBOUND_QUEUE_ENABLED=true`, Redis + worker up.

- [ ] p95 HTTP < 500ms no script (ideal < 100ms em LAN)
- [ ] `metaInboundQueue.jobCounts.waiting` volta a ~0 após teste
- [ ] Sem explosão de `enqueueFailedCount` no dashboard
- [ ] CPU API estável (`docker stats`) com `PROCESS_ROLE=api`

---

## 5. Validação conta Meta real

Checklist manual (não automatizável no CI):

- [ ] Webhook aponta para URL pública correta (`/webhooks/whatsapp/...` ou embedded)
- [ ] `phone_number_id` indexado na inbox (Fase A0)
- [ ] Mensagem texto: aparece na UI + bot responde
- [ ] Mensagem áudio: transcrição + bot (timeout A2)
- [ ] Status delivered/read não bloqueia inbound
- [ ] Retry Meta (modo avião 30s): **sem** mensagem duplicada no thread
- [ ] Streaming outbound (se activo): várias bolhas, sem texto duplicado no final

---

## 6. Deploy

- [ ] `npx prisma migrate deploy` (índices A0, dedupe B3)
- [ ] `docker compose up -d api worker` (ou `split-agent` se B2)
- [ ] Health checks verdes (`api`, `worker`)
- [ ] Smoke: uma mensagem WhatsApp real end-to-end

---

## Histórico

| Data | Ambiente | Responsável | Notas |
|------|----------|-------------|-------|
| | staging | | |
| | produção | | |
