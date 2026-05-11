# Logs de execução da Automação (estilo pipeline / n8n)

## Visão geral

Cada **execução** representa um fluxo completo tratado pelo motor de automação (por exemplo, uma mensagem inbound do agente nativo no WhatsApp). Cada execução tem um **`executionId`** (UUID) e várias **entradas de log** ordenadas por `sequence`, com:

- **Nível**: `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`
- **`nodePath` / `nodeId` / `nodeName`**: posição hierárquica no fluxo (ex.: `native_agent/agent_llm/tools/buscar_conhecimento`)
- **`message`**: texto legível
- **`inputContext` / `outputContext`**: JSON truncado (~48 KB) com contexto de entrada/saída
- **`stackTrace`**: opcional, para erros

A escrita na tabela `automation_execution_log_entries` é **assíncrona em batch** (buffer global + flush periódico e ao encerramento da execução).

## Modelo de dados (Prisma)

- `AutomationExecution` — cabeçalho da execução (`status`: `running` | `success` | `error`, `workflowKey`, `botId`, `conversationId`, `triggerMessageId`, tempos).
- `AutomationExecutionLogEntry` — linhas de log (FK `executionId`, `sequence`, nível, nós, JSON, stack).
- `AutomationExecutionLogSettings` — por organização: `retentionDays`, `minPersistLevel`, `alertWebhookUrl`, `alertEmail`, `alertMinLevel`.

Migração: `apps/api/prisma/migrations/20260525120000_automation_execution_logs/migration.sql`

## API REST (JWT admin da organização)

Prefixo: `/api/v1/automation`

| Método | Caminho | Descrição |
|--------|---------|-------------|
| GET | `/execution-logs` | Lista execuções. Query: `from`, `to` (ISO-8601), `workflowKey`, `level`, `executionId`, `botId`, `limit` (1–200), `offset`. |
| GET | `/execution-logs/:id` | Detalhe + `logEntries` ordenados. |
| GET | `/execution-logs/:id/export?format=json\|csv` | Exportação (ficheiro anexo). |
| GET | `/execution-logs/settings` | Lê configuração (valores por omissão se ainda não existir linha). |
| PATCH | `/execution-logs/settings` | Actualiza retenção / níveis / webhook / email (admin). |

### Exemplo: listar últimas execuções com erro

```http
GET /api/v1/automation/execution-logs?level=ERROR&limit=50&offset=0
Authorization: Bearer <jwt>
```

### Webhook de alerta

Quando uma entrada persistida tem severidade ≥ `alertMinLevel` (por omissão `ERROR`), o servidor envia um **POST JSON** assíncrono para `alertWebhookUrl`:

```json
{
  "event": "automation.execution.alert",
  "organizationId": "…",
  "executionId": "…",
  "level": "ERROR",
  "message": "…",
  "nodeName": "…",
  "nodePath": "…",
  "timestamp": "2026-05-11T22:00:00.000Z"
}
```

**Email**: o campo `alertEmail` é aceite na API; o envio SMTP **não** está ligado — verá uma linha `info` no log do servidor a indicar que a integração está pendente. Use webhook ou estenda o serviço.

## Rotação / retenção

O job `purgeOldAutomationExecutionLogs` corre **a cada 6 horas** (e uma vez no arranque) e apaga execuções com `startedAt` anterior ao cutoff por organização (`retentionDays`, omissão **30** dias se não existir linha em `automation_execution_log_settings`). A remoção em cascata apaga as entradas de log.

## UI

**Automação → Execuções**: filtros, lista, detalhe com `<details>` por entrada (indentação por profundidade de `nodePath`), exportação JSON/CSV, painel de configuração (retenção, nível mínimo persistido, webhook, email, nível mínimo de alerta).

## Integração actual (agente nativo)

O ficheiro `agentBotWebhook.ts` inicia uma execução por mensagem inbound no fallback nativo e passa um `executionLog` a `generateNativeAgentReply` (`agentNativeLlm.ts`), que regista:

- RAG proactivo (tamanho do appendix, erros)
- Chamada LLM + tools (incl. pré/pós cada tool nativa)
- Falhas de geração e detecção de “stall”

## Troubleshooting

| Sintoma | Verificação |
|---------|-------------|
| Nada na UI | Confirme migração aplicada (`npx prisma migrate deploy`). |
| Lista vazia mas tráfego existe | Filtros (datas, `workflowKey`, `botId`). Execuções só são criadas no **fluxo nativo OpenConduit** actualmente. |
| Logs incompletos | `minPersistLevel` nas settings pode estar em `INFO` ou superior — níveis inferiores são descartados antes do buffer. |
| Alertas não chegam | URL HTTPS acessível a partir do contentor da API; timeout 8 s; veja logs `automation execution alert webhook`. |
| Export 404 | `flushAutomationLogBuffer` é chamado antes do export; execução tem de existir na mesma org. |

## Performance

- Buffer global + `createMany` em batch; flush periódico 1 s no worker e agendamento extra após cada entrada (~750 ms).
- JSON de contexto truncado para evitar linhas gigantes no PostgreSQL.

## Testes

- `apps/api/src/lib/automationExecutionLog.test.ts` — ordem de severidade (sem DB).
- `npm run test -w apps/api` inclui este ficheiro.

## Extensão futura

- Ligar **SMTP** ou fila de email a `alertEmail`.
- Propagar `executionLog` a webhooks externos e a ferramentas personalizadas.
- Métricas agregadas (taxa de erro por `workflowKey`) e retenção por caixa de ingestão.
