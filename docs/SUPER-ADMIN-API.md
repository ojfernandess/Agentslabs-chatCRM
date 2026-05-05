# Super admin API (OpenConduit)

Esta API complementa a consola web em `/super`. Todas as rotas abaixo exigem JWT de utilizador com `role: SUPER_ADMIN` (exceto onde indicado). Prefixo: `/api/v1/super`.

## Segurança

- **Autenticação:** `Authorization: Bearer <jwt>` (login normal com conta `SUPER_ADMIN`).
- **Auditoria:** criação de organizações, alteração de flags, apps de plataforma, impersonação e definições globais registam-se em `audit_logs`.
- **Impersonação de organização:** `POST /organizations/:id/enter` — o JWT passa a incluir `actingOrganizationId` (super continua com `role: SUPER_ADMIN`).
- **Impersonação de utilizador:** `POST /organizations/:orgId/users/:userId/impersonate` — o JWT passa a representar o utilizador alvo (`id`, `email`, `role`, `organizationId`) e inclui `superAdminActorId` (UUID do super). Sair: `POST /api/v1/auth/exit-user-impersonation` (com o token de impersonação).

## Organizações

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/organizations` | Lista tenants com contagens; inclui `stats` agregados. |
| POST | `/organizations` | Cria tenant (body: `{ name, slug? }`). |
| PATCH | `/organizations/:id` | Atualiza `name`, `isActive`, `planTier` (`free` \| `growth` \| `enterprise`), `billingEmail`, `monthlyMessageQuota` (null = ilimitado). |
| POST | `/organizations/:id/enter` | JWT com `actingOrganizationId` para trabalhar no tenant. |

## Utilizadores do tenant (super)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/organizations/:id/users` | Lista utilizadores (`ADMIN` / `AGENT`) do tenant. |
| PATCH | `/organizations/:orgId/users/:userId` | Atualiza `name` e/ou `role` (`ADMIN` \| `AGENT`). |
| POST | `/organizations/:orgId/users/:userId/impersonate` | Emite JWT “como” o utilizador (ver segurança). |

## Métricas e monitorização

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/stats` | Totais de organizações, utilizadores, contactos, conversas abertas. |
| GET | `/usage-metrics` | Mensagens por tenant (7 e 30 dias) + plano/estado. |
| GET | `/monitoring` | Latência DB, Redis, nota sobre filas. |

## Definições globais

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/platform-settings` | Lista pares `key` / `value` (JSON). |
| PUT | `/platform-settings` | Body `{ key, value }` — *upsert*; `value` é JSON arbitrário. |

## Integrações de plataforma

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/platform-applications` | Apps API (sem tokens completos). |
| POST | `/platform-applications` | Cria app; resposta inclui `token` **uma vez**. |
| DELETE | `/platform-applications/:id` | Revoga. |

## Funcionalidades por tenant

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/organizations/:id/feature-flags` | Flags efetivas + omissões. |
| PATCH | `/organizations/:id/feature-flags` | Body `{ key, enabled }` — `key` tem de existir nas definições da app. |

## Auditoria

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/audit-logs` | Query: `page`, `limit`, `organizationId?`. |

## Relação com Chatwoot

O OpenConduit **não** expõe a API nem o modelo de dados do Chatwoot. A consola de super admin segue **padrões comuns** de SaaS multi-tenant (contas, métricas, auditoria, impersonação, chaves globais). Permissões granulares estilo matriz de capacidades do Chatwoot **não** estão modeladas: cada utilizador de tenant é `ADMIN` ou `AGENT`.

## Migração de base de dados

Campos de plano/faturação e tabela `platform_settings` aplicam-se com a migração `20260503180000_org_billing_platform_settings`. Execute `npx prisma migrate deploy` na API.
