# Integração Nvoip (OpenConduit) — Análise e roadmap

Documentação oficial: [Nvoip API v2 (Apiary)](https://nvoip.docs.apiary.io/)  
Base URL produção: `https://api.nvoip.com.br/v2/`

Este documento mapeia **todos os recursos expostos na API v2** (conforme introdução e referências Apiary) e propõe como integrá-los no OpenConduit como **mais uma opção de telefonia**, no mesmo espírito de `wavoip_voice` (WhatsApp voice) e `threecx_voice` (PABX).

---

## 1. Visão geral da Nvoip

| Área | O que é | Relevância no OpenConduit |
|------|---------|---------------------------|
| **Ligações (PSTN/SIP)** | Click-to-call, status, gravação, histórico | **Núcleo** — paridade com 3CX outbound + timeline |
| **Torpedo de voz** | Mensagem de voz + DTMF (URA simples) | Campanhas / lembretes / confirmações |
| **SMS** | SMS one-way 160 chars | Canal opcional ou complemento a broadcasts |
| **OTP / 2FA** | Códigos por SMS/voz/email | Autenticação (login, convites) — módulo transversal |
| **WhatsApp (templates)** | Envio HSM via instância Nvoip | Só se o tenant usar WA **pela** Nvoip (hoje o CRM já tem inbox Meta/Evolution) |
| **URA** | Listar áudios, menus, filas | Configuração avançada / diagnóstico |
| **Usuários SIP** | Ramais secundários, webphone | Mapear agente → `caller` (ramal) |
| **Sistema** | Saldo, tarifas, DIDs | Painel admin + testes de conexão |

**Diferença crítica vs Wavoip / 3CX**

- **Wavoip**: SDK no browser (`@wavoip/wavoip-api`), ofertas em tempo real, webhooks CALL/DEVICE.
- **3CX**: Call Control API + CRM template + WebSocket de eventos no PBX.
- **Nvoip**: API REST **server-side**; documentação pública descreve **polling** (`GET /calls?callId=`) e histórico; **não há seção de webhooks** na Apiary v2 analisada — inbound em tempo real pode exigir painel Nvoip (webphone), URA com URL externa, ou confirmação com suporte Nvoip.

Recomendação: integração tipo **3CX** (credenciais no servidor, discagem pelo API, UI de “ligar” no CRM), não tipo Wavoip (áudio no browser).

---

## 2. Autenticação

### 2.1 OAuth 2.0 (recomendado)

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/oauth/token` | POST | Gerar `access_token` |
| `/oauth/token` | POST | Refresh (`grant_type=refresh_token`) |
| `/oauth/check_token` | POST | Validar token |

**Gerar token**

- Auth: `Basic` (credencial fixa documentada na Apiary)
- Content-Type: `application/x-www-form-urlencoded`
- Body: `username=<numbersip>&password=<user-token>&grant_type=password`

**Resposta**: `access_token`, `refresh_token`, `expires_in` (~86400s), `scope`.

**Headers nas chamadas**

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

### 2.2 Napikey (alternativa)

Query: `?napikey=<napikey>` em endpoints que suportam (SMS, algumas consultas, URA list).

**Painel Nvoip** (Configurações → API): `numbersip`, `user-token`, `napikey`.

### 2.3 Modelo no OpenConduit

Por organização (`nvoip_accounts`):

- `numbersip` (identificador da conta)
- `userTokenEnc` / `napikeyEnc` (AES, `ENCRYPTION_KEY`)
- `accessTokenEnc`, `refreshTokenEnc`, `tokenExpiresAt`
- Job de refresh antes de expirar
- **Nunca** enviar tokens ao browser

---

## 3. Recursos da API — inventário completo

### 3.1 Ligações (telefonia CRM)

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/calls/` | POST | OAuth | Iniciar chamada (`caller`, `called`) → `callId` |
| `/calls` | GET | OAuth / Napikey | Status (`calling_origin`, `established`, `finished`, …), `linkAudio`, durações |
| `/endcall` | GET | OAuth | Encerrar (`callId`) |
| `/calls/history` | GET | OAuth | Histórico (`type`: inbound/outbound, `date`: today/yesterday) |

**Estados documentados**: `calling_origin`, `calling_destination`, `established`, `noanswer`, `busy`, `finished`, `failed`.

**OpenConduit**

- Outbound: botão “Nvoip” em contacto/conversa → `POST /api/v1/nvoip/calls/outbound/start` → proxy `POST /calls/`.
- Polling: worker ou intervalo no cliente até `finished` / `failed` → `POST .../complete` + mensagem na timeline (`nvoip_call`).
- Gravação: `linkAudio` → `recordUrl` no call log (como Wavoip/3CX).
- Inbound: **Fase 2** — sync periódico de `/calls/history?type=inbound` + deduplicação por `callId`; screen pop ao detectar chamada nova para agente com ramal correspondente.

### 3.2 Torpedo de voz (voice broadcast)

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/torpedo/voice` | POST | OAuth | Disparo com `audios[]` (TTS/texto) e `dtmfs[]` (captura dígitos) |
| `/sched/torpedo` | POST | OAuth | Agendar torpedo |
| `/update/sched/torpedo` | PUT | OAuth | Atualizar agendamento |
| `/list/sched/torpedo` | GET | OAuth / Napikey | Listar agendados |
| `/get/sched/torpedo` | GET | OAuth / Napikey | Detalhe (`schedkey`) |
| `/delete/sched/torpedo` | DELETE | OAuth | Cancelar (`schedkey`) |

**OpenConduit**

- Alinhar com **Broadcasts** / campanhas de voz (novo tipo `VOICE_NVOIP`).
- Fluxos com DTMF → automações (tags, estágio CRM) via regras pós-callback (se Nvoip expuser resultado; senão polling).

### 3.3 SMS

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/sms` | POST | OAuth / Napikey | SMS até 160 chars, sem acentos, `flashSms` opcional |

**OpenConduit**

- Opcional: provedor SMS em Settings ou envio pontual em contacto.
- **Não** substituir inbox WhatsApp; canal paralelo para OTP/notificações.

### 3.4 OTP

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/otp` | POST | OAuth / Napikey | Enviar código (sms/voice/email) → `key` |
| `/check/otp` | GET | — | Validar (`code`, `key`) — validar auth real em homologação |

**OpenConduit**

- Login, reset password, verificação de telefone do contacto.
- Abstração `OtpProvider` com implementação Nvoip.

### 3.5 2FA

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/2fa` | POST | OAuth | Enviar PIN → `token2fa` |
| `/check/2fa` | GET | OAuth / Napikey? | Validar `token2fa` + `pin` |

**OpenConduit**

- 2FA para utilizadores admin/agente (opcional por org).

### 3.6 WhatsApp (via Nvoip)

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/wa/listTemplates` | GET | OAuth | Templates aprovados Meta |
| `/wa/sendTemplates` | POST | OAuth | Enviar HSM (`idTemplate`, `destination`, `instance`, `language`, `functions`) |

**OpenConduit**

- **Só** se feature `nvoip_whatsapp` e tenant sem inbox Meta próprio.
- Caso contrário, manter inbox existente; evitar duplicar canal.

### 3.7 URA

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/ura/list` | GET | Napikey | Áudios, menus, horários, usuários, filas (`numbersip`, `napikey`) |

**OpenConduit**

- Painel read-only em Settings → Nvoip (diagnóstico).
- Edição de URA continua no painel Nvoip.

### 3.8 Usuários (ramais secundários)

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/users` | POST | OAuth | Criar usuário secundário (conta primária) |
| `/list/users` | GET | OAuth / Napikey | Listar |
| `/get/users` | GET | OAuth / Napikey | Por `numbersip` |
| `/update/users` | PUT | OAuth | Nome, `sipPassword`, `blocked`, `webphone` |
| `/delete/users` | DELETE | OAuth | Remover |

**OpenConduit**

- Mapear `User` OpenConduit ↔ ramal Nvoip (`caller` em `POST /calls/`).
- Sincronização opcional na criação de agente.

### 3.9 Sistema

| Endpoint | Método | Auth | Função |
|----------|--------|------|--------|
| `/balance` | GET | OAuth | Saldo |
| `/list/rates` | GET | OAuth / Napikey | Tarifas |
| `/list/dids` | GET | OAuth / Napikey | Números virtuais |
| `/update/dids` | PUT | OAuth | Destino do DID (IP/domínio URA) |

**OpenConduit**

- Teste de conexão em Settings (como 3CX “test”).
- Alerta de saldo baixo (Super Admin / email).

---

## 4. Arquitetura proposta no OpenConduit

### 4.1 Feature flags

| Chave | Default | Escopo |
|-------|---------|--------|
| `nvoip_voice` | `false` | Ligações, torpedo, histórico, UI telefonia |
| `nvoip_otp` | `false` | OTP/2FA (opcional, pode ser só admin) |
| `nvoip_sms` | `false` | Envio SMS API |
| `nvoip_whatsapp` | `false` | Templates WA via Nvoip (raro) |

Super Admin → mesma grelha de flags que `wavoip_voice` / `threecx_voice`.

### 4.2 Modelo de dados (Prisma)

Espelhar `threecx_*` / `wavoip_*`:

```
nvoip_accounts          -- credenciais OAuth por org (numbersip, tokens enc)
nvoip_trunks            -- opcional: múltiplos "perfis" por org (nome, caller default)
nvoip_agent_extensions  -- userId, sipCaller (ex: "1049"), nvoip_numbersip secundário?
nvoip_call_logs         -- callId externo, direction, status, recordUrl, contact, conversation, message
nvoip_integration_logs  -- auditoria API
nvoip_scheduled_torpedos -- campanhas agendadas (schedkey, estado)
```

Enums: `NvoipCallStatus` alinhado aos estados API; `NvoipAccountStatus` CONNECTED/DISCONNECTED/ERROR após teste.

### 4.3 API interna

**Admin** — `/api/v1/settings/nvoip` (`requireAdmin` + `nvoip_voice`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/account` | Conta configurada (sem segredos) |
| PUT | `/account` | Gravar numbersip + user-token / napikey |
| POST | `/account/test` | OAuth + GET `/balance` |
| GET | `/extensions` | Listar ramais (`/list/users`) |
| PUT | `/extensions/:userId` | Associar agente ↔ caller |
| GET | `/calls/logs` | Logs integração |
| GET | `/balance` | Saldo |
| GET | `/dids` | DIDs |
| GET | `/ura` | Snapshot URA |

**Agente** — `/api/v1/nvoip` (`authenticate` + `nvoip_voice`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/session` | Ramais disponíveis para o agente |
| POST | `/calls/outbound/start` | Discar + screen pop CRM |
| POST | `/calls/outbound/complete` | Finalizar + timeline |
| GET | `/calls/resolve-context` | Telefone → contacto/conversa |
| GET | `/calls/:callId/status` | Proxy status Nvoip |
| POST | `/calls/:callId/end` | Proxy `/endcall` |
| GET | `/calls/my-recent` | Histórico do agente |

**Webhooks** (se Nvoip fornecer URL de eventos — confirmar com suporte)

- `POST /webhooks/nvoip/:organizationId` — normalizar eventos de chamada; senão job `nvoipCallSyncJob` a cada N segundos.

### 4.4 Frontend

| Peça | Descrição |
|------|-----------|
| `NvoipVoiceShell` | Sem SDK browser; opcional badge “chamada ativa” por polling |
| `NvoipCallButton` | Em contacto/conversa (como `ThreeCxCallButton`) |
| `NvoipActiveCallBar` | Status + duração + desligar |
| Settings → **Integração Nvoip** | Credenciais, teste, mapeamento ramais, saldo |
| Super Admin | Flag `nvoip_voice` |
| i18n | `nvoip.*` em `messages.ts` |
| Conversas / auditoria | Tipo `nvoip_call` na timeline e audit (como `threecx_call`) |

### 4.5 Bibliotecas de referência

- SDK Python oficial: [pypi.org/project/nvoip](https://pypi.org/project/nvoip/) — útil para validar payloads em homologação.
- Web SDK (popup OTP): repositório `nvoip-web-sdk` — só se OTP no browser for requisito.

Implementação OpenConduit: cliente HTTP TypeScript em `apps/api/src/lib/nvoipClient.ts` (fetch + refresh token).

---

## 5. Mapeamento funcional × concorrentes no produto

| Funcionalidade | Wavoip | 3CX | Nvoip (proposto) |
|----------------|--------|-----|------------------|
| Discar do CRM | Sim (SDK) | Sim (API servidor) | Sim (`POST /calls/`) |
| Atender no browser | Sim | Via softphone 3CX | Webphone Nvoip ou telefone |
| Chamada recebida screen pop | Webhook + SDK | CRM journal + WS | Polling histórico / webhook TBD |
| Gravação na timeline | Sim | Sim | `linkAudio` |
| Fila equipe / assignee | Sim | Sim (`incomingQueue`) | `externalConfig` igual |
| WhatsApp voz | Sim | Não | Não (PSTN) |
| Campanha voz em massa | Não | Não | Torpedo + agendamento |
| SMS | Não | Não | `/sms` |
| OTP login | Não | Não | `/otp`, `/2fa` |

---

## 6. Roadmap de implementação

### Fase 1 — MVP telefonia (2–3 sprints)

- [x] Flag `nvoip_voice`, migration Prisma, `nvoipClient` + refresh OAuth
- [x] Settings: credenciais, teste, saldo (`/settings?section=nvoip`)
- [x] Outbound: start / poll status / complete / timeline
- [x] `NvoipCallButton` + barra de chamada ativa (`NvoipVoiceShell`)
- [x] `docs/NVOIP-INTEGRATION.md` (rebuild **api + web** após deploy; ver `EASYPANEL.md`)

### Fase 2 — Inbound e histórico

- [x] Job sync `/calls/history` (inbound) — `runNvoipHistorySyncTick` a cada 90s
- [x] Screen pop + WS `nvoip.call.incoming` (ramal do agente → `targetUserIds`)
- [x] Conversation audit `recordType: nvoip_call`
- [x] Gravação `linkAudio` → `recordUrl` + mensagem `AUDIO` na timeline da conversa

### Fase 3 — Torpedo e campanhas

- [x] API torpedo (`POST /torpedo/voice`) + listagem agendados + teste em Settings
- [x] Campanhas **Broadcasts** canal `VOICE` → torpedo por destinatário
- [x] DTMF → `POST /webhooks/nvoip/:orgId/dtmf/:dispatchId` (etiqueta / estágio CRM)

### Fase 4 — Ramais e DID

- [x] Sync `/list/users`, mapeamento agente (`POST /settings/nvoip/users/sync`, cache `nvoip_sip_users`, dropdown em ramais por agente)
- [x] Listagem DIDs read-only (`GET /settings/nvoip/dids`) + link painel Nvoip; `GET /settings/nvoip/balance` para atualizar saldo

### Fase 5 — SMS / OTP / 2FA (transversal)

- [x] Provedor OTP configurável por org (`otpProvider` / `otpDefaultChannel` na conta; `OtpProvider` + `NvoipOtpProvider`)
- [x] SMS pontual em contacto (`POST /contacts/:id/nvoip/sms`, flag `nvoip_sms`, timeline `nvoip_sms`)
- [x] OTP contacto (`POST .../otp/send|verify`), testes admin, 2FA agente (`/api/v1/nvoip/security/2fa/*`)

### Fase 6 — WhatsApp Nvoip (opcional)

- [x] Flag `nvoip_whatsapp`; bloqueio se caixa WhatsApp Meta/360dialog configurada
- [x] `GET /wa/listTemplates`, `POST /wa/sendTemplates` (settings + contacto); `waInstance` na conta

### Fase 7 — URA e relatórios

- [x] Painel diagnóstico URA (`GET /settings/nvoip/ura`, resumo read-only em Settings)
- [x] Relatório org (`GET /settings/nvoip/insights`) — volume, tarifas, custo estimado
- [x] Métricas Super Admin (`GET /super/nvoip/metrics`, diagnóstico em feature-flags)

---

## 7. Riscos e dependências

1. **Sem webhooks documentados** — inbound em tempo real pode ficar atrás de Wavoip/3CX até haver callback oficial.
2. **Caller = ramal SIP** — cada agente precisa de extensão Nvoip ou caller partilhado (definir regra de negócio).
3. **Limites 429** — rate limit na API; filas e backoff no `nvoipClient`.
4. **SMS sem acentos** — normalização de texto no envio.
5. **Homologação** — conta teste com crédito inicial (R$ 5,00 mencionado no site); validar `GET /check/otp` e `DELETE /users` (URLs inconsistentes na doc — testar antes de produção).
6. **Custo** — chamadas/SMS debitam saldo Nvoip; exibir saldo no Settings.

---

## 8. Checklist homologação com Nvoip

- [ ] Confirmar existência de **webhooks** para `established` / `finished` / inbound
- [ ] Confirmar formato internacional de `called` (DDI+DDD+número)
- [ ] Validar se `caller` deve ser `numbersip` ou ramal secundário
- [ ] Testar refresh token em produção
- [ ] Política de gravação e retenção de `linkAudio` (LGPD)
- [ ] Licenciamento WhatsApp template (`instance` Meta)

---

## 9. Referências

- [Nvoip API v2 — Apiary](https://nvoip.docs.apiary.io/)
- [Introdução / SMS / chamadas](https://nvoip.docs.apiary.io/reference/sms) (contém quickstart completo)
- [API Voice and SMS (site)](https://www.nvoip.com.br/en/api-voice-sms/)
- [OpenConduit — Wavoip](./WAVOIP-INTEGRATION.md)
- [OpenConduit — 3CX](./3CX-INTEGRATION.md)
