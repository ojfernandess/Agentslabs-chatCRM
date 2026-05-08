# Automations API (Tenant)

These endpoints support CRM/chat automation flows with tenant authentication.

- Automations base prefix: `/api/v1/automations`
- Auth/profile base prefix: `/api/v1/auth`

## 1) Authentication

### Supported auth methods

- `Authorization: Bearer <jwt>` (session token)
- `api_access_token: <ocu_...>` (profile token, Chatwoot-like)

Profile token (`ocu_...`) is accepted only via `api_access_token` header.

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

## 5) End-to-end example

```bash
curl "https://YOUR_DOMAIN/api/v1/automations/tags" \
  -H "api_access_token: ocu_xxxxxxxxxxxxxxxxx"
```

## 6) Notes

- These routes are intended for automation integrations and workflow engines.
- Read endpoints (`GET`) are available to authenticated tenant users.
- Mutation endpoints (`POST`, `PATCH`) require admin-level tenant access.
