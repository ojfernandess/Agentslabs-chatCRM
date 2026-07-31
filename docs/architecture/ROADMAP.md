# Roadmap — Reconstrução do Motor de Execução OpenNexo

| Campo | Valor |
|-------|-------|
| **Versão** | 1.0.0 |
| **Data** | 2026-07-30 |
| **Status** | Aprovado para execução |
| **ADR principal** | [ADR-0003](./adr/ADR-0003.md) |
| **Baseline** | [BASELINE-AUDIT-2026-07-30](./baseline/BASELINE-AUDIT-2026-07-30.md) |
| **Patches** | [PATCH-REGISTRY](./PATCH-REGISTRY.md) |
| **Duração estimada** | ~6 meses (1–2 engineers) |

---

## 1. Visão e princípio fundamental

> **O Prompt define O QUE. O Planner define COMO. O Scheduler define EM QUAL ORDEM. O Runtime executa. O LLM raciocina.**

Nenhum componente assume responsabilidade de outro. Toda correção passa por RCA e altera **apenas a camada responsável**.

### Critério máximo de aceitação (projeto completo)

| # | Critério |
|---|----------|
| 1 | Novo agente criado **apenas** escrevendo Prompt |
| 2 | **Zero** alteração no Runtime para suportar novo agente |
| 3 | **Zero** IF/guardrail/exceção específica no código |
| 4 | Prompt compilado para IR **antes** da execução |
| 5 | Planner gera plano; Scheduler controla tools; Runtime controla estado |
| 6 | Supervisor e Workflow Validator **não** interpretam Prompt/NLP |
| 7 | LLM: raciocínio, args, reply — **nunca** arquitectura |
| 8 | Toda decisão baseada em Contract, Plan, Facts, Capabilities, Policies |

---

## 2. Estado actual vs. estado alvo

### 2.1 Arquitectura actual (produção)

```
Prompt (texto, re-interpretado a cada turno)
    ↓
agentNativeLlm.ts (3 861 linhas — monolito)
    ├── patches Embratur/hotel inline
    ├── TurnToolScheduler (parcial, acoplado checkin/)
    ├── ReplySynthesizer (compensação S1–S10)
    ├── phase machine S4c/S9/S10
    └── LLM (decide tools, workflow, retry)

ExecutionEngine.ts ──► existe mas BYPASS em openconduit
```

### 2.2 Arquitectura alvo

```
Prompt
  ↓ Prompt Compiler
Prompt IR (versioned, cached)
  ↓ Intent Analyzer
Execution Planner → Execution Plan (DAG)
  ↓
Execution Contract + Capability Graph + Facts Engine + Policy Engine
  ↓ Tool Scheduler
  ↓ Workflow Runtime
  ↓ Execution Engine (spine único)
  ↓ LLM Adapter (call + streaming only)
  ↓ Supervisor (estrutural)
  ↓ Workflow Validator (estrutural)
  ↓ Audit Engine
```

### 2.3 Métricas de transformação

| Métrica | Baseline (F0) | Meta (F9) |
|---------|---------------|-----------|
| Linhas `agentNativeLlm.ts` | 3 861 | < 800 |
| Patches catalogados (P-001–P-092) | 47 | 0 específicos |
| Scan hits (`scan-runtime-patches.mjs`) | 421 | ↓ monotónico |
| Runtime paths produção | 2 | 1 |
| Layers visíveis MCP timeline | 3 | ≥ 12 |
| Architecture Score | 5.1 | ≥ 8.0 |
| System prompt tokens/turno | baseline | −60% |
| Testes regression | 135+ | verde contínuo |

---

## 3. Mapa de componentes — o que será implementado e corrigido

