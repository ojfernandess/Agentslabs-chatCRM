import type { AgentEngineConfig } from "../types.js";
import type { AgentRuntimeExecuteInput } from "../types.js";
import type { TurnContext } from "../core/types.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import { turnPolicyPreExecBlockReason } from "../validators/turnPolicyParser.js";
import {
  canInvokeTool,
  capabilityPreExecBlockReason,
  findCapabilityNode,
  orderToolsByFactDeps,
} from "../eil/CapabilityGraph.js";
import { hasFact } from "../eil/FactsEngine.js";
import {
  outcomeHasLookupCapability,
  resolveSchemaToolArgs,
} from "./SchemaArgResolver.js";

export type ScheduledToolInvocation = {
  toolName: string;
  args: Record<string, unknown>;
  reason: "execution_contract_required";
};

/** @deprecated Use resolveSchemaToolArgs — mantido para compat de imports. */
export function buildScheduledToolArgs(toolName: string, turnContext: TurnContext): Record<string, unknown> {
  return resolveSchemaToolArgs({ toolName, turnContext });
}

function alreadyCalledThisTurn(
  toolName: string,
  existingOutcomes: Array<{ name: string; ok?: boolean }>,
): string[] {
  return existingOutcomes
    .filter((o) => o.ok !== false)
    .map((o) => o.name.trim())
    .filter(Boolean);
}

/** Gate único pré-execução: TurnPolicy + CapabilityGraph (Fase 4). */
export function schedulerPreExecBlockReason(
  toolName: string,
  turnContext: TurnContext,
  existingOutcomes: Array<{ name: string; ok?: boolean }>,
): string | null {
  const policy = turnContext.promptContract.turnPolicy;
  const policyBlock = turnPolicyPreExecBlockReason(toolName, policy);
  if (policyBlock) return policyBlock;

  const graph = turnContext.capabilityGraph;
  const facts = turnContext.facts ?? {};
  const called = alreadyCalledThisTurn(toolName, existingOutcomes);

  const capBlock = capabilityPreExecBlockReason(toolName, graph, facts, called);
  if (capBlock) return capBlock;

  if (graph) {
    const invoke = canInvokeTool(graph, toolName, facts);
    if (!invoke.ok) {
      return `Capability Graph: factos em falta para \`${toolName}\`: ${invoke.unmetFacts.join(", ")}.`;
    }
  }

  return null;
}

