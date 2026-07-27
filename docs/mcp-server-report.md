# OpenNexo MCP Server — Relatório de Implementação

## Resumo

Foi implementado o **OpenNexo MCP Server**, um módulo independente que expõe o OpenNexo CRM via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) oficial. O Cursor e outros clientes MCP conectam-se como clientes padrão — sem tratamento especial.

---

## Arquitetura Criada

```
apps/api/src/lib/mcp/
├── index.ts                    # API pública do módulo
├── types.ts                    # Tipos, roles, permissões
├── auth/
│   ├── mcpTokenService.ts      # Tokens ocm_* (criar, verificar, revogar)
│   └── resolveMcpAuth.ts       # JWT, ocu_, ocm_ → McpAuthContext
├── access/
│   └── permissions.ts          # RBAC: admin, developer, support, audit, read_only, custom
├── audit/
│   └── McpAuditLogger.ts       # Registo de acessos MCP
├── security/
│   └── sanitize.ts             # Redacção de segredos antes de expor dados
├── providers/                  # Provider/Adapter por domínio (extensível)
│   ├── ProviderRegistry.ts
│   ├── agentsProvider.ts
│   ├── promptsProvider.ts
│   ├── toolsProvider.ts
│   ├── logsProvider.ts
│   ├── executionsProvider.ts
│   ├── workflowProvider.ts
│   ├── memoryProvider.ts
│   ├── knowledgeProvider.ts
│   ├── observabilityProvider.ts
│   └── index.ts
├── server/
│   └── createMcpServer.ts      # McpServer + ferramentas + recursos
└── transport/
    └── McpSessionManager.ts    # Streamable HTTP (sessões stateful)

apps/api/src/routes/mcp.ts       # Rotas Fastify /api/v1/mcp
apps/api/src/mcp-stdio.ts        # Entrada stdio para clientes locais
```

**Princípios:**
- Nenhum acesso directo ao código interno ou SQL arbitrário
- Todos os dados passam por **Providers** que consultam Prisma/serviços existentes
- Isolamento total por `organizationId` (tenant)
- Segredos redactados via `sanitizeForMcp()`

---

## Recursos MCP Implementados

| Domínio | URI | Conteúdo |
|---------|-----|----------|
| **Agentes** | `opennexo://agents/{botId}` | Config, LLM, engine, ferramentas, execuções recentes |
| **Prompts** | `opennexo://prompts/{id}` | Módulos de prompt, versões, corpo (debug) |
| **Ferramentas** | `opennexo://tools/{id}` | Config HTTP/Webhook/MCP, stats, execuções |
| **Logs** | `opennexo://logs/{executionId}` | Entradas de log por execução |
| **Execuções** | `opennexo://executions/{id}` | Inspector completo (tools, supervisor, tokens) |
| **Workflow** | `opennexo://workflow/{botId}` | Nodes, edges, runtime LangGraph |
| **LangGraph** | `opennexo://langgraph/{executionId}` | Graph, history, interrupts, checkpoints |
| **Memória** | `opennexo://memory/{conversationId}` | OpenNexo + Mem0 context |
| **Knowledge** | `opennexo://knowledge/{articleId}` | RAG, chunks, LlamaIndex/openconduit |
| **Vector** | `opennexo://vector/{articleId}` | pgvector embeddings (Qdrant: N/A) |
| **Observabilidade** | `opennexo://observability/{executionId}` | Traces, spans, Langfuse |
| **Workflow Validator** | `opennexo://workflow_validator/{botId}` | Auditoria de workflow |
| **Supervisor** | `opennexo://supervisor/{executionId}` | Decisões, plano, erros |
| **Config** | `opennexo://config/{orgId}` | Integrações, flags, settings |

---

## Ferramentas MCP Expostas

| Ferramenta | Descrição |
|------------|-----------|
| `search_agent` | Buscar agentes/bots |
| `search_tool` | Buscar ferramentas de automação |
| `search_prompt` | Buscar módulos de prompt |
| `search_execution` | Buscar execuções |
| `search_error` | Buscar erros nos logs |
| `search_logs` | Buscar entradas de log |
| `search_memory` | Buscar contextos de memória |
| `search_document` | Buscar documentos KB/RAG |
| `search_trace` | Traces Langfuse/observabilidade |
| `search_workflow` | Grafo de workflow de um agente |
| `search_supervisor` | Decisões do supervisor |
| `search_metrics` | Métricas de ferramentas |
| `search_config` | Configuração da organização |
| `search_integrations` | Integrações activas (Mem0, Langfuse, etc.) |
| `get_agent_prompt` | Prompt montado de um agente |
| `get_execution_inspector` | Inspector completo de execução |
| `list_resources` | Listar todos os recursos disponíveis |
| `list_mcp_audit` | Auditoria MCP (role admin/audit) |

---

## Autenticação (Super Admin exclusivo)

| Método | Formato | Uso |
|--------|---------|-----|
| **Token MCP dedicado** | `ocm_...` | Criado no painel **Super Admin → MCP Server** |
| **JWT Bearer** | Sessão SUPER_ADMIN | Requer header `organization-id` se não estiver a impersonar um tenant |

**Gestão de tokens:** `POST/GET/DELETE /api/v1/super/mcp/tokens` (requer **SUPER_ADMIN**)

