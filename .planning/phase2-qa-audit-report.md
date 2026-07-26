# OpenNexo CRM — Auditoria QA Fase 2 (Comportamento Real)

**Data:** 2026-07-26  
**Escopo:** Validação comportamental de agentes (16 fases) após auditoria estrutural LangGraph (Fases 0–4 concluídas).  
**Branch:** `main` (commits até Fase 4 checkpoint Redis nativo)

---

## Resumo executivo

| Métrica | Resultado |
|---------|-----------|
| **Testes `npm test`** | **108/108** ✅ |
| **Testes `npm run test:audit`** | **157/157** ✅ |
| **Taxa de sucesso (unitários)** | **100%** |
| **Critério de aprovação 100% (produção)** | **NÃO APROVADO** — gaps de wiring e E2E |
| **Regressões detectadas** | **0** (suite existente) |
| **Correções aplicadas nesta auditoria** | Workflow Validator + testes + script CI |

A plataforma possui **validação estrutural sólida** (supervisor, tool validator, strict mode, RAG, memória) mas **ainda não bloqueia automaticamente** todas as respostas inválidas via um validador unificado pós-execução. O `WorkflowValidator` foi implementado como infraestrutura de auditoria; **integração ao pipeline outbound permanece pendiente** (decisão de produto — risco médio).

---

## Arquivos analisados (principais)

| Área | Arquivos |
|------|----------|
| Runtime LangGraph | `apps/api/src/lib/agent-engine/runtime/LangGraphRuntime.ts` (~750 LOC) |
| Runtime OpenNexo | `apps/api/src/lib/agent-engine/runtime/OpenNexoRuntime.ts` |
| Orquestração | `apps/api/src/lib/agent-engine/runtime/orchestrationHelpers.ts` |
| LLM nativo | `apps/api/src/lib/agentNativeLlm.ts` (~2760 LOC) |
| Supervisor | `apps/api/src/lib/agent-engine/supervisor/AgentSupervisorService.ts` |
| Ferramentas | `apps/api/src/lib/agent-engine/validators/ToolValidator.ts` |
| Prompt | `apps/api/src/lib/agentPlaybook.ts`, `PromptValidator.ts` |
| Memória | `apps/api/src/lib/agent-engine/memory/*`, `mem0MemoryBridge.ts` |
| RAG/KB | `knowledgeRetrieval.ts`, `knowledgeQueryEnrichment.ts`, `knowledgeEngine/*` |
| Qualidade pós-exec | `apps/api/src/lib/automationExecutionQuality.ts` |
| Observabilidade | `LangfuseBridge.ts`, `ExecutionTrace.ts`, `AgentGraphEventBus.ts` |
| Checkpoint/HITL | `AgentCheckpointFactory.ts`, `HumanInTheLoopStore.ts` |

---

## Arquivos modificados nesta auditoria

| Arquivo | Alteração |
|---------|-----------|
| `apps/api/src/lib/agent-engine/audit/promptAssemblyAudit.ts` | **NOVO** — Fase 1 prompt |
| `apps/api/src/lib/agent-engine/audit/WorkflowValidator.ts` | **NOVO** — Fases 1–16 unificadas |
| `apps/api/src/lib/agent-engine/audit/*.test.ts` | **NOVO** — 9 casos |
| `apps/api/src/lib/agent-engine/validators/ToolValidator.test.ts` | **NOVO** — 5 casos |
| `apps/api/src/lib/agent-engine/index.ts` | Exports audit |
| `apps/api/package.json` | `test` + `test:audit` expandidos |

**Nenhuma funcionalidade existente foi removida.**

---

## Cobertura de testes

| Suite | Testes | Estado |
|-------|--------|--------|
| `npm test` (CI default) | 108 | ✅ |
| `npm run test:audit` (agente/RAG/memória) | 157 | ✅ |
| LangGraphRuntime integração | 0 | ❌ gap |
| HitlGraphResumeService / HitlDeliveryService | 0 | ❌ gap |
| E2E com LLM real | 0 | ❌ gap (roadmap 2.5) |
| Stress 100 execuções LLM | 0 | ⚠️ simulado (100× WorkflowValidator <5s) |

---

## Resultado por fase

### Fase 1 — Auditoria do Prompt ✅ parcial

