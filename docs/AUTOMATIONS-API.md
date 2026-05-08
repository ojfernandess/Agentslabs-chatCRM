# Automations API (Tenant)

These endpoints support CRM/chat automation flows with tenant authentication.

- Automations base prefix: `/api/v1/automations`
- Auth/profile base prefix: `/api/v1/auth`

## 1) Authentication

### Supported auth methods

- `Authorization: Bearer <jwt>` (session token)
- `api_access_token: <ocu_...>` (profile token, Chatwoot-like)
- `Authorization: Bearer <ocu_...>` (same token; útil quando a ferramenta só permite um cabeçalho Bearer)

O token `ocu_...` deve ser o valor mostrado **uma vez** ao gerar em `POST /api/v1/auth/me/access-token` (sem espaços nem prefixo errado). A mesma **base URL** do ambiente onde o token foi criado.

### SUPER_ADMIN e integrações (`ocu_`)

Utilizadores **SUPER_ADMIN** não têm organização “actual” no JWT do token de perfil. Em **todas** as chamadas com `ocu_` a rotas de tenant (etiquetas, equipas, funil, etc.), envie também o **UUID da organização** alvo, por **qualquer** um dos meios abaixo (a API trata-os como equivalentes):

**Cabeçalhos** (primeiro valor UUID válido ganha):

- `OpenConduit-Organization-Id`
- `X-OpenConduit-Organization-Id`
- `Organization-Id` ou `organization-id`
- `X-Organization-Id` ou `x-organization-id`
- `organization_id`

**Query** (útil em clientes que só permitem query string): `?organizationId=<uuid>` ou `?organization_id=<uuid>`

Sem isto, respostas **403** *Super admin: use Entrar na organização…* são esperadas.

**Recomendação:** para integrações de um único tenant, gere o `ocu_` com uma conta **ADMIN** desse tenant (sem cabeçalho extra). **Não partilhe** o token `ocu_` completo em chats ou tickets.

### O que **não** é `ocu_` (evitar 401)

| Recurso | Credencial |
|---|---|
| **Lista de bots** (`GET /api/v1/bots`) | JWT de admin **ou** `Authorization: Bearer ocb_...` (token de inbox do bot) — **não** use `ocu_` aqui. |
| **Inboxes** (`GET /api/v1/inboxes`) | Apenas **JWT** de utilizador (idealmente ADMIN), campo `token` de `POST /api/v1/auth/login`. |
| **Etiquetas / equipas / funil** (rotas acima) | **JWT** ou **`ocu_`** (`api_access_token` ou `Bearer ocu_...`), mais cabeçalho de org se for SUPER_ADMIN. |

### Common auth errors

- `401 Unauthorized`: missing/invalid token
- `403 Forbidden`: authenticated, but without required role/scope

## 2) Profile token management endpoints

These endpoints manage the personal API token used by external automation tools.
Access requires admin-level tenant role (`ADMIN`, or `SUPER_ADMIN` acting in tenant).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/auth/me/access-token` | Returns `{ configured, prefix, lastUsedAt }` |
| POST | `/api/v1/auth/me/access-token` | Generates/rotates token and returns `{ token, prefix, message }` once |
| DELETE | `/api/v1/auth/me/access-token` | Revokes current profile token |

Example: generate token

```bash
curl -X POST "https://YOUR_DOMAIN/api/v1/auth/me/access-token" \
  -H "Authorization: Bearer <jwt>"
```

## 3) Automation endpoints: Tags

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/v1/automations/tags` | Authenticated tenant user | Lists tags: `{ data: [{ id, name, color, createdAt, updatedAt }] }` |
| POST | `/api/v1/automations/conversations/:id/tags` | Admin-level tenant user | Assigns labels to conversation contact |

`POST /conversations/:id/tags` body:

```json
{
  "tagIds": ["<uuid-tag-1>", "<uuid-tag-2>"],
  "mode": "replace"
}
```

- `mode`: `replace` (default) or `add`

