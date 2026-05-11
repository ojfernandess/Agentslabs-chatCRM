# Agente nativo: base de conhecimento e «limpar contexto»

## Base de conhecimento (recuperação)

### Fluxo

1. **Vínculo artigo ↔ bot** — `automation_knowledge_article_bots` (sincronizado ao guardar o agente com artigos ligados no editor; ver `syncKnowledgeArticleBotsFromPromptBuilder`).
2. **Índice semântico** — `automation_knowledge_chunks` + pgvector; reindexação gera embeddings com `OPENAI_API_KEY` / `OPENAI_PROMPT_PREVIEW_KEY` no servidor.
3. **Consulta** — `rankedKnowledgeSearch` (semântica + lexical) com `effectiveKnowledgeSearchBotId` (se não há vínculos, pesquisa a nível da organização).
4. **Agente** — `fetchProactiveKnowledgeSystemAppendix` injeta excertos no system prompt. A ferramenta `buscar_conhecimento` só é omitida quando o appendix contém **excertos reais** (`kbAppendixHasRetrievedExcerpts`), não quando é só o aviso «nenhum trecho».

### Checklist na UI (operador)

- **Automação → Agentes:** no cartão de cada bot, o estado **KB** mostra se a busca está ligada, quantos artigos estão vinculados ao bot, ou se a organização ainda não tem artigos activos com IA.
- **Editar agente → Base de conhecimento no prompt:** confirme **«buscar_conhecimento»** activo, leia o resumo de contagens e use o atalho para **Base de conhecimento**.
- **Base de conhecimento → Documentos:** em cada cartão, chips **Inactivo**, **Fora da IA** e **Bots** indicam `isActive`, `syncToAi` e vínculos; no editor do artigo, confirme **Sincronizar com IA** e a associação ao bot.

### Falhas observadas e mitigações

| Causa | Mitigação |
|--------|-----------|
| Chaves OpenAI só no `.env` do host em Docker | `docker-compose.yml` repassa `OPENAI_*` ao serviço `api`. |
| Modelo prioriza `buscar_conhecimento` e ignora excertos | Omitir a tool só quando há **excertos reais** no appendix (`kbAppendixHasRetrievedExcerpts`); prompt «se falhar → call_human» com template «nenhum trecho» já não omite a tool. Bloco final `serverKbGuard` evita `call_human` por falso «falha de busca». |
| Erro na pesquisa semântica (API/embeddings) | `warn` em log com `stage: rankedKnowledgeSearch_semantic_failed` e fallback lexical (`knowledgeRetrieval.ts`). |
| Só artigos vinculados no **hub** (checkbox no artigo), sem IDs no prompt do agente | `mergeBotLinkedKnowledgeWhenRankedEmpty`: se a pesquisa devolver vazio, injeta até 8 artigos activos com `botLinks` para esse bot (`knowledgeRetrieval.ts` + agente + `buscar_conhecimento`). |
| Diagnóstico | `AGENT_KB_DEBUG=true` no contentor da API → eventos `agent_kb_debug` (ex.: `rankedKnowledgeSearch`, `mergeBotLinkedKnowledgeFallback`, `nativeAgentReply_start`). |

## Limpar contexto

### Comportamento anterior (bug de produto)

- O endpoint `POST /automation/conversation-context/:id/clear` repunha `state` e grava `lastClearedAt`.
- O agente nativo montava o histórico com `Message` **sem** filtrar por `lastClearedAt`, pelo que o LLM continuava a ver toda a conversa.

### Comportamento actual

- `generateNativeAgentReply` lê `lastClearedAt` em `AutomationConversationContext` e aplica `createdAt > lastClearedAt` ao carregar as últimas mensagens para o modelo (ver `buildNativeAgentMessageWhere` em `agentConversationHistory.ts`).
- As mensagens na base de dados **não são apagadas**; só deixam de ser enviadas ao modelo após a limpeza.
- Se ainda não existia linha de contexto, `clear` pode criar uma via `upsert` (requer `agentBotId` nas Settings da organização).

### Testes

- `apps/api/src/lib/agentConversationHistory.test.ts` — construção do filtro Prisma.
- `npm run test -w apps/api` — inclui este ficheiro e `messagePayload.test.ts`.