| Check | Estado | Evidência |
|-------|--------|-----------|
| Prompt carregado | ✅ | `buildAgentPlaybookFromBlocks`, `applyAgentPlaybookToSystemInstructions` |
| Variáveis substituídas | ✅ | `auditPromptAssembly` detecta `{{...}}` |
| Truncagem | ✅ | Heurística `_truncated`, `...` final |
| Duplicação playbook | ✅ | Marker `[OpenConduit — playbook do agente]` |
| Ordem instruções | ✅ | `PLAYBOOK_PRIORITY_KEYS` |
| Score pré-publicação | ✅ | `PromptValidator` |
| Prompt final ao modelo | ⚠️ | Sem snapshot persistido em todas execuções |

**Gap:** `auditPromptAssembly` não está ligado ao runtime — só disponível via API export + testes.

---

### Fase 2 — Auditoria da Execução ✅ parcial

| Check | Estado |
|-------|--------|
| Plano / nós LangGraph | ✅ trace via `ExecutionTraceBuilder` |
| Ordem nós | ✅ 8 nós default + fan_out_kb opcional |
| Supervisor no grafo | ✅ quando `supervisorEnabled` |
| Loops | ✅ `no_execution_loop` no supervisor |
| Estado atualizado | ✅ checkpoint Redis nativo / mirror |

**Gap:** `LangGraphRuntime.ts` sem testes de integração de grafo.

---

### Fase 3 — Auditoria das Ferramentas ⚠️ crítico (wiring)

| Check | Estado |
|-------|--------|
| Chamada registrada | ✅ `toolOutcomes` no trace |
| Coerência resposta↔tool | ✅ `validateToolExecution` |
| Stall após tool OK | ✅ bloqueia em strict |
| **Ferramentas obrigatórias** | ❌ **`requiredToolNames` nunca passado pelos callers** |

**Evidência:**

```476:480:apps/api/src/lib/agent-engine/runtime/LangGraphRuntime.ts
      const validation = validateToolExecution({
        toolOutcomes: state.toolOutcomes,
        replyText: state.reply,
        strictMode: state.input.engineConfig.strictMode,
      });
```

`ToolValidator.ts` suporta `requiredToolNames` mas **nenhum runtime preenche este campo**.

| Criticidade | Descrição | Arquivo | Correção sugerida |
|-------------|-----------|---------|-------------------|
| **CRÍTICA** | Ferramentas obrigatórias do playbook não são enforced estruturalmente | `LangGraphRuntime.ts:476`, `OpenNexoRuntime.ts:52` | Extrair lista de `promptBuilder.blocks.tools` / fluxo e passar a `validateToolExecution` + `WorkflowValidator` |
| ALTA | Mandatory tools dependem só de heurísticas LLM + prompt | `agentNativeLlm.ts` | Parser seguro de restrições do playbook |

**Não implementado** — alteração de comportamento em produção; requer validação com agentes reais.

---

### Fase 4 — Auditoria da Memória ✅

| Provider | Carregamento | Uso | Persistência | Testes |
|----------|--------------|-----|--------------|--------|
| OpenNexo Memory | ✅ | ✅ appendix | ✅ Prisma/state | ✅ agentEngine.test |
| Mem0 | ✅ opt-in | ✅ bridge | ✅ API Mem0 | ✅ formatMem0PromptAppendix |
| Long/Short/Resumo | ✅ MemoryContextBuilder | ✅ | ✅ | ✅ MemoryExtractor |

---

### Fase 5 — Auditoria da Base de Conhecimento ✅

| Check | Estado |
|-------|--------|
| Busca executada | ✅ `buscar_conhecimento`, appendix proactivo |
| LlamaIndex engine | ✅ opt-in `knowledgeEngine` |
| Query enrichment | ✅ `knowledgeQueryEnrichment.test.ts` |
| Skip heuristics | ✅ `knowledgeSearchSkipConfig` |
| Ranking/rerank | ✅ `knowledgeSearchRanking` |
| Supervisor KB | ✅ `knowledge_used` check |
| Qualidade pós-exec | ✅ `automationExecutionQuality` (tool_ignored, lost_context) |

---

### Fase 6 — Vector Database ✅ (OpenNexo)

| Componente | Estado |
|------------|--------|
| OpenNexo pgvector (Prisma) | ✅ produção |
| Qdrant | **N/A** — não implementado (dep transitiva no lockfile apenas) |
| Embeddings | ✅ via pipeline KB |
| Cache KB | ✅ `knowledgeCache.test.ts` |

