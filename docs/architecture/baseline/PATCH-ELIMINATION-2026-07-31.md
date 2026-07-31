# Patch Elimination Report — Fase 7 (2026-07-31)

Baseline: [baselineManifest.json](../../apps/api/src/lib/agent-engine/regression/baselineManifest.json) phase 6 → 7.

## Entregas

| # | Componente | Estado |
|---|------------|--------|
| 7.1 | `compiler/playbookEnrichment.ts` | ✅ |
| 7.2 | `checkin/toolOutcomeAdapters.ts` | ✅ |
| 7.3 | Este documento | ✅ |
| 7.4 | `regression/generalizationAgent.test.ts` | ✅ |
| — | `runtime/LlmRuntimeBridge.ts` + wire monolito | ✅ |

## Patches — status

| ID | Descrição | Antes | Depois |
|----|-----------|-------|--------|
| P-035 | URL fixa pms.audaar | Hardcoded renderer + playbook | `playbookEnrichment.checkinLink` + `{{facts.checkinLink}}` |
| P-042 | embraturTravelForm no runtime | `automationHttpToolExecute` direct | `adaptHttpCheckInPayload` adapter |
| P-040–P-041 | embraturRuntimeGuards monolito | Direct gate L2869 | `gateLlmToolCall` quando spine activo; legacy quando `off` |
| P-043 | Catalog templates runtime | ReplySynthesizer S9 | Mantido parser; enrichment path para S1 link |
| P-045 | Reference resolver guards | Monolito + session | CapabilityGraph pre-invoke + FactsEngine |

## Imports `checkin/` — redução

| Consumidor | Fase 6 | Fase 7 |
|------------|--------|--------|
| `TurnToolScheduler` | 0 | 0 |
| `ReplySynthesizer` | catalog parser | + `templateFactsFromEnrichedIr` (compiler) |
| `agentNativeLlm` | guards + resolver | spine: `LlmRuntimeBridge`; legacy fallback |
| `automationHttpToolExecute` | embraturTravelForm direct | `toolOutcomeAdapters` |

## Wire monolito (spine ≠ off)

- `appendPackedLlmContext` → `systemForLlm`
- `gateLlmToolCall` → `onToolCall` HTTP tools
- `ensureDeliveringReply({ promptIr })`

## Testes

```bash
cd apps/api
node --import tsx --test \
  src/lib/agent-engine/compiler/playbookEnrichment.test.ts \
  src/lib/agent-engine/runtime/LlmRuntimeBridge.test.ts \
  src/lib/agent-engine/regression/generalizationAgent.test.ts \
  src/lib/agent-engine/regression/baselineGoldenTurns.test.ts \
  src/lib/agent-engine/reply/ReplySynthesizer.test.ts \
  src/lib/agent-engine/reply/ReplyTemplateRenderer.test.ts
```

## Pendente Fase 8+

- Remover `embraturRuntimeGuards` após spine `primary` default
- Medir scan hits CI vs F0
- Agente veterinário E2E com LLM real (staging)
