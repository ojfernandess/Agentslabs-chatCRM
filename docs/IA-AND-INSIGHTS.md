# IA & Insights e assistência no painel (humanos)

Este documento descreve o que já existe no produto e uma **folha de rota** para evoluções futuras. Não altera comportamento em tempo de execução; serve para operações, segurança e planeamento.

## O que está implementado hoje

### Sugestão de resposta («Gerar resposta»)

- **Onde:** detalhe de uma conversa → compositor público (tab «Responder») → botão com ícone de sugestão (✨).
- **Endpoint:** `POST /api/v1/conversations/:id/suggest-reply`  
  Corpo opcional: `{ "currentDraft": "texto opcional" }` — o rascunho actual é enviado ao modelo para melhorar ou substituir.
- **Contexto enviado ao modelo:** últimas mensagens da conversa em ordem cronológica, **excluindo notas internas** (`isPrivate`).
- **Implementação:** `apps/api/src/lib/agentAssistLlm.ts` (`suggestAgentReplyText`, `buildPublicConversationTranscript`) e `conversationRoutes` em `apps/api/src/routes/conversations.ts`.

### Análise por conversa (página «IA & Insights»)

- **Onde:** menu lateral → **IA & Insights** (`/ai-insights`); pode abrir-se a partir do link no cabeçalho da conversa com `?conversation=<uuid>`.
- **Endpoint:** `POST /api/v1/conversations/:id/insights` (sem corpo obrigatório).
- **Resposta:** JSON com `insights`: resumo, intenção, sentimento (`positive` | `neutral` | `negative` | `frustrated`), alertas, perspectiva de conversão e lista de sugestões para o atendente. O modelo devolve JSON; o servidor normaliza e limita tamanhos.
- **Implementação:** `analyzeConversationForInsights` em `agentAssistLlm.ts` e a mesma rota de conversas.

### Chaves e modelo (servidor)

- **Chave:** `OPENAI_PROMPT_PREVIEW_KEY` ou, na sua ausência, `OPENAI_API_KEY` (mesma ordem que noutros fluxos de pré-visualização / embeddings). Sem chave, os endpoints respondem **503** com código `missing_openai_key`.
- **Base URL OpenAI:** `OPENAI_API_BASE_URL` (por omissão `https://api.openai.com/v1`).
- **Modelo de chat para assistência:** `OPENAI_ASSIST_MODEL` (por omissão `gpt-4o-mini`). Ver `.env.example`.

### Privacidade e permissões

- Apenas utilizadores autenticados com acesso à conversa (mesma regra que `GET /conversations/:id`) podem chamar `suggest-reply` e `insights`.
- Notas privadas **não** entram no transcript enviado ao modelo.

---

## Próximos passos sugeridos (roadmap — ainda não implementados)

Estes itens **não** estão no código actual; são evoluções possíveis quando quiserem expandir sem surpresas para quem já opera o sistema:

1. **Chave OpenAI por organização** — permitir que o admin do tenant configure uma chave (encriptada em repouso) para assistência e insights, em vez de depender apenas da chave do servidor. Mantém compatibilidade: se não houver chave de org, continua o comportamento actual (só servidor).

2. **Rate limit por utilizador / por organização** — limitar chamadas a `suggest-reply` e `insights` (por minuto ou por dia) para controlar custo e abuso, com cabeçalhos ou corpo de erro claros (`429`).

3. **Análise agregada multi-conversa** — endpoint ou job que resume N conversas (ex.: abertas na última semana) para painel de «saúde da fila»; exige definição de agregação, amostragem e custo.

4. **Webhooks de alerta** — quando `insights.alerts` contiver determinados padrões (ou score manual), POST opcional para URL configurada (semelhante a outros webhooks da plataforma).

5. **Ligação ao CRM** — sugestões baseadas em estágio do funil, valor do negócio ou etiquetas do contacto (contexto estruturado além do transcript).

6. **Internacionalização fixa do system prompt** — hoje o system prompt do assistente está em português; pode passar a depender do locale do utilizador ou da organização.

7. **Observabilidade** — métricas (contagem, latência, erros por endpoint) e opcionalmente registo de auditoria «quem pediu sugestão/análise em que conversa» (sem gravar o texto completo, se política o exigir).

---

## Ver também

- [Agente nativo: base de conhecimento e contexto](./AGENT-KB-AND-CONTEXT.md) — fluxo **distinto**: automação com bot, RAG e tools; não confundir com os endpoints de assistência ao humano acima.
