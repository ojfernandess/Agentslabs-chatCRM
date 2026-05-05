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
3. **Destino interno**: o serviço que publica a app é o **caddy**.
4. **Porta**: a porta **do host** que mapeias para o caddy — por defeito **`8080`** (valor de `CADDY_HTTP_PORT`).

Se o painel pedir “container port”, o caddy escuta **80** *dentro* da rede Docker; o que importa para o proxy do EasyPanel é a porta que aparece no `ports:` do compose no host (ex.: `8080:80` → usa **8080** como upstream HTTP, salvo o painel documentar o contrário).

5. Garante **SSL** no EasyPanel para o domínio (Let’s Encrypt do painel), não no Caddy do compose.

## 3. `PUBLIC_URL` alinhado com o domínio

- Domínio do painel: `https://chat-agentslabs-chat.pbsqki.easypanel.host`  
  → `PUBLIC_URL=https://chat-agentslabs-chat.pbsqki.easypanel.host`
- Se testares com IP: `PUBLIC_URL=http://IP:8080` (CORS e webhooks refletem isso).

## 4. Conflito de porta 80 no servidor

Se o deploy falhar com “port 80 already allocated”, não forces `80:80` no override: mantém **8080** (ou a variável `CADDY_HTTP_PORT`) e aponta o domínio do EasyPanel para essa porta. Opcionalmente inclui no comando compose, **por último**, `docker-compose.easypanel.yml`.

## 5. Verificar

- Contentores **api**, **web**, **caddy** em execução.
- Abrir o URL configurado: o frontend deve responder; login chama `/api/v1/...`.

Se o domínio abrir mas o login falhar, confere logs da **api** e se `PUBLIC_URL` coincide com o que usas no browser (`https` vs `http`, subdomínio certo).
