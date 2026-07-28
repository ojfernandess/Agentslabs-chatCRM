# OpenNexo Runtime Roadmap — Agent Execution Architecture

> **Princípio:** LLM pensa · Runtime executa · Decisões no contrato, não no prompt textual.

## Estado base (Jul 2026)

| Camada | Status |
|--------|--------|
| Pós-execução (Supervisor, ToolValidator, WF advisory, Inspector) | ✅ Maduro |
| EIL (Facts, CapabilityGraph, PolicyEngine) | 🟡 Beta |
| Pré-execução (Intent, PromptContract, Scheduler) | ✅ Scheduler + TurnContext |
| Prod vs GitHub | ⚠️ Alinhar deploy após cada fase |

---

## Fase 0 — Estabilização outbound (Semana 1) `DONE`

**Objectivo:** nunca enviar reply quando contrato de turno falha em strict mode.

| Task | Status |
|------|--------|
| `shouldBlockOutboundFromTurnContract()` | ✅ |
| LangGraph `supervisor` + `respond` gate | ✅ |
| Remover `v2/NativePromptAssembly.ts` órfão | ✅ |
| MCP resources agents/eil 404 | ✅ (turn/contract + eil) |

**Critério de aceite:** exec com `audaar_consultar_reserva` required + só KB → outbound bloqueado.

---

## Fase 1 — TurnContext + PromptCompiler (Semanas 2–4) `DONE (foundation)`

**Objectivo:** um objecto imutável por turno; runtime deixa de re-parsear markdown mid-flight.

| Task | Status |
|------|--------|
| `core/types.ts` — TurnContext, PromptContract, ExecutionContract | ✅ |
| `compiler/PromptCompiler.ts` | ✅ |
| `core/buildTurnContext.ts` | ✅ |
| Integrar LangGraph state + trace | ✅ |
| Testes unitários | ✅ |
| Export `agent-engine/index.ts` | ✅ |

**Critério de aceite:** `buildTurnContext()` produz contract idempotente a partir de playbook existente sem alterar prompts.

---

## Fase 2 — Tool Scheduler determinístico (Semanas 5–8) `DONE`

**Objectivo:** required tools invocadas pelo Runtime antes do LLM.

| Task | Status |
|------|--------|
| `scheduler/TurnToolScheduler.ts` | ✅ |
| Substituir nó `select_tool` → `schedule_tools` LangGraph | ✅ |
| Invoker HTTP genérico (`invokeSingleNativeAgentTool` + `invokeScheduledTools`) | ✅ |
| Teste: plan + flag scheduler | ✅ |
| Activar em prod: `agentEngine.schedulerEnabled: true` | 🔲 |

---

## Fase 3 — Supervisor + Validator só contratos (Semanas 9–11) `DONE`

| Task | Status |
|------|--------|
| Supervisor checks em `ExecutionContract` | ✅ |
| WF Validator F3/F7 sem re-parse playbook | ✅ |
| Supervisor LLM usa contrato estruturado (não markdown) | ✅ |

---

## Fase 4 — Resiliência genérica (Semanas 12–15) `DONE`

| Task | Status |
|------|--------|
| Mandatory tool recovery (1 invoke determinístico) | ✅ |
| Smart fallback config-driven | ✅ |
| Self-healing: loop / validation repeat | ✅ |
| Activar em prod: `agentEngine.resilienceEnabled: true` | 🔲 |

---

## Fase 5 — MCP + Observabilidade (contínuo) `DONE`

| Task | Status |
|------|--------|
| `opennexo://turn/{executionId}` | ✅ |
| `opennexo://contract/{executionId}` | ✅ |
| Langfuse spans por camada | ✅ |
| Tools MCP `search_turn` / `search_contract` | ✅ |

---

## Compatibilidade

- Prompts existentes compilados automaticamente
- Feature flags: `agentEngine.schedulerEnabled`, `agentEngine.resilienceEnabled`, `agentEngine.promptCompilerEnabled` (futuro)
- Zero IFs de segmento (hotel/clínica/etc.) no código