## 4) Automation endpoints: Teams

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/v1/automations/teams` | Authenticated tenant user | Lists teams: `{ data: [{ id, name, description, _count }] }` |
| PATCH | `/api/v1/automations/conversations/:id/team` | Admin-level tenant user | Assigns/reassigns team and optional assignee |

`PATCH /conversations/:id/team` body:

```json
{
  "teamId": "<uuid-team-or-null>",
  "assignedToId": "<uuid-user-or-null>"
}
```

- `assignedToId` is optional
- If both are provided, `assignedToId` must belong to `teamId`

## 5) Funil CRM (leitura com token de perfil)

Estes `GET` aceitam **JWT** ou **ocu_** (`api_access_token` ou `Authorization: Bearer ocu_...`), desde que o utilizador do token tenha acesso ao tenant e o funil CRM esteja ativo (`crm_kanban`).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/lead-types` | Colunas do funil (id, name, color, order, valueRollup) |
| GET | `/api/v1/pipeline/stages` | Colunas espelhadas (requer funil ativo) |
| GET | `/api/v1/pipeline/board` | Quadro com estágios e contactos (limite interno de contactos) |

Para **Agent Bot** (`ocb_`), use apenas metadados das colunas: `GET /api/v1/agent-bot/lead-types` (sem board completo). O quadro com contactos exige `ocu_` ou JWT.

## 6) End-to-end example

```bash
curl "https://YOUR_DOMAIN/api/v1/automations/tags" \
  -H "api_access_token: ocu_xxxxxxxxxxxxxxxxx"

curl "https://YOUR_DOMAIN/api/v1/lead-types" \
  -H "Authorization: Bearer ocu_xxxxxxxxxxxxxxxxx"

# SUPER_ADMIN: incluir organização alvo (cabeçalho ou query)
curl "https://YOUR_DOMAIN/api/v1/automations/tags" \
  -H "api_access_token: ocu_xxxxxxxxxxxxxxxxx" \
  -H "OpenConduit-Organization-Id: <uuid-organizacao>"

curl "https://YOUR_DOMAIN/api/v1/automations/teams?organization_id=<uuid-organizacao>" \
  -H "api_access_token: ocu_xxxxxxxxxxxxxxxxx"
```

## 7) Notes

- These routes are intended for automation integrations and workflow engines.
- Read endpoints (`GET`) are available to authenticated tenant users.
- Mutation endpoints (`POST`, `PATCH`) require admin-level tenant access.
- `401 Invalid API access token`: confirme token completo, utilizador ainda com token ativo, e URL do mesmo servidor onde foi gerado.

## 8) Texto para outros sistemas / assistentes (OpenConduit recente)

Use este bloco **no sistema que mostra avisos ao utilizador**, para alinhar com a API actual (evite textos antigos que dizem que `ocu_` *nunca* pode ir em `Bearer` ou que o funil *só* aceita JWT).

```
Autenticação OpenConduit (resumo):

1) Token de perfil para automação (prefixo ocu_):
   - Cabeçalho: api_access_token: ocu_...
   - OU: Authorization: Bearer ocu_...  (ambos são válidos na mesma API)
   - Rotas: /api/v1/automations/*, GET /api/v1/lead-types, GET /api/v1/pipeline/board,
     GET /api/v1/pipeline/stages (entre outras que documentam "session_jwt_or_api_access_token").

2) SUPER_ADMIN com ocu_: em cada pedido às rotas do tenant, indicar o UUID da organização alvo
   (um destes): cabeçalhos OpenConduit-Organization-Id, Organization-Id, organization_id, etc.,
   OU query ?organizationId=<uuid> / ?organization_id=<uuid>.
   Sem isto aparece 403 "Super admin: use Entrar na organização...".

3) Bots (GET /api/v1/bots): NÃO use ocu_. Use JWT de admin OU Authorization: Bearer ocb_... (token de inbox do bot).

4) Inboxes (GET /api/v1/inboxes): só JWT de sessão (token de POST /api/v1/auth/login), não ocu_.

5) Se ainda aparecer 401 com ocu_: confirme que o servidor foi actualizado, token não revogado,
   URL base correcta, e que não está a enviar ocb_ ou JWT no campo do ocu_ por engano.
```

**Nota:** avisos do tipo *«ocu_ não pode ser Bearer»* ou *«lead-types exige só JWT»* estão **errados** para instâncias OpenConduit com as alterações de 2026 descritas neste ficheiro — actualize o texto de ajuda nesse sistema ou faça deploy da versão mais recente da API.