**Endpoint MCP:** `POST/GET/DELETE /api/v1/super/mcp`

Administradores de tenant (ADMIN/AGENT) e tokens `ocu_` **não têm acesso** ao MCP Server.

**Campos por token:**
- Role (admin, developer, support, audit, read_only, custom)
- Permissões customizadas
- Escopo por agente (`allowedBotIds`)
- Ambiente (production/staging/development)
- Modo debug
- Expiração e revogação

---

## Permissões (RBAC)

| Role | Capacidades principais |
|------|------------------------|
| **admin** | Tudo + auditoria + debug |
| **developer** | Debug, execuções, LangGraph, traces |
| **support** | Leitura operacional, logs, execuções |
| **audit** | Leitura + auditoria MCP |
| **read_only** | Consulta sem debug |
| **custom** | Permissões explícitas em JSON |

---

## Modo Debug

Quando `debugMode: true` no token MCP:
- Prompt completo e behaviorConfig
- inputContext/outputContext nos logs
- Conteúdo completo de artigos KB
- Estado de memória completo
- Retornos de ferramentas

---

## Segurança

**Bloqueado:**
- Execução arbitrária de código
- Acesso directo ao banco (SQL)
- Leitura de credenciais, tokens, env vars
- Dados de outras organizações

**Implementado:**
- Sanitização automática de segredos
- Filtro `organizationId` em todas as queries
- Escopo opcional por agente
- Auditoria de cada tool/resource access

---

## Transportes

| Transporte | Endpoint / Comando | Clientes |
|------------|-------------------|----------|
| **Streamable HTTP** | `POST/GET/DELETE /api/v1/mcp` | Cursor, VS Code, remote clients |
| **stdio** | `npx tsx apps/api/src/mcp-stdio.ts` | Claude Desktop, Cursor local |

### Configuração Cursor (HTTP)

```json
{
  "mcpServers": {
    "opennexo": {
      "url": "https://seu-dominio.com/api/v1/super/mcp",
      "headers": {
        "Authorization": "Bearer ocm_SEU_TOKEN"
      }
    }
  }
}
```

### Configuração Cursor (stdio)

```json
{
  "mcpServers": {
    "opennexo": {
      "command": "npx",
      "args": ["tsx", "apps/api/src/mcp-stdio.ts"],
      "env": {
        "OPENNEXO_MCP_TOKEN": "ocm_SEU_TOKEN",
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

---

## Testes Realizados

```
src/lib/mcp/mcp.test.ts
✔ Permissões RBAC (admin, read_only, forbidden)
✔ Sanitização de segredos
✔ Geração de tokens ocm_
✔ Parsing de URIs opennexo://
✔ TypeScript typecheck (tsc --noEmit)
```

---

## Clientes Compatíveis

- Cursor
- Claude Desktop
- VS Code (MCP extension)
- Windsurf
- Cline
- OpenAI Agents SDK
- Qualquer cliente compatível com MCP Streamable HTTP ou stdio

---

## Limitações Actuais

1. **Qdrant** — não implementado; vector store usa **pgvector** (PostgreSQL)
2. **Busca semântica vector** via MCP retorna match textual; score embedding requer query via knowledge engine
3. **OAuth MCP** — autenticação OAuth2 nativa MCP não implementada (usa tokens ocm_/JWT)
4. **MCP tool execution runtime** — ferramentas tipo MCP no agent engine continuam schema-only; o MCP Server é para **inspecção**, não execução de tools CRM
5. **Paginação** — implementada via `limit`/`offset` nas ferramentas de busca
6. **Cache** — delegado ao Redis/pgvector existente; sem cache MCP dedicado ainda

---

## Melhorias Futuras

1. OAuth 2.0 / OIDC conforme spec MCP para auth de clientes
2. Provider Qdrant quando adoptado como backend vector
3. Subscrição de recursos (resource `listChanged` notifications)
4. Streaming de eventos de execução em tempo real via SSE MCP
5. UI admin no painel web para gestão de tokens MCP
6. Rate limiting dedicado por token MCP
7. Execução controlada de ferramentas HTTP via MCP (com sandbox)
8. Compressão gzip nas respostas JSON grandes

---

## Migração de Base de Dados

```
apps/api/prisma/migrations/20260727120000_mcp_server/
```

Tabelas: `mcp_access_tokens`, `mcp_audit_logs`

---

## Dependência Adicionada

- `@modelcontextprotocol/sdk@^1.29.0`

---

## Perguntas de Inspecção Suportadas

O servidor permite responder (via ferramentas MCP):

- "Por que este agente não chamou a ferramenta?" → `get_execution_inspector` + `search_logs`
- "Qual ferramenta retornou erro?" → `search_error` + `search_tool`
- "Mostre o prompt completo" → `get_agent_prompt` (debug mode)
- "Quais documentos RAG foram usados?" → `search_document` + metadata execução
- "Qual memória foi carregada?" → `search_memory`
- "Qual etapa do workflow falhou?" → `get_execution_inspector`
- "Qual node LangGraph gerou exceção?" → `search_workflow` + logs ERROR
- "Qual ferramenta demorou mais?" → `search_metrics` / tool stats
- "Qual trace Langfuse?" → `search_trace`
- "Qual decisão do Supervisor?" → `search_supervisor`
