# LangGraph Send API — Avaliação (Fase 2.2)

> Data: 2026-07-26  
> Objetivo: sub-agentes read-only em paralelo sem refactor de `generateNativeAgentReplyCore`.

## Contexto

O executor nativo (`agentNativeLlm.ts`) corre rounds sequenciais de tool-calling. Paralelizar tool rounds exige refactor profundo (estado partilhado, quota LLM, memória).

A API **`Send`** do LangGraph permite fan-out dinâmico a sub-grafos a partir de um nó condicional.

## Casos de uso candidatos (read-only)

| Caso | Nós paralelos | Risco |
|------|---------------|-------|
| KB search multi-artigo | `buscar_conhecimento` × N artigos pinned | Baixo — só leitura |
| Memória Mem0 + KB | `load_memory` ∥ `knowledge_prefetch` | Médio — merge de state |
| Validação pós-resposta | supervisor estrutural ∥ LLM supervisor | Já coordenado via `supervisorMode` |

## Proposta incremental (Fase 3+)

```
classify_intent
    → fan_out_kb (Send × artigos pinned)   [opt-in flag parallelKbPrefetch]
    → merge_kb_results
    → load_memory
    → execute_tool (executor nativo existente)
    → ...
```

**Pré-requisitos:**

1. Reducer no state para `kbPrefetchResults: Annotated<Array, merge>`
2. Sub-grafo `kb_read_node` — só chama `rankedKnowledgeSearch`, sem LLM
3. Flag `parallelKbPrefetchEnabled` em `agentEngine` (default off)

## Limitações actuais

- `generateNativeAgentReplyCore` não expõe hooks por tool — executor monolítico
- CrewAI/AutoGen wrappers (2.1) permanecem legacy; Send API é alternativa **nativa LangGraph**
- Parallel tool rounds dentro do LLM (OpenAI parallel function calls) já existem no provider; Send API é para **nós de grafo**, não tool_calls

## Recomendação

| Prioridade | Acção |
|------------|-------|
| ✅ Agora | Documentar avaliação (este ficheiro) |
| ✅ Q3 2026 | POC `parallelKbPrefetch` com 2–3 artigos pinned |
| ⏸️ | Parallel `execute_tool` rounds — adiar até refactor executor |

## Referências

- [LangGraph Send API](https://langchain-ai.github.io/langgraph/how-tos/map-reduce/)
- Roadmap: `.planning/langgraph-roadmap.md` § 2.2