/** Planeia invocações determinísticas para tools obrigatórias ainda pendentes. */
export function planScheduledToolInvocations(
  turnContext: TurnContext,
  existingOutcomes: Array<{ name: string; ok?: boolean }> = [],
): ScheduledToolInvocation[] {
  const available = new Set(
    (turnContext.availableToolNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  let pending = turnContext.executionContract.pendingToolNames.filter(
    (name) => !toolOutcomeSatisfiesRequired(name, existingOutcomes),
  );

  const graph = turnContext.capabilityGraph;
  const facts = turnContext.facts ?? {};

  if (graph) {
    const expanded: string[] = [];
    const seen = new Set<string>();
    const add = (name: string) => {
      const k = name.trim().toLowerCase();
      if (seen.has(k)) return;
      if (available.size > 0 && !available.has(k)) return;
      if (toolOutcomeSatisfiesRequired(name, existingOutcomes)) return;
      seen.add(k);
      expanded.push(name);
    };
    for (const toolName of pending) {
      const node = findCapabilityNode(graph, toolName);
      for (const fact of node?.requiresFacts ?? []) {
        if (hasFact(facts, fact)) continue;
        for (const producer of graph.producersByFact[fact] ?? []) add(producer);
      }
      add(toolName);
    }
    pending = orderToolsByFactDeps(graph, expanded.length > 0 ? expanded : pending, facts);
  }

  return pending
    .filter((toolName) => {
      if (available.size > 0 && !available.has(toolName.trim().toLowerCase())) return false;
      return schedulerPreExecBlockReason(toolName, turnContext, existingOutcomes) === null;
    })
    .map((toolName) => ({
      toolName,
      args: resolveSchemaToolArgs({ toolName, turnContext, graph }),
      reason: "execution_contract_required" as const,
    }));
}

export function shouldRunToolScheduler(
  engineConfig: AgentEngineConfig,
  executionHints?: AgentRuntimeExecuteInput["executionHints"],
): boolean {
  if (engineConfig.schedulerEnabled !== true) return false;
  if (executionHints?.replyOnlyRetry) return false;
  return true;
}

/** Compacta payload para o prompt — evita dumps gigantes; mantém chaves/valores úteis. */
export function compactStructuredPayloadForPrompt(payload: unknown, maxChars = 3500): string {
  if (payload == null) return "";
  try {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars)}…`;
  } catch {
    return "";
  }
}

export function formatScheduledToolsSystemAppendix(
  outcomes: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>,
  capabilityGraph?: TurnContext["capabilityGraph"],
): string {
  if (!outcomes.length) return "";
  const anyFailed = outcomes.some((o) => !o.ok);
  const lines = outcomes.map((o) => {
    const factsJson =
      o.ok && o.structuredPayload != null
        ? compactStructuredPayloadForPrompt(o.structuredPayload)
        : "";
    const factsBlock = factsJson
      ? `\n  Factos estruturados (OBRIGATÓRIO citar na resposta ao cliente):\n  \`\`\`json\n  ${factsJson}\n  \`\`\``
      : "";
    return `- **${o.name}** (${o.ok ? "ok" : "falhou"}): ${o.preview.slice(0, 1200)}${factsBlock}`;
  });
  const failBlock = anyFailed
    ? "\n**ATENÇÃO:** pelo menos uma ferramenta FALHOU (ex.: schema_validation_failed / HTTP erro). " +
      "PROIBIDO dizer ao cliente que a operação foi concluída/sucesso. " +
      "Peça **apenas** o campo realmente em falta segundo o erro da tool. " +
      "PROIBIDO re-pedir RG/órgão/CPF/email/endereço/fotos já listados no espelho da última mensagem ou no JSON da tool de lookup (main_guest). " +
      "Se o erro for de schema (ex.: rg+órgão juntos), separe os campos já conhecidos e retente — não peça de novo ao hóspede.\n"
    : "";
  const reservationLookupOk = outcomes.some(
    (o) => o.ok && outcomeHasLookupCapability(o.name, capabilityGraph, o.structuredPayload),
  );
  const checkInScriptBlock = reservationLookupOk
    ? "\n**SCRIPT FIXO (check-in / verificar reserva):** a resposta DEVE seguir o template do playbook " +
      "(Modelo S1 se check-in explícito · Modelo Verificar se só verificar) com dados **desta** tool: " +
      "hospedagem, check-in/out, N hóspedes, estado do check-in, opções/próximo passo (nacionalidade no C3). " +
      "PROIBIDO mudar o formato · PROIBIDO «Vou verificar/consultar…» · PROIBIDO «(Invocando a ferramenta…)» · " +
      "PROIBIDO markdown «### Consultando…» · PROIBIDO montar a resposta com KB/mem0/histórico.\n"
    : "";
  const runtimeOwnedGuard =
    "\n**Runtime owns tools:** nao narre invocacoes pendentes — os resultados acima ja existem.\n";
  return (
    "\n\n## Ferramentas já executadas pelo Runtime (Tool Scheduler)\n" +
    "Não volte a invocar ferramentas que tiveram sucesso neste turno.\n" +
    failBlock +
    checkInScriptBlock +
    runtimeOwnedGuard +
    "A resposta AO CLIENTE DEVE usar os factos/dados abaixo de forma substantiva " +
    "(datas, estado, identificadores, valores, nomes). " +
    "Proibido responder só que «encontrou» / «localizou» sem detalhar os dados retornados.\n" +
    lines.join("\n")
  );
}
