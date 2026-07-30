import type { AgentEngineConfig } from "../types.js";
import type { AgentRuntimeExecuteInput } from "../types.js";
import type { TurnContext } from "../core/types.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import { turnPolicyPreExecBlockReason } from "../validators/turnPolicyParser.js";
import {
  canInvokeTool,
  findCapabilityNode,
  orderToolsByFactDeps,
} from "../eil/CapabilityGraph.js";
import { hasFact } from "../eil/FactsEngine.js";
import { assembleEmbraturFromSources } from "../checkin/embraturTravelForm.js";

export type ScheduledToolInvocation = {
  toolName: string;
  args: Record<string, unknown>;
  reason: "execution_contract_required";
};

/** Inferência genérica de argumentos a partir de entidades do turno — sem regras de segmento. */
export function buildScheduledToolArgs(toolName: string, turnContext: TurnContext): Record<string, unknown> {
  const normalized = toolName.trim().toLowerCase();
  const msg = turnContext.userMessage.trim();
  const entities = turnContext.intent.entities;

  if (normalized === "buscar_conhecimento") {
    return { query: msg };
  }

  const args: Record<string, unknown> = {};
  const ref =
    (typeof entities.referenceCode === "string" && entities.referenceCode.trim()) ||
    msg.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,12}\b/i)?.[0]?.toUpperCase() ||
    "";

  if (ref) {
    // Aliases comuns em HTTP tools (schema Audaar usa localizadorOuReservationId).
    args.reference = ref;
    args.localizador = ref;
    args.localizadorOuReservationId = ref;
    args.booking_reference = ref;
    args.reservation_code = ref;
    args.reservationId = ref;
    args.codigo = ref;
  }
  if (entities.documentNumber) {
    args.cpf = entities.documentNumber;
    args.document = entities.documentNumber;
    args.documentNumber = entities.documentNumber;
  }

  // Factos de sessão (flowSlots → FactStore) — preenche required HTTP sem depender do LLM.
  const facts = turnContext.facts;
  if (facts && typeof facts === "object") {
    for (const [k, v] of Object.entries(facts)) {
      if (k.startsWith("__") && k !== "__travelFormMessage") continue;
      if (v === undefined || v === null) continue;
      // FactStore: { key, value, source } · stubs de teste: escalar directo.
      let scalar: unknown = v;
      if (typeof v === "object" && !Array.isArray(v) && "value" in (v as object)) {
        scalar = (v as { value?: unknown }).value;
      }
      if (typeof scalar === "string" || typeof scalar === "number" || typeof scalar === "boolean") {
        if (!(k in args)) args[k] = scalar;
      }
    }
  }

  // check_in / schemas nested: monta mainGuest a partir de factos flat.
  if (/check[_-]?in|checkin/i.test(normalized)) {
    const guest: Record<string, unknown> = {};
    const map: Array<[string, string[]]> = [
      ["name", ["name", "guestName", "mainGuestName", "fullName"]],
      ["email", ["email", "guestEmail"]],
      ["documentNumber", ["documentNumber", "cpf", "document"]],
      ["documentType", ["documentType", "docType"]],
      ["mobilePhoneNumber", ["mobilePhoneNumber", "phone"]],
      ["birthDate", ["birthDate"]],
      ["gender", ["gender"]],
      ["profession", ["profession"]],
      ["citizenship", ["citizenship", "nationality"]],
      ["zipCode", ["zipCode", "postalCode"]],
      ["country", ["country"]],
      ["state", ["state"]],
      ["city", ["city"]],
      ["street", ["street", "address"]],
      ["number", ["number", "addressNumber"]],
      ["neighborhood", ["neighborhood"]],
      ["profilePhotoUrl", ["profilePhotoUrl"]],
      ["documentPhotoUrl", ["documentPhotoUrl"]],
    ];
    for (const [field, keys] of map) {
      for (const k of keys) {
        const v = args[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          guest[field] = v;
          break;
        }
      }
    }
    if (Object.keys(guest).length > 0) {
      args.mainGuest = guest;
    }

    // Embratur (ficha S9b → snmotvia / sntiptran / IBGE) a partir de flowSlots/facts.
    const embratur = assembleEmbraturFromSources(args);
    if (embratur && Object.keys(embratur).length > 0) {
      args.embratur = embratur;
    }
  }

  // HTTP tools: runtime context + auto-fill preenchem o resto quando args vazios.
  if (Object.keys(args).length === 0 && msg) {
    args.user_message = msg;
  }
  return args;
}

/** Planeia invocações determinísticas para tools obrigatórias ainda pendentes. */
export function planScheduledToolInvocations(
  turnContext: TurnContext,
  existingOutcomes: Array<{ name: string; ok?: boolean }> = [],
): ScheduledToolInvocation[] {
  const policy = turnContext.promptContract.turnPolicy;
  const available = new Set(
    (turnContext.availableToolNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  let pending = turnContext.executionContract.pendingToolNames.filter(
    (name) => !toolOutcomeSatisfiesRequired(name, existingOutcomes),
  );

  const graph = turnContext.capabilityGraph;
  const facts = turnContext.facts ?? {};

  // Expandir com producers de factos em falta (Tool Call Accuracy — ordem correcta).
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
      if (turnPolicyPreExecBlockReason(toolName, policy)) return false;
      if (graph && !canInvokeTool(graph, toolName, facts).ok) return false;
      return true;
    })
    .map((toolName) => ({
      toolName,
      args: buildScheduledToolArgs(toolName, turnContext),
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
    (o) => o.ok && /consultar[_-]?reserva/i.test(o.name),
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
