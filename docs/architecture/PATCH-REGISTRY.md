# Patch Registry — OpenNexo AI Runtime

| Campo | Valor |
|-------|-------|
| **Versão** | 1.0.0 |
| **Data baseline** | 2026-07-30 |
| **Fase** | 0 — Inventário |
| **Próxima revisão** | Fase 7 (eliminação) |

Registo central de patches, hacks, workarounds e acoplamentos prompt-específicos no runtime.
Classificação obrigatória antes de qualquer alteração (AGS + RCA).

## Legenda de classificação

| Classe | Significado | Acção |
|--------|-------------|-------|
| **Específico** | Depende de tool name, segmento, playbook ou cliente | Eliminar → Prompt IR / Policy |
| **Temporário** | Workaround documentado como curto prazo | Eliminar na fase indicada |
| **Genérico** | Padrão reutilizável mal localizado | Migrar para camada correcta |
| **Arquitetural** | Responsabilidade na camada errada | Refactor de componente |

## Métricas baseline (Fase 0)

| Métrica | Valor |
|---------|-------|
| Linhas `agentNativeLlm.ts` | 3 861 |
| Patches catalogados | 47 |
| Específico | 28 |
| Temporário | 6 |
| Genérico (mal localizado) | 10 |
| Arquitetural | 3 |
| Runtime paths de produção | 2 (monolito + ExecutionEngine) |
| Testes baseline agent-engine | 126 / 126 pass |
| Execuções MCP amostradas | 10 (agente Auda) |

## Patches por componente

### 1. `agentNativeLlm.ts` — Runtime monolítico (CRÍTICO)

| ID | Linhas | Descrição | Classe | Migração | Fase |
|----|--------|-----------|--------|----------|------|
| P-001 | 207, 281–284 | Regex `/embratur[-_]?reference/i` para detectar tool | Específico | Capability Graph node | 4 |
| P-002 | 2310–2343 | Pré-resolução Embratur antes do Scheduler | Específico | Planner + Facts Engine | 3 |
| P-003 | 2392–2418 | Persistência N/C reserva + catálogo no Scheduler | Específico | Facts Engine ingest | 3 |
| P-004 | 2848–2852 | Gate check-in → `buildEmbraturIncompleteToolError` | Específico | Policy Engine + Capability | 4 |
| P-005 | 3215–3238 | `ensureDeliveringReply()` — força S1 / fallback vazio | Específico | Reply templates no IR | 6 |
| P-006 | 3241–3316 | Máquina S4c/S9 party-size (N=1 vs N≥2) | Específico | FlowDefinition + Planner | 3 |
| P-007 | 3318–3358 | `applyConfirmationPhaseTransitions()` S9→S9b→S10 | Específico | Workflow Runtime + Facts | 3 |
| P-008 | 1548–1549 | System append «Modelo S1 / Modelo Verificar» | Específico | Context packer (step IR) | 6 |
| P-009 | 498–527, 768–774 | Regex check-in realizado → ack fixo | Específico | Completion criteria IR | 6 |
| P-010 | 1828–1829 | Bypass explícito ExecutionEngine (openconduit) | Arquitetural | ✅ UnifiedSpineBridge | 2 |
| P-011 | 2703 | Preferir nome `audaar_*` sobre `oc_tool_*` | Genérico | Tool Registry alias map | 4 |
| P-012 | 2763 | Comentário fluxo S9 partido por main_guest | Temporário | Capability deps | 4 |

### 2. `scheduler/TurnToolScheduler.ts`

| ID | Linhas | Descrição | Classe | Migração | Fase |
|----|--------|-----------|--------|----------|------|
| P-020 | 12–13 | Import `checkin/embraturTravelForm` | Específico | Schema-driven args | 4 |
| P-021 | 40–48 | Aliases Audaar (`reservationIdOrLocalizer`, etc.) | Específico | Tool schema metadata | 4 |
| P-022 | 100–149 | Montagem payload check-in + `assembleEmbraturFromSources` | Específico | Capability pre-conditions | 4 |
| P-023 | 201–203 | Skip schedule se Embratur incompleto | Específico | `canInvokeTool()` only | 4 |
| P-024 | 258–267 | Appendix «SCRIPT FIXO Modelo S1» pós consultar_reserva | Específico | Planner step template | 6 |
| P-025 | 100, 201, 259 | Regex `/check[_-]?in\|consultar[_-]?reserva/i` | Específico | Plan required tools | 4 |

### 3. `reply/ReplySynthesizer.ts`

| ID | Linhas | Descrição | Classe | Migração | Fase |
|----|--------|-----------|--------|----------|------|
| P-030 | 187–235 | `buildModeloS1FromReservationPayload` + URL Audaar | Específico | IR completion template | 6 |
| P-031 | 390–425 | Templates S9 / S4c / S10 hardcoded | Específico | IR completion templates | 6 |
| P-032 | 469–532 | `ensureDeliveringReply` — C3→S1, S9, S10 | Específico | Policy + step templates | 6 |
| P-033 | 284, 504 | Regex `consultar[_-]?reserva` | Específico | Plan step binding | 6 |
| P-034 | 478, 409 | Regex `embratur[-_]?reference` | Específico | Capability node id | 6 |
| P-035 | 235 | URL fixa `pms.audaar.com.br/checkin/...` | Específico | Prompt / tool config | 7 |

### 4. `checkin/` — Domínio Embratur/FNRH