| Componente | Estado actual | Será implementado | Será corrigido/eliminado |
|------------|---------------|-------------------|--------------------------|
| **Prompt Compiler** | Parcial (`PromptCompiler.ts`) | `compilePromptToIR()`, Compiler v2 | Duplicação com parsers |
| **Prompt IR** | ❌ Inexistente | `contract/PromptIR.ts`, schema v1.0 | Dirs `contract/`, `v2/` vazios |
| **Intent Analyzer** | Parcial (`analyzeIntent`) | Módulo dedicado, entities genéricos | Lógica em `confirmationTurnGuards` |
| **Execution Planner** | Duplicado (2 planners) | Planner unificado + Plan DAG | Phase machine em `agentNativeLlm` |
| **Execution Contract** | Existe, não autoritativo | Contract derivado do IR | Overrides inline no monolito |
| **Capability Graph** | EIL parcial | Fonte única de pre-conditions | Regex tool-name nos guards |
| **Facts Engine** | EIL parcial | Ingest unificado, session facts | flowSlots ad hoc espalhados |
| **Policy Engine** | Parcial | Avalia `PolicyRule[]` do IR | Regras em `turnPolicyParser` regex |
| **Tool Scheduler** | Acoplado checkin/ | Input: Plan+Capabilities only | P-020–P-025, imports checkin/ |
| **Workflow Runtime** | Deprecated orchestrator | Step engine via IR flows | `postCompletionFollowUp` hotel |
| **Execution Engine** | Não usado openconduit | Spine único produção | P-010 bypass |
| **LLM Adapter** | Monolito | Thin wrapper em `agentNativeLlm` | Decisões tool/workflow/retry |
| **Reply Synthesizer** | Templates S1–S10 | Templates driven by IR | P-030–P-035 (131 scan hits) |
| **Supervisor** | Parcial, NLP hints | Valida Contract/Plan/Facts | Interpretação playbook |
| **Workflow Validator** | NLP audit phases | Valida Plan+State+Facts | Regex «check-in concluído» |
| **Audit Engine** | Langfuse parcial | Timeline completa engine_* | Layers em falta na MCP |
| **checkin/** | Runtime guards | → Tool adapters only | P-040–P-045 guards no runtime |
| **AGS / CI** | Fase 1 | Pre-commit, lint, simulator | Bloqueio patches novos |

---

## 4. Fases detalhadas

---

### Fase 0 — Baseline, Inventário e Governança ✅ CONCLUÍDA

**Duração:** 1–2 semanas  
**Dependências:** nenhuma

#### Implementado

| Entregável | Caminho | Status |
|------------|---------|--------|
| Patch Registry (47 patches) | `docs/architecture/PATCH-REGISTRY.md` | ✅ |
| Baseline MCP Audit | `docs/architecture/baseline/BASELINE-AUDIT-2026-07-30.md` | ✅ |
| ADR-0003 (proposed) | `docs/architecture/adr/ADR-0003.md` | ✅ |
| Regression golden turns (9) | `agent-engine/regression/baselineGoldenTurns.test.ts` | ✅ |
| Patch scan CI | `apps/api/scripts/scan-runtime-patches.mjs` | ✅ |
| Manifest baseline | `agent-engine/regression/baselineManifest.json` | ✅ |

#### Corrigido

Nada — fase de medição apenas.

#### Critério de saída

- [x] Patch Registry ≥ 95% hotspots mapeados
- [x] 126 testes agent-engine verdes
- [x] 9 golden turns verdes
- [x] MCP audit 10 execuções Auda
- [x] Scan baseline congelado (421 hits)

---

### Fase 1 — Prompt IR Formal ✅ CONCLUÍDA

**Duração:** 2–3 semanas  
**Dependências:** Fase 0  
**ADR:** [ADR-0004](./adr/ADR-0004.md) (Prompt IR Schema v1.0)

#### Será implementado

| # | Componente | Ficheiro(s) | Descrição |
|---|------------|-------------|-----------|
| 1.1 | **PromptIR types** | `agent-engine/contract/PromptIR.ts` | Schema versionado `promptIrVersion: "1.0"` |
| 1.2 | **FlowDefinition** | `agent-engine/contract/FlowDefinition.ts` | Steps, pre/post-conditions, dependencies |
| 1.3 | **PolicyRule / ConstraintRule** | `agent-engine/contract/PolicyTypes.ts` | Regras extraídas do playbook |
| 1.4 | **CompletionCriterion** | `agent-engine/contract/CompletionTypes.ts` | Critérios de conclusão + reply templates |
| 1.5 | **IntentAnalyzer** | `agent-engine/compiler/IntentAnalyzer.ts` | Extracção objectivo, fluxos, tools |
| 1.6 | **Compiler v2** | `agent-engine/compiler/compilePromptToIR.ts` | Playbook → PromptIR (single pass) |
| 1.7 | **IR cache** | `agent-engine/compiler/PromptIRCache.ts` | Cache por `promptHash` |
| 1.8 | **Adapter legacy** | `agent-engine/contract/promptIrAdapter.ts` | `PromptContract` ↔ `PromptIR` |
| 1.9 | **Testes IR** | `compiler/PromptIR.test.ts` | Playbooks reais Auda + genéricos |
| 1.10 | **Export público** | `agent-engine/contract/index.ts` | API contract module |

#### Estrutura Prompt IR (v1.0)

```typescript
PromptIR = {
  version: "1.0",
  objective: string,
  flows: FlowDefinition[],           // DAG de steps
  tools: { required, optional, forbidden: ToolSpec[] },
  policies: PolicyRule[],
  constraints: ConstraintRule[],
  completionCriteria: CompletionCriterion[],
  turnPatterns: TurnPattern[],       // ex-GENERIC_TURN_PATTERNS
  replyTemplates: ReplyTemplate[],   // ex-Modelo S1/S4c/S9/S10
  metadata: { hash, compiledAt, sourceVersion },
}
```

#### Será corrigido / consolidado

| Patch | Ficheiro actual | Acção |
|-------|-----------------|-------|
| P-050 | `requiredToolNamesParser.ts` GENERIC_TURN_PATTERNS | → `turnPatterns[]` no IR |
| P-051 | Scoring hotel no parser | → metadata no TurnPattern |
| P-052 | HJ2XQZXO-FICHA em turnPolicyParser | → PolicyRule no IR |
| P-053 | S9 exclusivity vs S10 | → PolicyRule no IR |
| P-054 | C9 exclui embratur em playbookRuntimePolicy | → forbidden pairs no IR |
| P-092 | Dirs contract/ vazios | Preenchidos |

#### Ficheiros a modificar (sem eliminar ainda)

- `compiler/PromptCompiler.ts` — delega para `compilePromptToIR`, mantém API
- `core/buildTurnContext.ts` — consome IR via adapter
- `validators/requiredToolNamesParser.ts` — leitura deprecada, shim para IR
- `validators/turnPolicyParser.ts` — shim; lógica migra para IR extraction
- `validators/playbookRuntimePolicy.ts` — shim

#### Critério de saída

- [x] Todo playbook Auda compila para IR sem alterar texto
- [x] Hash IR estável entre compilações
- [x] `PromptCompiler.test.ts` + `PromptIR.test.ts` verdes
- [x] Golden turns G-001–G-008 verdes
- [x] **Zero novos IFs** no Compiler
- [x] ADR-0004 registado
- [x] Scan patches: Δ0 ou negativo

---

### Fase 2 — Unified Execution Spine

**Duração:** 3–4 semanas  
**Dependências:** Fase 1  
**ADR:** ADR-0005 (Unified Spine Rollout)  
**Risco:** 🔴 CRÍTICO — path de produção

#### Será implementado

| # | Componente | Ficheiro(s) | Descrição |
|---|------------|-------------|-----------|
| 2.1 | **OpenNexoRuntime v2** | `runtime/OpenNexoRuntime.ts` | Entry point único openconduit |
| 2.2 | **Spine wiring** | `engine/ExecutionEngine.ts` | `beginTurn()` como único init |
| 2.3 | **Feature flag** | `config/parseAgentEngineConfig.ts` | `AGENT_ENGINE_UNIFIED_SPINE` |
| 2.4 | **Shadow mode** | `runtime/SpineShadowComparator.ts` | Compara monolito vs spine |
| 2.5 | **Timeline engine_*** | `engine/ExecutionTimeline.ts` | Eventos visíveis MCP/Langfuse |
| 2.6 | **LLM adapter extract** | `runtime/LlmTurnAdapter.ts` | Call+stream isolado do monolito |
| 2.7 | **LangGraph node** | `runtime/LangGraphRuntime.ts` | Delega ao spine, não monolito |

#### Será corrigido / eliminado

| Patch | Descrição | Acção |
|-------|-----------|-------|
| P-010 | Bypass ExecutionEngine em openconduit | Remover; spine obrigatório com flag |
| P-090 | ExecutionEngine não autoritativo | Tornar fonte única plan/contract |
| P-091 | WorkflowRuntimeOrchestrator deprecated | Remover após migração; tests migrados |

#### Rollout (4 sub-fases)

| Sub | Semana | Modo | Comportamento | Estado |
|-----|--------|------|---------------|--------|
| 2a | 1 | Shadow | Spine paralelo; compara outputs; monolito entrega | ✅ implementado |
| 2b | 2 | Primary+Fallback | Spine primário; monolito se divergência | ✅ implementado |
| 2c | 3 | Spine only | Monolito desactivado excepto LLM adapter | ✅ implementado |
| 2d | 4 | Cleanup | Remover código morto; MCP audit | ✅ implementado |

**2a entregue (2026-07-30):** `UnifiedSpineBridge.ts`, wiring em `agentNativeLlm.ts`, flag `unifiedSpineMode` + `AGENT_ENGINE_UNIFIED_SPINE`, ADR-0005.

**2b entregue (2026-07-30):** modo `primary` — engine autoritativo; fallback legacy em divergência crítica (required/pending/intent); eventos `engine_primary_fallback` na timeline.

**2c entregue (2026-07-30):** modo `only` — sem `buildTurnContext` legacy; `LlmTurnAdapter.ts`; `recordPhase(execute_llm)`; LangGraph trace spine.

**2d entregue (2026-07-30):** `spineTurnContextBindings.ts`; export orchestrator removido; G-009 parity; [PHASE-2-SPINE-AUDIT](./baseline/PHASE-2-SPINE-AUDIT-2026-07-30.md).

#### Ficheiros a reduzir

| Ficheiro | Linhas actual | Meta pós-F2 |
|----------|---------------|-------------|
| `agentNativeLlm.ts` | 3 861 | ~2 000 (ainda orquestração parcial) |

#### Critério de saída

- [x] Bridge + testes unitários (`UnifiedSpineBridge.test.ts`, config parse)
- [x] Golden G-009 engine/legacy parity
- [x] MCP audit documentado — [PHASE-2-SPINE-AUDIT](./baseline/PHASE-2-SPINE-AUDIT-2026-07-30.md)
- [ ] Flag `AGENT_ENGINE_UNIFIED_SPINE=shadow` em staging (deploy)
- [ ] MCP timeline mostra `engine_begin`, `engine_plan`, `engine_contract` (pós-deploy)
- [ ] Shadow mode: ≥ 99% equivalência outputs Auda (pós-deploy)
- [x] Rollback documentado (flag=off) — ADR-0005

---

### Fase 3 — Planner & Policy Engine Consolidados

**Duração:** 2–3 semanas  
**Dependências:** Fase 2  
**ADR:** ADR-0006 (Unified Planner)  
**Estado:** ✅ implementado (código)

#### Será implementado

| # | Componente | Ficheiro(s) | Descrição | Estado |
|---|------------|-------------|-----------|--------|
| 3.1 | **ExecutionPlanner unificado** | `planner/UnifiedExecutionPlanner.ts` | Merge TurnPlan + EIL Planner | ✅ |
| 3.2 | **Plan DAG builder** | `planner/PlanGraphBuilder.ts` | Steps ordenados com deps | ✅ |
| 3.3 | **PolicyEngine v2** | `eil/PolicyEngine.ts` | Avalia PolicyRule[] do IR | ✅ |
| 3.4 | **Replan API** | `engine/ExecutionEngine.ts` | `replan()` baseado em Facts | ✅ |
| 3.5 | **Workflow step IR** | `PlanGraphBuilder.resolveActiveFlowStep` | Flow step activo do IR | ✅ parcial |

#### Será corrigido / eliminado

| Patch | Local actual | Acção |
|-------|--------------|-------|
| P-002 | Embratur pre-resolve em agentNativeLlm | → Planner step + Facts |
| P-003 | Persistência N/C + catálogo inline | → FactsEngine.ingest |
| P-006 | Máquina S4c/S9 party-size | → FlowDefinition no IR |
| P-007 | applyConfirmationPhaseTransitions | → Workflow Runtime + Facts |
| P-055 | confirmationTurnGuards | → IntentAnalyzer + Facts |
| P-080 | postCompletionFollowUp hotel | → Workflow step IR |

#### Duplicação eliminada

- `resolveTurnPolicy()` chamado 2× (Compiler + Planner) → 1× via IR
- `ExecutionTurnPlan` + `ExecutionPlanner` (EIL) → `UnifiedExecutionPlanner`

#### Critério de saída

- [x] UnifiedExecutionPlanner + testes
- [x] buildTurnContext single-pass (IR → unified plan)
- [x] ExecutionEngine.replan()
- [ ] Planner produz plano equivalente Auda S1–S10 (MCP validado)
- [ ] Zero regex tool-name no Planner (patterns via GENERIC_TURN_PATTERNS + IR)
- [ ] Phase machine removida de agentNativeLlm (Fase 4–7)
- [x] `ExecutionTurnPlan.test.ts` + `UnifiedExecutionPlanner.test.ts` verdes

---

### Fase 4 — Scheduler Desacoplado

**Duração:** 2 semanas  
**Dependências:** Fase 3  
**ADR:** ADR-0007 (Schema-Driven Scheduler)  
**Estado:** ✅ implementado (código)

#### Será implementado

| # | Componente | Ficheiro(s) | Descrição | Estado |
|---|------------|-------------|-----------|--------|
| 4.1 | **TurnToolScheduler v2** | `scheduler/TurnToolScheduler.ts` | Plan+Capabilities+Facts only | ✅ |
| 4.2 | **Schema arg resolver** | `scheduler/SchemaArgResolver.ts` | Args de tool schema metadata | ✅ |
| 4.3 | **Tool Registry aliases** | `engine/ToolRegistry.ts` | oc_tool_* → stable name (P-011) | ✅ |
| 4.4 | **Pre-exec gate único** | `schedulerPreExecBlockReason()` | TurnPolicy + canInvokeTool | ✅ |

#### Será corrigido / eliminado

| Patch | Descrição | Acção |
|-------|-----------|-------|
| P-001 | Regex embratur-reference | → Capability node |
| P-004 | Gate check-in Embratur incomplete | → PolicyEngine + Capability |
| P-020 | Import checkin/embraturTravelForm | Remover import |
| P-021 | Aliases Audaar hardcoded | → Tool schema metadata |
| P-022 | Payload check-in assembly | → Capability pre-conditions |
| P-023 | Skip schedule Embratur incomplete | → canInvokeTool() |
| P-025 | Regex check_in/consultar_reserva | → Plan required tools |
| P-040 | embraturRuntimeGuards check-in block | → PolicyEngine |
| P-041 | isEmbraturReferenceToolName | → CapabilityGraph |
| P-012 | main_guest quebra S9 | → Capability deps |

#### Critério de saída

- [x] Scheduler **não importa** `checkin/`
- [x] Agente fictício (sem hotel) passa Scheduler sem código novo
- [x] `TurnToolScheduler.test.ts` + `SchemaArgResolver.test.ts` verdes
- [ ] Scan: embratur hits ↓ no scheduler (CI)

---

### Fase 5 — Supervisor & Workflow Validator Despromptizados

**Duração:** 2 semanas  
**Dependências:** Fase 4  
**ADR:** ADR-0008 (Structural Validation Only)  
**Estado:** ✅ implementado (código)

#### Será implementado

| # | Componente | Ficheiro(s) | Descrição | Estado |
|---|------------|-------------|-----------|--------|
| 5.1 | **Supervisor v2** | `supervisor/AgentSupervisorService.ts` | Contract, Plan, Facts, Policies | ✅ |
| 5.2 | **WorkflowValidator v2** | `audit/WorkflowValidator.ts` | Plan graph + session state | ✅ |
| 5.3 | **Violation routing** | `supervisor/ViolationRouter.ts` | Layer upstream para RCA | ✅ |
| 5.4 | **promptAssemblyAudit** | `audit/promptAssemblyAudit.ts` | Observabilidade only | ✅ |

#### Será corrigido / eliminado

| Patch | Descrição | Acção |
|-------|-----------|-------|
| P-060 | Regex NLP «check-in concluído» | → Validar Facts.completion |
| P-061 | Guardrails strict mode NLP | → PolicyEngine audit |
| P-062 | Audit prompt assembly como gate | → Observabilidade |
| B-005 | Supervisor «Pendente» em MCP | Wire validação real |

#### Supervisor DEIXA de

- Interpretar playbook markdown
- Detectar regras hotel por texto
- Criar fallback replies

#### Supervisor PASSA a

- Tool X invocada quando Plan exige?
- Facts satisfazem pre-conditions?
- Policies respeitadas?
- Completion criteria atingidos?

#### Critério de saída

- [x] Supervisor/Validator sem `resolveTurnPolicy(behaviorConfig)` no WV
- [x] Violações apontam componente upstream (`routedViolations`)
- [x] `WorkflowValidator.test.ts` + `AgentSupervisorService.test.ts` + `ViolationRouter.test.ts` verdes
- [ ] MCP: supervisor checks presentes em execuções staging

---

### Fase 6 — Redução do Papel do LLM

**Duração:** 2 semanas  
**Dependências:** Fase 5  
**ADR:** ADR-0009 (LLM Sandbox)  
**Estado:** ✅ implementado (código)

#### Será implementado

| # | Componente | Ficheiro(s) | Descrição | Estado |
|---|------------|-------------|-----------|--------|
| 6.1 | **Context packer** | `runtime/TurnContextPacker.ts` | Step objective + Facts summary | ✅ |
| 6.2 | **Tool catalog filter** | `runtime/FilteredToolCatalog.ts` | Tools do step actual only | ✅ |
| 6.3 | **LLM sandbox** | `runtime/LlmToolSandbox.ts` | Bloqueia tools fora do Plan | ✅ |
| 6.4 | **ReplySynthesizer genérico** | `reply/ReplySynthesizer.ts` | Templates via renderer | ✅ |
| 6.5 | **Template renderer** | `reply/ReplyTemplateRenderer.ts` | Interpolação {{facts.*}} | ✅ |

#### Será corrigido / eliminado

| Patch | Descrição | Acção |
|-------|-----------|-------|
| P-005 | ensureDeliveringReply força S1 | → IR completion template |
| P-008 | System append Modelo S1 | → Context packer step |
| P-009 | Regex check-in realizado → ack | → Completion criteria IR |
| P-024 | Scheduler appendix SCRIPT S1 | → Planner step template |
| P-030 | buildModeloS1FromReservationPayload | → ReplyTemplateRenderer |
| P-031 | Templates S9/S4c/S10 hardcoded | → IR replyTemplates |
| P-032 | ensureDeliveringReply C3→S1/S9/S10 | → Policy + templates |
| P-033 | Regex consultar_reserva | → Plan step binding |
| P-034 | Regex embratur-reference | → Capability node |
| P-070 | Fallback check-in incompleto | → Policy-driven fallback |

#### Contrato LLM final

```
RECEBE:  step objective, facts summary, allowed alternatives, user message
PRODUZ:  natural language, tool args, disambiguation
NÃO FAZ: tool selection, workflow, retry, fallback
```

#### Critério de saída

- [ ] Tokens system prompt −60% vs baseline (staging)
- [x] packTurnContextForLlm não inclui playbook completo
- [x] ReplySynthesizer delega a ReplyTemplateRenderer (sem corpos S1/S9 inline)
- [x] Golden G-005 adaptado para template IR
- [x] Testes renderer + packer + sandbox verdes
- [ ] Scan: modelo-s hits ↓ significativo (CI)

---

### Fase 7 — Eliminação de Patches & Domínio fora do Runtime

**Duração:** 3–4 semanas  
**Dependências:** Fases 1–6  
**ADR:** ADR-0010 (Domain Logic in Prompt IR)

#### Será implementado

| # | Componente | Descrição |
|---|------------|-----------|
| 7.1 | **Playbook enrichment** | Metadados estruturados backward-compatible |
| 7.2 | **Tool outcome adapters** | `checkin/` → parsers HTTP only |
| 7.3 | **Patch elimination report** | Documento final removidos vs. mantidos |
| 7.4 | **Agente teste «Clínica Veterinária»** | Prompt-only, zero código runtime |

#### Será corrigido / eliminado

| Patch | Descrição | Acção |
|-------|-----------|-------|
| P-035 | URL fixa pms.audaar.com.br | → Prompt / tool config |
| P-042 | embraturTravelForm no runtime | → Tool adapter HTTP |
| P-043 | embraturReferenceCatalog templates | → Facts + IR template |
| P-045 | embraturReferenceResolver guards | → Facts Engine + tool |
| P-040, P-041 | embraturRuntimeGuards | **Remover** (substituídos F4) |

#### Módulo `checkin/` — destino final

| Ficheiro | Mantém | Remove |
|----------|--------|--------|
| `toolOutcomeParsing.ts` | ✅ Tool Runtime | — |
| `embraturReferenceCatalog.ts` | Parser outcome | Templates runtime |
| `embraturTravelForm.ts` | — | → Tool adapter |
| `embraturRuntimeGuards.ts` | — | **Eliminar** |
| `embraturReferenceResolver.ts` | Facts helper | Guards runtime |
| `embraturReferenceDomains.ts` | Tool metadata | — |

#### Teste de generalização (obrigatório)

Criar agente **Clínica Veterinária** apenas com Prompt:
- Objetivo, fluxo, tools, restrições, critérios conclusão
- **Zero alterações Runtime**
- Deve executar end-to-end

#### Critério de saída

- [x] Playbook enrichment + tool outcome adapters
- [x] Wire packer/sandbox no monolito (spine ≠ off)
- [x] Agente veterinário — testes planner/scheduler (`generalizationAgent.test.ts`)
- [x] PATCH-ELIMINATION-2026-07-31 + ADR-0010
- [ ] Patches específicos: 28 → 0 (parcial — guards legacy em spine `off`)
- [ ] `checkin/` sem exports usados por scheduler/reply/monolito (parcial)
- [ ] Scan total hits ↓ ≥ 80% vs F0

---

### Fase 8 — Governança Integrada & Quality Gates CI

**Duração:** 1–2 semanas  
**Dependências:** Fase 7  
**ADR:** ADR-0011 (Architecture CI Gates) — extensão AGS Fase 2

#### Será implementado

| # | Componente | Ficheiro(s) | Descrição |
|---|------------|-------------|-----------|
| 8.1 | **Pre-commit hook** | `.husky/pre-commit` ou equivalente | `evaluateProposedChange` |
| 8.2 | **ESLint rule** | `eslint-rules/no-prompt-specific-patches.js` | Bloqueia patterns proibidos |
| 8.3 | **Architecture Simulator** | `architecture-governance/simulator.ts` | Simula turno pre-merge |
| 8.4 | **Generalization test CI** | `regression/generalizationAgent.test.ts` | Agente sintético por PR |
| 8.5 | **Langfuse arch traces** | `observability/LangfuseBridge.ts` | Decisões arquiteturais |
| 8.6 | **Scan em CI** | pipeline | `--fail-on-new` obrigatório |

#### Gates automáticos (bloqueiam merge)

1. RCA presente se teste falhou
2. Impact Analysis nos ficheiros alterados
3. Architecture Score ≥ 5 (≥ 7 pós-F7)
4. Zero novos patches classificados «Específico»
5. Regression suite verde (135+ tests)
6. Generalization test verde
7. `scan-runtime-patches.mjs --fail-on-new` verde

#### Critério de saída

- [x] Pre-commit + `evaluateProposedChange` em staged files
- [x] ESLint rule `no-prompt-specific-patches` + check script
- [x] Architecture Simulator (vet + hotel)
- [x] Generalization test em CI
- [x] Langfuse layer `architecture_governance`
- [x] `scan-runtime-patches.mjs --fail-on-new` em CI
- [x] ADR-0011 + AGS.md Fase 8
- [ ] PR com `if (toolName === "check_in")` bloqueado em produção CI (requer merge workflow)
- [ ] Husky activo em todos os dev environments

---

### Fase 9 — Auditoria Final via OpenNexo MCP

**Duração:** 1 semana  
**Dependências:** Fase 8

#### Protocolo MCP (por agente em produção)

1. `search_execution` — últimas 10 execuções
2. `get_execution_inspector` — timeline completa
3. `search_trace` — layers Langfuse
4. `search_supervisor` — violações
5. Verificar pipeline: Compiler → IR → Planner → Contract → Scheduler → LLM

#### Relatório final (`docs/architecture/audit/FINAL-AUDIT-YYYY-MM-DD.md`)

| Secção | Conteúdo |
|--------|----------|
| Patches removidos | Lista file:line antes/depois |
| Hacks eliminados | Classificação + migração |
| IFs específicos removidos | Contagem por fase |
| Regras migradas | runtime → IR/Policy/Capability |
| Componentes reutilizados | % código genérico |
| Ganhos performance | Tokens, latência, retries |
| Ganhos previsibilidade | Violation rate antes/depois |
| Débito remanescente | Itens ainda específicos (deve ser 0) |
| Teste generalização | Veterinária + N agentes novos |
| Architecture Score final | Meta ≥ 8.0 |

#### Critério de aceitação final (checklist)

- [x] Novo agente só com Prompt (`generalizationAgent.test.ts`)
- [x] Zero alteração Runtime para agente veterinário
- [x] Guardrails legacy reduzidos (5 remanescentes, spine off)
- [x] Supervisor não interpreta Prompt (ADR-0008)
- [x] Workflow Validator não interpreta NLP (ADR-0008)
- [x] LLM sandbox + packer wired (spine ≠ off)
- [x] MCP protocolo documentado + offline audit (`mcpAuditProtocol.ts`)
- [x] ADR-0003 status → **accepted**
- [ ] MCP live re-audit 100% pós `spine=primary`

---

## 5. Matriz de patches → fases (completa)

| ID | Fase eliminação | Componente destino |
|----|-----------------|-------------------|
| P-001 | 4 | Capability Graph |
| P-002 | 3 | Planner + Facts |
| P-003 | 3 | Facts Engine |
| P-004 | 4 | Policy + Capability |
| P-005 | 6 | IR completion template |
| P-006 | 3 | FlowDefinition + Planner |
| P-007 | 3 | Workflow Runtime |
| P-008 | 6 | Context packer |
| P-009 | 6 | Completion criteria IR |
| P-010 | 2 | Unified Spine |
| P-011 | 4 | Tool Registry |
| P-012 | 4 | Capability deps |
| P-020–P-025 | 4 | Scheduler v2 |
| P-030–P-035 | 6–7 | IR templates / Prompt |
| P-040–P-041 | 4 | Policy + Capability |
| P-042–P-045 | 7 | Tool adapters + Facts |
| P-050–P-054 | 1 | Prompt IR |
| P-055 | 3 | Intent Analyzer |
| P-060–P-062 | 5 | Supervisor / WV v2 |
| P-070 | 6 | Policy fallback |
| P-080 | 3 | Workflow step IR |
| P-090–P-092 | 1–2 | IR + Unified Spine |

---

## 6. Compatibilidade garantida (não regressão)

Durante **todas** as fases, estes sistemas **continuam funcionando** sem alteração de Prompt:

| Sistema | Estratégia |
|---------|------------|
| Agentes existentes (Auda) | IR adapter equivalente; golden tests |
| Ferramentas HTTP/MCP | Tool Runtime inalterado |
| LangGraph | Wrapper node → spine |
| Mem0 | Memory Manager inalterado |
| Langfuse | + layers engine_* |
| Qdrant / LlamaIndex | Knowledge Provider inalterado |
| Supervisor | Evolução backward-compatible |
| Automações / Workflows | WorkflowEngine via IR |
| Integrações webhook | Entry points preservados |

---

## 7. Regras de implementação (obrigatórias em cada fase)

### 7.1 Antes de cada commit

1. Root Cause Analysis (se bug)
2. Impact Analysis (AGS)
3. Regression Analysis (126+ tests)
4. Architecture Validation
5. Prompt Compilation Validation (a partir F1)
6. Execution Contract Validation
7. `scan-runtime-patches.mjs --fail-on-new`

### 7.2 Proibido em qualquer fase

```
prompt.includes(...)
if (toolName == "...")
if (workflow == "...")
if (segment == "...")
switch por Prompt / Tool / Cliente / Segmento
```

### 7.3 Teste de generalização (cada PR)

Responder **SIM** a todas:

- Funciona para qualquer agente daqui a 5 anos?
- Funciona sem conhecer o Prompt?
- Funciona sem conhecer o segmento?
- Funciona apenas com Contract, Facts, Capabilities, Policies?

Se **NÃO** → rejeitar implementação.

### 7.4 RCA obrigatório (falha de teste)

1. Timeline MCP completa
2. Localizar **primeira** violação
3. Corrigir **apenas** esse componente
4. Nunca compensar downstream (Guardrail, IF, Supervisor)

---

## 8. Timeline consolidada

```
Fase 0  ████░░░░░░░░░░░░░░░░  Sem 1-2    Baseline                    ✅
Fase 1  ░░░░██████░░░░░░░░░░  Sem 3-5    Prompt IR
Fase 2  ░░░░░░░░████████░░░░  Sem 5-9    Unified Spine               ⚠️ CRÍTICA
Fase 3  ░░░░░░░░░░░░██████░░  Sem 9-12   Planner + Policy
Fase 4  ░░░░░░░░░░░░░░░░████  Sem 12-14  Scheduler desacoplado
Fase 5  ░░░░░░░░░░░░░░░░░░██  Sem 14-16  Supervisor / WV
Fase 6  ░░░░░░░░░░░░░░░░░░░░  Sem 16-18  LLM reduction
Fase 7  ░░░░░░░░░░░░░░░░░░░░  Sem 18-22  Patch elimination
Fase 8  ░░░░░░░░░░░░░░░░░░░░  Sem 22-24  CI / Governança
Fase 9  ░░░░░░░░░░░░░░░░░░░░  Sem 24-25  Auditoria final MCP
```

---

## 9. ADRs previstos

| ADR | Fase | Título |
|-----|------|--------|
| ADR-0003 | 0 | Unified Execution Spine ✅ proposed |
| ADR-0004 | 1 | Prompt IR Schema v1.0 |
| ADR-0005 | 2 | Unified Spine Rollout Strategy |
| ADR-0006 | 3 | Unified Execution Planner |
| ADR-0007 | 4 | Schema-Driven Tool Scheduler |
| ADR-0008 | 5 | Structural Validation Only |
| ADR-0009 | 6 | LLM Sandbox & Context Packer |
| ADR-0010 | 7 | Domain Logic in Prompt IR |
| ADR-0011 | 8 | Architecture CI Gates |

---

## 10. Riscos globais

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Regressão fluxo hotel S1–S10 | Alta | Alto | Shadow mode F2; golden tests; MCP |
| Playbook legacy não compila IR | Média | Médio | Adapter layer; enrichment gradual |
| LangGraph incompatível | Média | Médio | Wrapper node |
| Scope creep (novos patches) | Alta | Alto | AGS + scan CI + PATCH-REGISTRY |
| Performance compilação IR | Baixa | Baixo | IR cache por hash |
| Equipa contorna gates | Média | Alto | Pre-commit + review obrigatório |

---

## 11. Referências

| Documento | Caminho |
|-----------|---------|
| Este roadmap | `docs/architecture/ROADMAP.md` |
| Patch Registry | `docs/architecture/PATCH-REGISTRY.md` |
| Baseline MCP | `docs/architecture/baseline/BASELINE-AUDIT-2026-07-30.md` |
| AGS | `docs/architecture/AGS.md` |
| ADR-0003 | `docs/architecture/adr/ADR-0003.md` |
| Regression tests | `apps/api/src/lib/agent-engine/regression/` |
| Patch scan | `apps/api/scripts/scan-runtime-patches.mjs` |

---

## 12. Próximo passo

**Fase 1 — Prompt IR Formal** (ADR-0004)

Implementar `agent-engine/contract/PromptIR.ts` e `compilePromptToIR()` mantendo compatibilidade total com playbooks existentes.
