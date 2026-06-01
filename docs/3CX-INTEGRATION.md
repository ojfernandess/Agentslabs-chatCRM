# Integração 3CX (OpenConduit)

Telefonia PABX 3CX no mesmo modelo da integração Wavoip: módulo opt-in por organização, credenciais encriptadas no servidor, chamadas registadas em contactos/conversas.

## Documentação 3CX

- [API de Configuração (XAPI)](https://www.3cx.com.br/docs/configuracao-api-3cx/) — utilizadores, ramais, departamentos (gestão PBX; licença ENT 8SC+).
- [Call Control API](https://www.3cx.com/docs/call-control-api) — iniciar/atender/transferir chamadas, WebSocket de eventos (licença Enterprise 8SC+).
- [CRM Integration](https://www.3cx.com/docs/crm-integration/) — lookup por telefone, journal de chamadas (template no 3CX apontando para o OpenConduit).

## Feature flag

- Chave: `threecx_voice` (Super Admin → Funcionalidades)
- Default: **desativado**
- Com a flag off: rotas `/api/v1/settings/threecx/*`, `/api/v1/threecx/*` e CRM público retornam 403; UI oculta

## Configuração no 3CX (admin PBX)

1. **Integrações → API** — criar aplicação com **Call Control API** e obter Client ID + API Key ([guia](https://www.3cx.com/docs/call-control-api)).
2. Anotar o **DN do route point** da aplicação.
3. **Integrações → CRM** — template personalizado com URLs do OpenConduit (exibidas ao criar o route point em Configurações → 3CX).

Autenticação CRM no OpenConduit: cabeçalho `X-3CX-API-Key` ou `Authorization: Bearer` com a chave CRM gerada no painel.

## API admin

Prefixo: `/api/v1/settings/threecx` (admin + `threecx_voice`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/route-points` | Listar route points |
| POST | `/route-points` | Criar (devolve `crmApiKey` uma vez + URLs CRM) |
| PATCH/DELETE | `/route-points/:id` | Atualizar / remover |
| POST | `/route-points/:id/test` | Testar token + Call Control |
| GET | `/route-points/:id/logs` | Logs de integração |
| GET | `/inboxes` | Caixas para vincular |

## API agente

Prefixo: `/api/v1/threecx` (autenticado + `threecx_voice`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/route-points/available` | Route points CONNECTED acessíveis ao agente |
| POST | `/calls/outbound/start` | Marca chamada + `makecall` no PABX |
| POST | `/calls/outbound/complete` | Fecha registo / timeline |
| GET | `/calls/resolve-context` | Resolve contacto/conversa por telefone |
| GET | `/calls/my-recent` | Histórico do agente |

## API CRM (3CX → OpenConduit)

Base: `{PUBLIC_URL}/integrations/3cx/crm/{organizationId}/{routePointId}`

| Método | Rota | Uso no template 3CX |
|--------|------|---------------------|
| GET | `/lookup/number?number=` | Contact lookup por telefone |
| GET | `/lookup/email?email=` | Contact lookup por email |
| GET | `/search?q=` | Pesquisa de contactos |
| POST | `/journal/call` | Call journaling (corpo JSON com Number, Direction, CallStatus, etc.) |

## Modelo de dados

- `threecx_route_points` — PBX URL, Client ID, API Key (enc), DN, chave CRM (enc), fila de entrada (`externalConfig`)
- `threecx_call_logs` — histórico e ligação a `messages` / timeline (`threecx_call`)
- `threecx_integration_logs` — diagnóstico

## Segurança

- API Key Call Control e chave CRM **nunca** expostas na UI após gravação (AES via `ENCRYPTION_KEY`).
- CRM e rotas de voz validam `organizationId` + feature flag.
- Chamadas outbound executadas **no servidor** (credenciais não vão para o browser).

## UI

- Configurações → **Integração 3CX** (se `threecx_voice` ativo)
- Botão **3CX** em contactos/conversas (se existir route point CONNECTED)
- Eventos WebSocket `threecx.call.incoming` para agentes da fila
