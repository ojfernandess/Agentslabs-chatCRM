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

### Chaves e modelo (organização e servidor)

- **Por organização:** em **Configurações** → **IA e assistência**, um administrador do tenant pode guardar `assistantOpenaiApiKey` e opcionalmente `assistantOpenaiApiBaseUrl` em `settings` (colunas mapeadas em Prisma). A API de conversas usa primeiro a chave da organização; a URL base da org só aplica quando há chave de org (senão segue a do servidor).
- **Fallback global:** `OPENAI_PROMPT_PREVIEW_KEY` ou, na sua ausência, `OPENAI_API_KEY`. Sem chave de org **nem** chave de servidor, os endpoints respondem **503** com código `missing_openai_key`.
- **Base URL global:** `OPENAI_API_BASE_URL` (por omissão `https://api.openai.com/v1`).
- **Modelo de chat para assistência:** `OPENAI_ASSIST_MODEL` (por omissão `gpt-4o-mini`). Ver `.env.example`.
- **Persistência e UI:** `apps/api/src/routes/settings.ts` (Zod, `PUT` com omissão de actualização quando o cliente envia máscara ou campo em branco para manter a chave; `null` limpa a chave de org). Respostas mascaram a chave como `••••••••`. Secção na UI: `apps/web/src/pages/SettingsPage.tsx`.

### Privacidade e permissões

- Apenas utilizadores autenticados com acesso à conversa (mesma regra que `GET /conversations/:id`) podem chamar `suggest-reply` e `insights`.
- Notas privadas **não** entram no transcript enviado ao modelo.

---

## Próximos passos sugeridos (roadmap — ainda não implementados)

Estes itens **não** estão no código actual; são evoluções possíveis quando quiserem expandir sem surpresas para quem já opera o sistema:

1. **Rate limit por utilizador / por organização** — limitar chamadas a `suggest-reply` e `insights` (por minuto ou por dia) para controlar custo e abuso, com cabeçalhos ou corpo de erro claros (`429`).

2. **Análise agregada multi-conversa** — endpoint ou job que resume N conversas (ex.: abertas na última semana) para painel de «saúde da fila»; exige definição de agregação, amostragem e custo.

3. **Webhooks de alerta** — quando `insights.alerts` contiver determinados padrões (ou score manual), POST opcional para URL configurada (semelhante a outros webhooks da plataforma).

4. **Ligação ao CRM** — sugestões baseadas em estágio do funil, valor do negócio ou etiquetas do contacto (contexto estruturado além do transcript).

5. **Internacionalização fixa do system prompt** — hoje o system prompt do assistente está em português; pode passar a depender do locale do utilizador ou da organização.

6. **Observabilidade** — métricas (contagem, latência, erros por endpoint) e opcionalmente registo de auditoria «quem pediu sugestão/análise em que conversa» (sem gravar o texto completo, se política o exigir).

7. **Encriptação em repouso dedicada** — hoje a chave de org é armazenada como texto na base de dados (como outras chaves de integração); pode evoluir para KMS ou campo encriptado por aplicação.

---

## Ver também

- [Agente nativo: base de conhecimento e contexto](./AGENT-KB-AND-CONTEXT.md) — fluxo **distinto**: automação com bot, RAG e tools; não confundir com os endpoints de assistência ao humano acima.