| ID | Ficheiro | Descrição | Classe | Migração | Fase |
|----|----------|-----------|--------|----------|------|
| P-040 | `embraturRuntimeGuards.ts` | `isCheckInCompletionToolName`, block until Embratur | Específico | Policy Engine | 4 |
| P-041 | `embraturRuntimeGuards.ts` | `isEmbraturReferenceToolName` regex | Específico | Capability Graph | 4 |
| P-042 | `embraturTravelForm.ts` | Ficha S9b → payload check-in | Genérico | Tool adapter (fora runtime) | 7 |
| P-043 | `embraturReferenceCatalog.ts` | Catálogo FNRH + templates S9 | Genérico | Facts ingest + IR template | 7 |
| P-044 | `toolOutcomeParsing.ts` | HTTP 200 + validationError → failure | Genérico | Tool Runtime (correct layer) | — |
| P-045 | `embraturReferenceResolver.ts` | Resolução domínios FNRH | Genérico | Facts Engine + tool | 7 |

### 5. `validators/` — Playbook parsing (hotel-tuned)

| ID | Ficheiro | Descrição | Classe | Migração | Fase |
|----|----------|-----------|--------|----------|------|
| P-050 | `requiredToolNamesParser.ts:91–135` | `GENERIC_TURN_PATTERNS` (C2/C3/C8/S9…) | Genérico | Prompt IR `turnPatterns[]` | 1 |
| P-051 | `requiredToolNamesParser.ts:265–289` | Scoring hotel (checkin, ficha, upload) | Específico | IR pattern metadata | 1 |
| P-052 | `turnPolicyParser.ts:421–433` | HJ2XQZXO-FICHA → S10 exclusive | Específico | IR policy rule | 1 |
| P-053 | `turnPolicyParser.ts:556–618` | S9 exclusivity vs S10 | Específico | IR policy rule | 1 |
| P-054 | `playbookRuntimePolicy.ts:137–147` | C9 exclui embratur/reference | Específico | IR forbidden pairs | 1 |
| P-055 | `confirmationTurnGuards.ts` | Detecção titular/companion/ficha (S4c, C11) | Genérico | Intent Analyzer + Facts | 3 |

### 6. `audit/WorkflowValidator.ts`

| ID | Linhas | Descrição | Classe | Migração | Fase |
|----|--------|-----------|--------|----------|------|
| P-060 | 234, 254 | Regex NLP «check-in concluído», «reserva confirmada» | Genérico | Validar Facts + Plan | 5 |
| P-061 | 370 | Fase «Guardrails» strict mode | Genérico | Policy Engine audit | 5 |
| P-062 | — | Audit de prompt assembly (NLP) | Arquitetural | Observabilidade only | 5 |

### 7. `resilience/TurnResilience.ts`

| ID | Linhas | Descrição | Classe | Migração | Fase |
|----|--------|-----------|--------|----------|------|
| P-070 | 180–187 | Fallback mensagem check-in incompleto | Específico | Policy-driven fallback | 6 |

### 8. `continuation/postCompletionFollowUp.ts`

| ID | Linhas | Descrição | Classe | Migração | Fase |
|----|--------|-----------|--------|----------|------|
| P-080 | 52–108 | Passo 8 pós check-in, suppress S10 ack | Específico | Workflow step IR | 3 |

### 9. Dual runtime / spine fragmentado

| ID | Componente | Descrição | Classe | Migração | Fase |
|----|------------|-----------|--------|----------|------|
| P-090 | `ExecutionEngine.ts` | Spine canónico não usado em openconduit | Arquitetural | ✅ primary/only via bridge | 2 |
| P-091 | `WorkflowRuntimeOrchestrator.ts` | Deprecated mas documentado como spine | Temporário | ✅ export removido (2d) | 2 |
| P-092 | `contract/`, `v2/` | Directórios IR vazios | Arquitetural | Prompt IR module | 1 |

## Dependências cruzadas (proibidas — a eliminar)

```
agentNativeLlm ──imports──► checkin/*
TurnToolScheduler ──imports──► checkin/*
ReplySynthesizer ──imports──► checkin/*
WorkflowValidator ──reads──► playbook text (NLP)
Supervisor ──partial──► playbook-derived hints
```

## Plano de eliminação por fase

| Fase | Patches alvo | Meta |
|------|--------------|------|
| 1 | P-050–P-054, P-092 | IR formal; parsers consolidados |
| 2 | P-010, P-090, P-091 | Spine único |
| 3 | P-006–P-007, P-002, P-080 | Planner + Workflow |
| 4 | P-001, P-004, P-020–P-025, P-040–P-041 | Scheduler desacoplado |
| 5 | P-060–P-062 | Supervisor/WV estruturais |
| 6 | P-005, P-008, P-009, P-030–P-034, P-070 | LLM context + Reply genérico |
| 7 | P-035, P-042–P-045 | Domínio fora do runtime |

## Regra de evolução

**Proibido** adicionar entradas «Específico» ou «Temporário» após Fase 0.
Novos comportamentos → Prompt IR → camada genérica.

## Referências

- [ADR-0003](./adr/ADR-0003.md) — Unified Execution Spine
- [BASELINE-AUDIT](./baseline/BASELINE-AUDIT-2026-07-30.md)
- [AGS.md](./AGS.md)
- [RCA-0001](./rca/RCA-0001.json)
