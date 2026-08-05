# EasyPanel: domínio e portas

O stack expõe a aplicação pelo contentor **caddy**. Por defeito o compose mapeia **8080** (host) → **80** (caddy) e **8443** → **443**. O `Caddyfile` serve **só HTTP** dentro do Docker; o **TLS** costuma ser do próprio EasyPanel.

## 1. Variáveis de ambiente (projeto Compose)

Define no painel (Environment), no mínimo:

| Variável | Exemplo | Notas |
|----------|---------|--------|
| `JWT_SECRET` | (64+ chars aleatórios) | Obrigatório. |
| `PUBLIC_URL` | `https://crm.teudominio.com` | URL **exata** que o utilizador abre no browser (sem barra final no fim). Usada nos webhooks e CORS. |
| `DB_PASSWORD` | palavra-passe forte | Alinha com o URL interno do Postgres no compose. |
| `CADDY_HTTP_PORT` | `8080` | Só se quiseres outra porta no host (por omissão já é 8080). |
| `CADDY_HTTPS_PORT` | `8443` | Idem para HTTPS interno (o bundle atual usa sobretudo HTTP no caddy). |

Opcional: `RUN_DB_SEED=true` só no primeiro deploy; depois `false`.

## 2. Domínio no EasyPanel

1. No projeto → aba **Domains** (ou equivalente).
2. Adiciona o domínio (próprio ou `*.easypanel.host`).
3. **Destino interno**: serviço **`caddy`**, porta **`80`** (porta *dentro* do contentor — rede Docker).
4. **Não** uses porta `8080` do host se o deploy incluir `docker-compose.easypanel.yml` (sem `ports` no caddy).
5. Garante **SSL** no EasyPanel para o domínio (Let’s Encrypt do painel), não no Caddy do compose.

Se aparecer o aviso *"ports is used in caddy"*, inclui **`docker-compose.easypanel.yml` por último** no comando compose do painel (Settings → Compose) e confirma o domínio aponta para **caddy:80**.

Para VPS **sem** EasyPanel a fazer proxy (só compose), usa o `docker-compose.yml` base com `CADDY_HTTP_PORT=8080` — **não** merges o ficheiro easypanel.

## 3. `PUBLIC_URL` alinhado com o domínio

- Domínio do painel: `https://chat-agentslabs-chat.pbsqki.easypanel.host`  
  → `PUBLIC_URL=https://chat-agentslabs-chat.pbsqki.easypanel.host`
- Se testares com IP: `PUBLIC_URL=http://IP:8080` (CORS e webhooks refletem isso).

## 4. Conflito de porta 80 no servidor

Se o deploy falhar com “port 80 already allocated”, não forces `80:80` no override: mantém **8080** (ou a variável `CADDY_HTTP_PORT`) e aponta o domínio do EasyPanel para essa porta. Opcionalmente inclui no comando compose, **por último**, `docker-compose.easypanel.yml`.

## 5. Verificar

- Contentores **api**, **web**, **caddy** em execução.
- Abrir o URL configurado: o frontend deve responder; login chama `/api/v1/...`.
- Versão da API em produção: `GET https://SEU_DOMINIO/health` → campo `version` (confirma rebuild da imagem **api**).
- **Wavoip / alterações no CRM:** o EasyPanel costuma só reconstruir o serviço que mudou. Força rebuild de **api** e **web** (sem cache) e `up -d` nos dois; só API deixa o browser com JavaScript antigo.

Comando no servidor (raiz do projeto):

```bash
docker compose build api web --no-cache
docker compose up -d api web
```

## 6. Super admin e Wavoip

- No painel **`/super`** não há chamadas de voz nem WebSocket do tenant — é normal.
- Para testar ligações: **Organizações → Entrar na organização**, depois abrir **Conversas** como um agente.
- **Funcionalidades:** o interruptor `wavoip_voice` mostra o estado **efectivo**; se existir dispositivo Wavoip e o último log estiver vazio, o webhook não está a chegar à API (rever `PUBLIC_URL` e URL no painel Wavoip).

Se o domínio abrir mas o login falhar, confere logs da **api** e se `PUBLIC_URL` coincide com o que usas no browser (`https` vs `http`, subdomínio certo).

## 8. Postgres / Redis (ataques na porta 5432)

No EasyPanel o projeto é **Compose** — `db`, `redis`, `api`, `web` e `caddy` vêm do mesmo `docker-compose.yml`. **Não há ecrã separado** para fechar a porta do Postgres; a correção é no ficheiro YAML + redeploy.

### Logs do db: "listening on 0.0.0.0, port 5432"

**Normal e seguro** quando não há `ports:` no compose. Dentro do contentor o Postgres sempre escuta em `0.0.0.0`; o que importa é se o **host** publica `0.0.0.0:5432`. Sem mapeamento Docker, a Internet **não** alcança a porta.

Confirma com:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep db
```

Seguro: `5432/tcp` (sem `0.0.0.0:5432->`).  
Inseguro: `0.0.0.0:5432->5432/tcp`.

Mensagens como *"Database directory appears to contain a database; Skipping initialization"* significam que o volume **`pgdata`** foi preservado.

### O que fazer

1. **Garantir compose actualizado** (Postgres/Redis **sem** `ports:` no `docker-compose.yml` principal).
2. No EasyPanel → **Implantar** (pull + rebuild). **Não** uses `down -v` — o volume `pgdata` guarda os dados.
3. Se o aviso amarelo “problemas na configuração Docker Compose” mencionar portas do `db`, abre **Visualizar** e confirma que o `docker-compose.override.yml` do painel **não** adiciona `5432:5432` ou `6379:6379`. Se adicionar, remove essas linhas no override do painel ou inclui **`docker-compose.easypanel.yml` por último** no comando compose (ver comentário no ficheiro).
4. (Opcional) Rodar password: ver secção abaixo.

### Verificar no servidor (SSH)

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -E "db|redis"
```

**Correcto:** `db` e `redis` **sem** `0.0.0.0:5432` nem `0.0.0.0:6379`.  
**Errado:** `0.0.0.0:5432->5432/tcp` — ainda exposto à Internet.

### Acesso remoto ao banco (admin)

Nunca abras 5432 na Internet. Usa túnel SSH:

```bash
ssh -L 5432:127.0.0.1:5432 root@SEU_SERVIDOR
# ou, se o painel publicar só em localhost:
ssh -L 5432:db:5432 root@SEU_SERVIDOR -t "docker exec -it NOME_CONTAINER_DB psql -U openconduit"
```

Liga o DBeaver em `localhost:5432`.

### Rodar password (sem perder dados)

```bash
docker exec -it NOME_CONTAINER_DB psql -U openconduit -d openconduit -c "ALTER USER openconduit WITH PASSWORD 'nova-password-forte';"
```

Actualiza `DB_PASSWORD` no Environment do EasyPanel e reinicia só **api**.

## 7. Vários agentes na mesma organização

- Cada utilizador deve usar **browser/perfil separado** (o token fica em `localStorage` por origem — duas contas no mesmo Chrome partilham a mesma sessão).
- A API aplica rate limit **por token JWT**, não só por IP, para vários agentes atrás do proxy EasyPanel não se deslogarem em massa.
