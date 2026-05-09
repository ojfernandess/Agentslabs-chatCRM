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

**Cabeçalhos** (primeiro valor UUID válido ganha; aspas em volta do UUID são removidas):

- `OpenConduit-Organization-Id`, `X-OpenConduit-Organization-Id`
- `Organization-Id`, `organization-id`, `OrganizationId` (chega como `organizationid` em Node)
- `X-Organization-Id`, `organization_id`, `X-Organization`
- `org-id`, `org_id`, `X-Org-Id`
- `tenant-id`, `tenant_id`, `X-Tenant-Id`
- Qualquer cabeçalho cujo nome contenha `organization`, `org_id` / `org-id` ou `tenant_id` / `tenant-id` com valor UUID

**Query**: `?organizationId=<uuid>`, `?organization_id=<uuid>`, `?orgId=`, `?tenantId=`, etc.

O UUID tem de ir **no pedido HTTP** (cabeçalho ou query). Só mostrar texto de ajuda na UI do outro sistema **não** envia o valor à API — tem de existir campo de configuração “ID da organização” ligado ao cliente HTTP.

Sem isto, respostas **403** *Super admin…* são esperadas.

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

**Nota:** avisos do tipo *«ocu_ não pode ser Bearer»* ou *«lead-types exige só JWT»* estão **errados** para instâncias OpenConduit com as alterações de 2026 descritas neste ficheiro — actualize o texto de ajuda nesse sistema ou faça deploy da variante mais recente da API.

## 9) Automation suite — Knowledge Hub (JWT de sessão / admin tenant)

Prefixo: **`/api/v1/automation`** (não confundir com `/api/v1/automations`). Requer autenticação de utilizador; mutações e métricas exigem papel de administrador do tenant (`ADMIN`, ou `SUPER_ADMIN` com organização activa).

| Method | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/automation/knowledge-articles` | Lista artigos da KB com `botIds`. |
| POST | `/api/v1/automation/knowledge-articles` | Cria artigo (admin). Dispara reindexação assíncrona de embeddings se existir chave OpenAI no servidor. |
| POST | `/api/v1/automation/knowledge-articles/import-file` | `multipart/form-data`: campo ficheiro **`file`** (PDF, DOCX, TXT/MD/CSV/TSV, XLSX/XLS). Campos opcionais: `title`, `category`, `tags` (JSON array), `botIds` (JSON array de UUIDs), `isActive`, `syncToAi` (`true`/`false`). Cria artigo com texto extraído, `sourceFileName` / `sourceMimeType`, e reindexa. Limite de tamanho: igual ao plugin multipart global (ex.: 16 MB). |
| PATCH | `/api/v1/automation/knowledge-articles/:id` | Actualiza artigo (admin). Reindexa em background quando título, conteúdo, `syncToAi` ou `isActive` mudam. |
| DELETE | `/api/v1/automation/knowledge-articles/:id` | Remove artigo (chunks em cascata). |
| GET | `/api/v1/automation/knowledge-articles/:id/revisions` | Histórico de revisões. |
| POST | `/api/v1/automation/knowledge-articles/:id/reindex` | Reindexa embeddings só deste artigo (admin). Resposta: `{ chunks: number }` ou `{ skipped: true, reason }`. |
| POST | `/api/v1/automation/knowledge-articles/reindex-organization` | Reindexa todos os artigos da organização (admin). Resposta: `{ articles, errors }`. |
| GET | `/api/v1/automation/knowledge-articles/hub-metrics` | Métricas do painel (incl. `indexedChunks`, `semanticSearchReady`, `embeddingModel`). |
| POST | `/api/v1/automation/knowledge-articles/search` | Corpo: `{ "query": "...", "botId?": "uuid" }`. Resposta inclui `searchMode`: `lexical` \| `semantic` \| `hybrid` \| `cached`. Com `OPENAI_API_KEY` / `OPENAI_PROMPT_PREVIEW_KEY` e chunks indexados, usa similaridade de coseno + complemento lexical. |
| POST | `/api/v1/automation/knowledge-articles/playground` | Teste RAG com LLM (admin). Resposta inclui `retrievalMode` (`lexical` \| `semantic` \| `hybrid`), `sources`, `answer`, `latencyMs`, `contextChars`. |

Variáveis de ambiente relevantes: `OPENAI_API_KEY` ou `OPENAI_PROMPT_PREVIEW_KEY`, opcionalmente `OPENAI_EMBEDDING_MODEL` (por omissão `text-embedding-3-small`; tem de produzir vectores de **1536** dimensões para corresponder à coluna pgvector) e `OPENAI_API_BASE_URL` (por omissão `https://api.openai.com/v1`).

**PostgreSQL:** a busca semântica usa a extensão **pgvector** (`vector(1536)`, índice HNSW, operador `<=>`). O `docker-compose` do projecto usa a imagem `pgvector/pgvector:pg16`. Noutros ambientes, instale a extensão antes de `prisma migrate deploy`.