---

### Fase 7 — Auditoria do Supervisor ✅

9 checks estruturais em `AgentSupervisorService.ts`:

- `tool_used`, `knowledge_used`, `memory_considered`, `reply_substantive`
- `no_execution_loop`, `strict_mode_honored`, `llm_supervisor`
- Retry até 2× em falhas KB (`shouldRetryAfterSupervisor`)
- Bloqueio pós-retry (`shouldBlockReplyAfterSupervisor`)

**Testes:** 5 casos ✅

**Gap:** Modo `supervisorMode: "llm"` bypass parcial dos checks estruturais.

---

### Fase 8 — Guardrails ⚠️ parcial

| Componente | Estado |
|------------|--------|
| Guardrails dedicado (NeMo/etc.) | **N/A** |
| Strict mode gate | ✅ `StrictModeGate.ts` |
| Tool validator | ✅ |
| Outbound sanitize | ✅ `sanitizeOutboundAgentReply` |
| Prompt injection | ⚠️ só via prompt + supervisor heurístico |

---

### Fase 9 — Auditoria LangGraph ✅ estrutural / ❌ E2E

| Feature | Testes unitários | Integração |
|---------|------------------|------------|
| Nodes/edges | ✅ trace builder | ❌ runtime |
| Conditional edges | ✅ código | ❌ |
| Checkpoint memory/redis | ✅ 4 ficheiros | ⚠️ Redis real opt-in |
| HITL store | ✅ | ❌ resume cross-worker E2E |
| Send API parallel KB | ✅ prefetch | ❌ grafo completo |
| Streaming SSE | ✅ event bus | ❌ E2E WhatsApp |
| BullMQ queue | ✅ priority | ❌ worker E2E |

---

### Fase 10 — Testes de Stress ⚠️ simulado

| Cenário | Executado | Resultado |
|---------|-----------|-----------|
| 100 execuções consecutivas | ✅ 100× `validateAgentWorkflow` | <5s, 100% pass |
| 1000 tools/RAG/memória | ❌ | Não automatizado |
| Mensagens longas/curtas | ⚠️ | Casos unitários isolados |
| Timeout/HTTP fail | ⚠️ | `automationHttpToolExecute.test.ts` parcial |

---

### Fase 11 — Regressão ✅

Todos os testes pré-existentes + novos passam. Sem regressões na suite automatizada.

---

### Fase 12 — Testes de Segurança ⚠️ parcial

| Vetor | Cobertura |
|-------|-----------|
| Prompt injection | 1 caso estrutural WorkflowValidator |
| Jailbreak | ❌ sem suite dedicada |
| Ferramenta inexistente | ⚠️ HTTP tool errors |
| Loop infinito | ✅ supervisor `no_execution_loop` |
| Resposta sem contexto | ✅ `lost_context`, KB supervisor |

---

### Fase 13 — Performance ⚠️

Métricas de latência/tokens existem no trace (`latencyMs`, `tokens`) mas **sem benchmark automatizado** nesta fase.

WorkflowValidator: 100 validações ~3–6ms cada (sintético).

---

### Fase 14 — Observabilidade (Langfuse) ⚠️

| Check | Estado |
|-------|--------|
| Config detection | ✅ `isLangfuseConfigured` |
| Ingest trace | ⚠️ smoke only |
| Spans ferramentas/memória | ✅ código presente, env-dependent |

---

### Fase 15 — Métricas

Calculáveis via `WorkflowAuditReport.metrics`:

- `successRate`, `criticalFailures`, `highFailures`
- `toolsInvoked`, `toolsRequiredMissing`
- `supervisorApproved`, `promptReady`, `qualitySignalCount`

**Não persistidas em DB** — apenas estrutura de relatório.

---

### Fase 16 — Workflow Validator ✅ implementado / ⚠️ não wired

Novo módulo unificado:

- `validateAgentWorkflow()` — checklist F1–F16
- `shouldBlockOutboundFromWorkflow()` — gate de envio
- `auditPromptAssembly()` — Fase 1

**Estado:** exportado em `@openconduit/api` agent-engine index; **não invocado** em `agentBotNativeReplyPipeline` / `LangGraphRuntime.respond`.

---

## Problemas encontrados

