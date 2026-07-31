# Baseline Audit — OpenNexo MCP

| Campo | Valor |
|-------|-------|
| **Data** | 2026-07-30 |
| **Fase** | 0 — Baseline |
| **Fonte** | OpenNexo MCP (`search_execution`, `get_execution_inspector`, `search_agent`) |
| **Agente amostra** | Auda (`e8ca18c8-3088-4e75-b381-0d3163011584`) |

Auditoria de linha de base antes da reconstrução do Motor de Execução.
Todos os valores provêm de MCP — não inferidos.

---

## Agentes em produção (MCP)

| ID | Nome | Activo | Tipo |
|----|------|--------|------|
| `e8ca18c8-3088-4e75-b381-0d3163011584` | Auda | ✅ | WEBHOOK |
| `378cd663-6467-4f01-b72f-932339f809c7` | AUDA 2 - PROMPT 2 | ❌ | WEBHOOK |

> Apenas o agente **Auda** está activo. Baseline concentrado neste agente (hotel/check-in).

---

## Execuções amostradas (últimas 10)

Período: 2026-07-31T00:34 – 2026-07-31T02:12 UTC  
Conversa: `e9a8ea43-e888-474e-b929-f767903b7f38`  
Status: **10/10 success**

---

## Execução representativa #1 — consulta + tools

**ID:** `748be9ec-be86-4cd6-891d-da67a02548f1`  
**Mensagem:** «qual o endereço da club e como é feito o check-in?»  
**Duração:** 10 078 ms  
**Runtime:** openconduit  

### Engine config

| Flag | Valor |
|------|-------|
| schedulerEnabled | true |
| toolExecutionMode | runtime_owned |
| legacyOpenconduitBypass | false |
| workflowEngineEnabled | false |
| supervisorEnabled | true (structural) |

### Tools executadas

| Tool | OK |
|------|-----|
| audaar_consultar_reserva | ✅ |
| audaar_consultar_disponibilidade | ✅ |

### Timeline observada

```
inbound → context → rag → tool_scheduler (1 tool) → llm →
  audaar_consultar_reserva → audaar_consultar_disponibilidade →
  llm complete → reply_synthesizer (reservation_s1) → quality WARN → outbound
```

### Achados baseline

| # | Achado | Severidade | Componente responsável |
|---|--------|------------|------------------------|
| B-001 | **Sem eventos `engine_*`** — Execution Engine não activa | 🔴 Alta | P-010 bypass spine |
| B-002 | Reply Synthesizer forçou `reservation_s1` (372 chars) | 🟡 Média | P-030 patch específico |
| B-003 | Quality WARN «contexto perdido» — LLM não usou dados tool | 🟡 Média | P-005/P-032 compensação |
| B-004 | Scheduler pré-executou 1 tool; LLM invocou 2 adicionais | 🟡 Média | Scheduler vs LLM overlap |
| B-005 | Supervisor: «Pendente» (não executou validação estrutural) | 🟡 Média | Supervisor não wired |

---

## Execução representativa #2 — check-in FAQ

**ID:** `694676c4-a4df-4794-8bdf-dd6775bbcaa7`  
**Mensagem:** «Como faz o checkin?»  
**Duração:** 30 436 ms  
**Runtime:** openconduit (LangGraph wrapper parcial)

### Tools executadas

Nenhuma registada no inspector (scheduler interno).

### Timeline observada

```
inbound → context → rag → tool_scheduler (1 tool) → llm →
  reply_synthesizer (reservation_s1) → quality WARN → agent_engine_trace (langgraph) → outbound
```

### Achados adicionais

| # | Achado | Severidade |
|---|--------|------------|
| B-006 | LangGraph trace presente mas sem layers Compiler/Planner/Contract | 🔴 Alta |
| B-007 | Mesmo template S1 (372 chars) independente da pergunta | 🟡 Média |
| B-008 | RAG appendix preparado mas resposta veio do Synthesizer | 🟡 Média |

---

## Pipeline actual vs. pipeline alvo

| Layer | Presente na timeline MCP? | Autoritativo? |
|-------|---------------------------|---------------|
| Prompt Compiler | ❌ | — |
| Prompt IR | ❌ | — |
| Execution Planner | ❌ | — |
| Execution Contract | ❌ | — |
| Capability Graph | ❌ (EIL silencioso) | Parcial |
| Facts Engine | ❌ | Parcial (flowSlots) |
| Tool Scheduler | ✅ | Sim |
| LLM | ✅ | Decisões demasiado amplas |
| Reply Synthesizer | ✅ | Compensa LLM (patch) |
| Supervisor | ⚠️ Pendente | Não |
| Workflow Validator | ❌ | — |
| Execution Engine | ❌ `engine_*` | Não |

---

## Testes unitários baseline (local)

Comando: 11 ficheiros agent-engine (compiler, planner, scheduler, reply, checkin, validators).

```
126 tests — 126 pass — 0 fail
Duration: ~1.3s
```

Estes testes constituem a **regression suite Fase 0** até execuções E2E via MCP serem automatizadas.

---

## Architecture Score baseline (componente runtime)

Estimativa baseada em Patch Registry + MCP audit:

| Dimensão | Score (1–10) |
|----------|--------------|
| Coesão | 4 |
| Baixo acoplamento | 3 |
| Reutilização | 4 |
| Explicabilidade | 5 |
| Auditabilidade | 6 |
| Performance | 6 |
| Fiabilidade | 5 |
| Testabilidade | 7 |
| Escalabilidade | 4 |
| Observabilidade | 7 |
| **Total** | **5.1** |

Meta Fase 9: ≥ 8.0

---

## Gaps confirmados (MCP + código)

1. **Dual runtime** — produção bypassa `ExecutionEngine` (B-001, B-006).
2. **Reply Synthesizer como guardrail** — substitui LLM com templates S1 (B-002, B-007).
3. **Supervisor não valida** — estado «Pendente» em execuções success (B-005).
4. **Sem Prompt IR** — playbook interpretado repetidamente por múltiplos parsers.
5. **Patches Embratur/hotel** — concentrados em 6 ficheiros (ver PATCH-REGISTRY).

---

## Próximos passos (Fase 1)

1. Formalizar `PromptIR` em `agent-engine/contract/`.
2. Consolidar parsers → Compiler v2.
3. Manter regression suite verde (126 tests).

---

## Referências MCP

- Execução: `748be9ec-be86-4cd6-891d-da67a02548f1`
- Execução: `694676c4-a4df-4794-8bdf-dd6775bbcaa7`
- Agente: `e8ca18c8-3088-4e75-b381-0d3163011584`
