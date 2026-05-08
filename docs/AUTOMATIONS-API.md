# Automations API (Tenant)

These endpoints support CRM/chat automation flows with an authenticated tenant user.
Authentication options:

- `Authorization: Bearer <jwt>` (normal session token)
- `Authorization: Bearer <ocu_...>` (API token generated in user profile, Chatwoot-like)

Base prefix: `/api/v1/automations`

## Tags (labels)

- `GET /tags`
  - Lists organization tags for automation mapping.
  - Response: `{ data: [{ id, name, color, createdAt, updatedAt }] }`

- `POST /conversations/:id/tags`
  - Assigns labels to a conversation by tagging its contact.
  - Body:
    ```json
    {
      "tagIds": ["<uuid-tag-1>", "<uuid-tag-2>"],
      "mode": "replace"
    }
    ```
  - `mode`: `replace` (default) or `add`.

## Teams

- `GET /teams`
  - Lists teams available for automation assignment.
  - Response: `{ data: [{ id, name, description, _count }] }`

- `PATCH /conversations/:id/team`
  - Assigns/reassigns the team for a conversation.
  - Body:
    ```json
    {
      "teamId": "<uuid-team-or-null>",
      "assignedToId": "<uuid-user-or-null>"
    }
    ```
  - `assignedToId` is optional. If provided with `teamId`, user must belong to that team.

## Notes

- These routes are intended for automation integrations and workflow engines.
- Current policy requires admin-level tenant access for mutating endpoints.
