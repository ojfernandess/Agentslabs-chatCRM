# Integração Wavoip — OpenConduit

Documentação técnica da integração nativa Wavoip no CRM OpenConduit.

## Visão geral

A [Wavoip](https://wavoip.gitbook.io/api) integra **ligações de voz via WhatsApp**. Mensagens de texto e mídia continuam pelos **inboxes WhatsApp** existentes (Meta Cloud API, Evolution, Evolution Go).

| Camada | Responsabilidade |
|--------|------------------|
| Wavoip | Voz, QR de pareamento, webhooks CALL/RECORD/DEVICE |
| Inbox WhatsApp | Mensagens, contatos, conversas de chat |

## Modelo de dados

- `wavoip_devices` — dispositivo por organização (token encriptado, status, inbox vinculado, `externalConfig`, `sipEnabled`, `outboundIntegrations`)
- `wavoip_call_logs` — histórico de chamadas por device
- `wavoip_integration_logs` — auditoria/diagnóstico

Metadados de bridge Evolution em `externalConfig` (JSON): `bridgeSyncedAt`, `bridgeProvisionedAt`, `evolutionWavoipTokenSetAt`, `lastValidation`.

Integrações externas em `outboundIntegrations` (JSON): targets `n8n` e `chatwoot` com `url`, `secret` (encriptado) e `events`.

## Feature flag

- Chave: `wavoip_voice` (Super Admin → Funcionalidades por tenant)
- Default: **desativado** (ativar por organização no Super Admin)
- Quando desativado: rotas admin `/settings/wavoip/*`, rotas agente `/wavoip/*` e shell de voz no browser retornam 403 / ficam ocultos

## API (admin)

Prefixo: `/api/v1/settings/wavoip` (requer admin + `wavoip_voice`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/devices` | Listar dispositivos |
| POST | `/devices` | Criar dispositivo |
| GET/PATCH/DELETE | `/devices/:id` | CRUD (+ `sipEnabled`, `externalConfig`, `outboundIntegrations`) |
| GET | `/metrics` | Métricas de chamadas (últimos 30 dias; query `from`, `to`, `deviceId`) |
| GET | `/devices/:id/status` | Status em cache (webhook DEVICE) |
| GET | `/devices/:id/qr` | URL do QR (`devices.wavoip.com/.../qr-image`) |
| GET | `/devices/:id/sip` | Credenciais SIP para PABX (admin) |
| GET | `/devices/:id/bridge/preview` | Pré-visualizar credenciais do inbox vinculado |
| POST | `/devices/:id/bridge/sync-from-inbox` | Importar URL/API/Instance do inbox Evolution |
| POST | `/devices/:id/bridge/validate` | Validar `connectionState` na Evolution API |
| POST | `/devices/:id/bridge/provision` | Sync + validate + `POST /settings/set/{instance}` (`wavoipToken`) |
| GET | `/devices/:id/logs` | Logs de integração |
| GET | `/devices/:id/calls` | Histórico de chamadas |
| GET | `/inboxes` | Inboxes WhatsApp para vínculo |

## API (atendimento)

Prefixo: `/api/v1/wavoip` (agente autenticado + `wavoip_voice`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/devices/available` | Devices OPEN atribuíveis ao agente |
| GET | `/session` | Tokens para `@wavoip/wavoip-api` (browser) |
| GET | `/devices/:deviceId/sip` | Credenciais SIP (se permitido) |

## Webhook público

```
POST {PUBLIC_URL}/webhooks/wavoip/{organizationId}/{deviceId}
Header: X-Wavoip-Webhook-Secret: {secret gerado na criação}
```

Eventos suportados ([Webhook Beta Wavoip](https://wavoip.gitbook.io/api/webhook-beta.md)):

- **DEVICE** — atualiza status (`CONNECTING`, `OPEN`, etc.) + WS `wavoip.device.updated`
- **CALL** — no primeiro toque (CREATE/RINGING): cria/reabre contacto e conversa **PENDING**, mensagem na timeline, WS `wavoip.call.incoming` + `conversation.updated` (screen pop estilo CRM). Ao encerrar, atualiza a mesma mensagem com duração/estado final.
- **RECORD** — anexa URL de gravação à chamada/conversa

Configure a URL no painel Wavoip: **Integrações > Webhook**.

### Encaminhamento n8n / Chatwoot

Por device, configure `outboundIntegrations` (admin UI ou PATCH). Em cada evento webhook processado, o OpenConduit faz POST assíncrono para os targets habilitados:

| Adapter | Payload | Headers |
|---------|---------|---------|
| **n8n** | `{ source, module, eventType, organizationId, device, payload, emittedAt }` | `Authorization: Bearer {secret}`, `X-OpenConduit-Signature: sha256=…` |
| **Chatwoot** | Formato adapter (`event`, `account`, `contact`, `conversation`, `wavoip`) | Idem |

Falhas são registadas em `wavoip_integration_logs` (`outbound_n8n`, `outbound_chatwoot`).

## Worker em background

`runWavoipStatusSyncTick` (a cada 5 min):

- Alerta devices presos em `CONNECTING` / `BUILDING` / `RESTARTING` (>45 min) → log `status_sync_stale`
- Revalida bridge Evolution (`EXTERNAL_EVOLUTION`) a cada 6 h → log `status_sync_bridge`

Respeita `wavoip_voice` por organização.

## UI

### Fase 1 — Admin
- **Configurações > Integração Wavoip** — gestão de dispositivos
- **`/settings/wavoip/:deviceId/qr`** — ecrã de QR Code e polling de status

### Fase 2 — Atendimento
- **`@wavoip/wavoip-api`** inicializado via `GET /wavoip/session`
- Botão **Ligar** na conversa (`WavoipCallButton`)
- Modal de chamada recebida + barra de chamada ativa
- Toasts WS para chamadas entrantes
- Painel SIP + campos Evolution bridge nas configurações admin

### Fase 3 — Bridge Evolution automatizado
- Dispositivo com modo `EXTERNAL_EVOLUTION` + inbox WhatsApp Evolution vinculado
- **Importar do inbox** — preenche `externalConfig` a partir de `channelConfig` / Settings
- **Validar Evolution** — `GET /instance/connectionState/{instance}`
- **Provisionar bridge** — grava `wavoipToken` do device na Evolution via `POST /settings/set/{instance}` ([Evolution API](https://docs.evolutionfoundation.com.br/evolution-api/set-settings))
- Passo manual final: confirmar **WhatsApp Externo → Evolution** no [painel Wavoip](https://wavoip.gitbook.io/api/dispositivo/vincule-um-whatsapp/whatsapp-externo/evolution.md) (sem API pública documentada)
- Requisito Evolution: coluna `wavoipToken` (Evolution API v2.2.3+ ou [wavoip/evolution-scripts](https://github.com/wavoip/evolution-scripts))

### Fase 4 — Observabilidade e integrações
- **Métricas** — painel admin com totais, taxa de atendimento e breakdown por device (`GET /settings/wavoip/metrics`)
- **Integrações outbound** — webhooks n8n e adapter Chatwoot por device
- **Feature flag** `wavoip_voice` no Super Admin
- **Sync em background** — stale devices + revalidação Evolution

## Segurança

- Token do dispositivo: AES-256-CBC (`encrypt()`), exposto apenas em `/wavoip/session` para agentes autorizados
- API Key Evolution encriptada em `externalConfig`
- Segredos de webhook outbound encriptados em `outboundIntegrations`
- Webhook secret por device, validado no header
- Devices filtrados por `assignedUserId` (null = todos os agentes)
- Uma instância Evolution por device Wavoip (validação anti-conflito)
