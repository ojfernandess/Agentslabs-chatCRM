# Phase 2 Spine Audit — OpenNexo MCP

| Campo | Valor |
|-------|-------|
| **Data** | 2026-07-30 |
| **Fase** | 2d — Cleanup & MCP audit |
| **Fonte** | OpenNexo MCP + suite local |
| **Agente** | Auda (`e8ca18c8-3088-4e75-b381-0d3163011584`) |

---

## Estado do código (local)

| Sub-fase | Modo | Estado |
|----------|------|--------|
| 2a | shadow | ✅ |
| 2b | primary + fallback | ✅ |
| 2c | only + LlmTurnAdapter | ✅ |
| 2d | cleanup + audit | ✅ |

### Entregáveis 2d

- `spineTurnContextBindings.ts` — helper único para resolve legacy/only
- `runWorkflowRuntimeTurn` removido do export público `agent-engine/index.ts`
- `getTurnPolicy()` removido (dead code)
- Golden **G-009** — paridade crítica engine vs legacy
- PATCH-REGISTRY P-010/P-090/P-091 actualizados

---

## Produção MCP (pré-deploy spine)

**Execução:** `748be9ec-be86-4cd6-891d-da67a02548f1` (2026-07-31T02:12 UTC)

| Check | Resultado |
|-------|-----------|
| `unifiedSpineMode` no engine config | **Ausente** (default `off`) |
| Eventos `engine_*` na timeline | **0** — checklist: «Sem eventos engine_* (turno legado ou bypass)» |
| Runtime | openconduit |
| Tools | 2/2 ok |

> Esperado: produção ainda não activou `AGENT_ENGINE_UNIFIED_SPINE`. Baseline B-001 permanece até deploy staging.

---

## Checklist pós-deploy staging

| # | Critério | Comando / MCP |
|---|----------|---------------|
| 1 | Shadow activo | `AGENT_ENGINE_UNIFIED_SPINE=shadow` |
| 2 | Timeline `engine_begin`, `engine_plan`, `engine_contract` | `get_execution_inspector` |
| 3 | Shadow divergência < 1% Auda | logs `engine_shadow` |
| 4 | Primary fallback < 1% | logs `engine_primary_fallback` |
| 5 | Only sem fallback | zero `engine_primary_fallback`; `execution_engine` only summary |
| 6 | Golden G-001–G-009 verdes | `baselineGoldenTurns.test.ts` |

---

## Timeline esperada (modo shadow/primary/only)

```
engine_begin → engine_plan → engine_contract →
tool_scheduler → engine_refresh → execute_llm →
llm → reply_synthesizer → engine_finalize
```

---

## Patches Fase 2 — resolução

| ID | Antes | Depois Fase 2 |
|----|-------|---------------|
| P-010 | Bypass ExecutionEngine em openconduit | Wired via UnifiedSpineBridge |
| P-090 | Spine não autoritativo | primary/only autoritativo |
| P-091 | WorkflowRuntimeOrchestrator export público | Deprecated; tests only |

---

## Referências

- [ADR-0005](../adr/ADR-0005.md)
- [BASELINE-AUDIT-2026-07-30](./BASELINE-AUDIT-2026-07-30.md)
- [PATCH-REGISTRY](../PATCH-REGISTRY.md)