| ID | Criticidade | Descrição | Arquivo | Status |
|----|-------------|-----------|---------|--------|
| QA-001 | **CRÍTICA** | `requiredToolNames` API morta — mandatory tools não enforced | `LangGraphRuntime.ts:476` | **PENDENTE** |
| QA-002 | **ALTA** | WorkflowValidator não bloqueia outbound em produção | pipeline outbound | **PENDENTE** |
| QA-003 | **ALTA** | LangGraphRuntime sem testes integração | `LangGraphRuntime.ts` | **PENDENTE** |
| QA-004 | MÉDIA | HITL resume/delivery sem testes E2E | `HitlDeliveryService.ts` | **PENDENTE** |
| QA-005 | MÉDIA | Langfuse ingest só smoke | `LangfuseBridge.ts` | **PENDENTE** |
| QA-006 | INFO | Qdrant não existe no produto | N/A | N/A |
| QA-007 | INFO | Guardrails dedicado não existe | N/A | N/A |

---

## Problemas corrigidos (seguros)

| ID | Correção |
|----|----------|
| QA-FIX-01 | Criado `WorkflowValidator` + `promptAssemblyAudit` |
| QA-FIX-02 | Criado `ToolValidator.test.ts` (5 casos) |
| QA-FIX-03 | Expandido `npm test` (+14 testes audit core) |
| QA-FIX-04 | Novo script `npm run test:audit` (157 testes agente/RAG) |

---

## Melhorias sugeridas (roadmap)

1. **Wire `validateAgentWorkflow`** no nó `respond` do LangGraph quando `strictMode && supervisorEnabled`.
2. **Parser `requiredToolNames`** a partir de `promptBuilder.blocks.tools` / restrições.
3. **Testes integração LangGraph** com executor mock (sem LLM real).
4. **Stress CI nightly:** 1000× validateToolExecution + analyzeExecutionQualityFromLogs.
5. **Golden fixtures** por agente existente (snapshot prompt + tool sequence esperada).
6. **Langfuse contract tests** com mock HTTP.
7. **E2E opt-in** com `AGENT_E2E=1` e API key (roadmap 2.5).

---

## Riscos

| Risco | Impacto | Mitigação actual |
|-------|---------|-------------------|
| Agente ignora ferramenta obrigatória | Resposta incorrecta ao cliente | Prompt + supervisor heurístico (não 100%) |
| Resposta enviada com falha crítica | Confiança do CRM | Strict mode + supervisor retry (parcial) |
| Regressão LangGraph | HITL/checkpoint quebrado | 108+ testes unitários, sem E2E |
| Prompt truncado silencioso | Perda de regras | `auditPromptAssembly` disponível, não wired |

---

## Critério de aprovação — veredicto

| Critério | Aprovado? |
|----------|-----------|
| Agente segue 100% regras obrigatórias | ❌ depende LLM + prompt |
| Nenhuma ferramenta obrigatória ignorada | ❌ QA-001 |
| Resultado das ferramentas utilizado | ✅ heurísticas + rescue determinístico |
| Supervisor valida execuções | ✅ quando enabled |
| Workflow Validator aprova fluxos | ✅ módulo pronto; ❌ não wired |
| Memória funciona | ✅ |
| RAG funciona | ✅ |
| Sem regressões | ✅ |
| Testes automatizados passam | ✅ 157/157 audit |
| Retrocompatibilidade | ✅ |

### Veredicto final: **AUDITORIA FASE 2 CONCLUÍDA COM RESSALVAS**

Infraestrutura de auditoria comportamental **implementada e testada**. Produção **não atinge 100%** até wiring de QA-001/QA-002 e testes E2E LangGraph.

---

## Como executar

```bash
cd apps/api
npm test              # 108 testes CI
npm run test:audit    # 157 testes agente/RAG/memória/QA
```

### Uso programático (novo)

```typescript
import { validateAgentWorkflow, shouldBlockOutboundFromWorkflow } from "./agent-engine/index.js";

const report = validateAgentWorkflow({
  userMessage, replyText, toolOutcomes, kbMeta,
  strictMode: true, supervisorEnabled: true,
  systemPromptPreview, requiredToolNames: ["buscar_conhecimento"],
});

if (shouldBlockOutboundFromWorkflow(report)) {
  // bloquear envio / retry
}
```

---

*Relatório gerado na Segunda Fase da Auditoria QA OpenNexo CRM.*
