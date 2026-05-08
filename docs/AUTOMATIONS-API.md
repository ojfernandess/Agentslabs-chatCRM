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
```

## 7) Notes

- These routes are intended for automation integrations and workflow engines.
- Read endpoints (`GET`) are available to authenticated tenant users.
- Mutation endpoints (`POST`, `PATCH`) require admin-level tenant access.
- `401 Invalid API access token`: confirme token completo, utilizador ainda com token ativo, e URL do mesmo servidor onde foi gerado.
