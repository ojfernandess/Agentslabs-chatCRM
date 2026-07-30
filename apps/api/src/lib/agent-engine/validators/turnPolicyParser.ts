import {
  extractToolNamesFromText,
  isPlausibleToolName,
  normalizeToolToken,
  playbookTextFromBehavior,
  toolOutcomeSatisfiesRequired,
} from "./requiredToolNamesParser.js";
import {
  COMPLETION_LINE_RE,
  CONFIRMATION_USER_MSG_RE,
  isLikelyMutableOrCompletionTool,
  isLikelyUploadOrMediaTool,
  isLikelyLookupOrKnowledgeTool,
  isLikelyConfirmationGateTool,
  lineDescribesConfirmationExclusiveTools,
  looksLikeFlowSlotKey,
  slotKeyIsFilled,
  extractSlotKeysFromLine,
  hasFilledMediaOrDocumentSlots,
} from "./playbookRuntimePolicy.js";
import {
  isAwaitingPostGateData,
  isCompletionReady,
  isPostCompletionPending,
} from "../core/sessionToolOutcomes.js";
import {
  shouldAllowCompletionToolPromotion,
  shouldSuppressConfirmationExclusiveTools,
  assistantIsPostCheckInAck,
} from "../core/confirmationTurnGuards.js";

export {
  isLikelyMutableOrCompletionTool,
  isLikelyUploadOrMediaTool,
} from "./playbookRuntimePolicy.js";

export type PriorToolOutcome = { name: string; ok?: boolean };

export type ForbiddenToolPair = {
  a: string;
  b: string;
  source: string;
};

export type TurnPolicy = {
  /** Pares de tools proibidos no mesmo turno (extraídos do playbook). */
  forbiddenSameTurnPairs: ForbiddenToolPair[];
  /**
   * Se não-null, apenas estas tools (ou aliases parciais) são permitidas neste turno.
   * null = sem restrição exclusiva.
   */
  exclusiveAllowedTools: string[] | null;
  /** Nomes que o playbook trata como conclusão / mutação (check-in, submit, etc.). */
  completionToolHints: string[];
  /**
   * Pré-requisitos de confirmação (só/somente no sim) definidos no playbook.
   * Usado para avançar para a tool de conclusão quando já satisfeitos na sessão.
   */
  confirmationPrerequisiteTools: string[];
  /** Omite tools do catálogo quando todos os slotKeys existem em flowSlots (do playbook). */
  omitToolsWhenSlotsPresent: Array<{ tools: string[]; slotKeys: string[] }>;
  /** true em turnos sim/ok/não — bloqueia transfer/call_human/status. */
  blockEscalation: boolean;
};

const FORBIDDEN_PAIR_LINE_RE =
  /proibid[oa]|n[aã]o\s+mistur|mesmo\s+turno|same\s*turn|must\s+not\s+(?:call|combine|mix)|never\s+(?:call|combine|mix)/i;

/** Escalonamento / handoff — nunca entram no allowlist de confirmação. */
const ESCALATION_TOOL_NAMES = new Set([
  "call_human",
  "transfer_to_team",
  "assign_team_to_conversation",
  "listar_equipas",
  "set_conversation_status",
]);

export function isEscalationToolName(name: string): boolean {
  const n = name.toLowerCase().replace(/-/g, "_");
  if (ESCALATION_TOOL_NAMES.has(n)) return true;
  for (const e of ESCALATION_TOOL_NAMES) {
    if (n.includes(e) || e.includes(n)) return true;
  }
  return false;
}

/**
 * Parse pares proibidos no mesmo turno a partir do playbook.
 * Exemplos: `Proibido \`foo\` + \`bar\` no mesmo turno` · `reference + check-in`.
 */
export function parseForbiddenSameTurnPairsFromPlaybook(text: string): ForbiddenToolPair[] {
  const pairs: ForbiddenToolPair[] = [];
  if (!text.trim()) return pairs;

  for (const line of text.split(/\n+/)) {
    if (!FORBIDDEN_PAIR_LINE_RE.test(line) && !/\+\s*`/.test(line)) continue;
    if (!FORBIDDEN_PAIR_LINE_RE.test(line) && !/proibid/i.test(line)) continue;

    const tools = extractToolNamesFromText(line);
    if (tools.length >= 2) {
      for (let i = 0; i < tools.length; i++) {
        for (let j = i + 1; j < tools.length; j++) {
          pairs.push({ a: tools[i]!, b: tools[j]!, source: line.trim().slice(0, 160) });
        }
      }
      continue;
    }

    // Padrão sem backticks: "reference + check-in" / "lookup + Embratur"
    const plusMatch = line.match(
      /([a-z][a-z0-9_-]{2,40})\s*\+\s*([a-z][a-z0-9_-]{2,40})/gi,
    );
    if (plusMatch) {
      for (const m of plusMatch) {
        const parts = m.split(/\s*\+\s*/);
        if (parts.length === 2 && parts[0] && parts[1]) {
          pairs.push({
            a: parts[0].toLowerCase(),
            b: parts[1].toLowerCase(),
            source: line.trim().slice(0, 160),
          });
        }
      }
    }
  }

  // Dedup + descartar pares alias de si mesmos (ex.: audaar_consultar_reserva + consultar_reserva
  // extraídos da mesma linha C3 com coluna "Tools | consultar_reserva").
  const seen = new Set<string>();
  return pairs.filter((p) => {
    if (toolsMatchAlias(p.a, p.b)) return false;
    const key = [p.a, p.b].map((x) => x.toLowerCase()).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Refina exclusive de confirmação: descarta slots/idiomas, prioriza gates reais
 * sobre lookup/knowledge quando ambos aparecem (evita agendar `mainguestid` / `brasileiro`).
 */
export function refineConfirmationExclusiveTools(candidates: string[]): string[] {
  const plausible = [
    ...new Set(
      candidates
        .map((n) => normalizeToolToken(n) ?? "")
        .filter(
          (n) =>
            Boolean(n) &&
            isPlausibleToolName(n) &&
            !looksLikeFlowSlotKey(n) &&
            !isLikelyMutableOrCompletionTool(n) &&
            !isEscalationToolName(n) &&
            !isLikelyUploadOrMediaTool(n),
        ),
    ),
  ];
  if (plausible.length <= 1) return plausible;

  const gates = plausible.filter((n) => isLikelyConfirmationGateTool(n));
  if (gates.length > 0) return gates;

  const nonLookup = plausible.filter((n) => !isLikelyLookupOrKnowledgeTool(n));
  if (nonLookup.length > 0) return nonLookup;

  return plausible;
}

/**
 * Em turnos de confirmação (sim/ok), extrai tools exclusivas do playbook:
 * linhas com "só/somente/apenas/only" + tool em contexto de confirmação.
 * Só aceita nomes plausíveis (snake/kebab) — nunca slots camelCase nem valores de tabela.
 */
export function parseExclusiveToolsForConfirmationTurn(playbookText: string): string[] {
  const exclusive = new Set<string>();
  if (!playbookText.trim()) return [];

  for (const line of playbookText.split(/\n+/)) {
    if (!lineDescribesConfirmationExclusiveTools(line)) continue;
    const soMatches = [
      ...line.matchAll(
        /(?:^|[\s|])(?:s[oó]|somente|apenas|only)\s+`([a-zA-Z][a-zA-Z0-9_-]{2,80})`/gi,
      ),
    ];
    for (const m of soMatches) {
      const name = normalizeToolToken(m[1] ?? "");
      if (!name) continue;
      if (looksLikeFlowSlotKey(name)) continue;
      if (isLikelyMutableOrCompletionTool(name)) continue;
      if (isEscalationToolName(name)) continue;
      if (isLikelyUploadOrMediaTool(name)) continue;
      exclusive.add(name);
    }
  }

  return refineConfirmationExclusiveTools([...exclusive]);
}

/** Tools de conclusão (mutáveis) — exclui uploads/media e rótulos de passo. */
export function parseCompletionToolHintsFromPlaybook(text: string): string[] {
  const hints = new Set<string>();
  for (const line of text.split(/\n+/)) {
    if (/proibid/i.test(line) && !/\bS10\b|conclu[ií]d|passo\s*(?:final|\d+)/i.test(line)) continue;
    if (!COMPLETION_LINE_RE.test(line)) continue;
    for (const t of extractToolNamesFromText(line)) {
      if (isLikelyUploadOrMediaTool(t)) continue;
      if (isLikelyMutableOrCompletionTool(t)) hints.add(t);
    }
  }
  return [...hints];
}

/** Mantém só nomes presentes no catálogo (ou aliases por sufixo ≥8). */
export function filterCompletionHintsAgainstCatalog(
  hints: string[],
  available: Set<string>,
): string[] {
  if (available.size === 0) return hints.filter((h) => isPlausibleToolName(h));
  return hints.filter((h) => {
    const lower = h.toLowerCase();
    if (available.has(lower)) return true;
    const rn = lower.replace(/-/g, "_");
    if (rn.length < 8) return false;
    for (const a of available) {
      const an = a.replace(/-/g, "_");
      if (an === rn || an.endsWith(`_${rn}`) || (an.endsWith(rn) && an.length > rn.length)) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Regras do playbook: omitir tools quando facts/slots já presentes.
 * Ex.: linha com profilePhotoId + checkin_upload_* + PROIBIDO/já tem.
 */
export function parseOmitToolsWhenSlotsPresentFromPlaybook(text: string): Array<{
  tools: string[];
  slotKeys: string[];
}> {
  const rules: Array<{ tools: string[]; slotKeys: string[] }> = [];
  if (!text.trim()) return rules;

  const SLOT_KEY_RE = /\b([a-z][a-zA-Z0-9]{2,48})\b/g;

  for (const line of text.split(/\n+/)) {
    if (
      !/(flowSlots|já\s+tem|já\s+exist|ja\s+tem|ja\s+exist|already|when\s+.+\s+present|se\s+.+\s+exist|PROIBIDO|proibid|omit|skip)/i.test(
        line,
      )
    ) {
      continue;
    }
    // Só omitir uploads/media — nunca lookup (ex.: documentNumber + main_guest).
    const tools = extractToolNamesFromText(line).filter(isLikelyUploadOrMediaTool);
    if (tools.length === 0) continue;
    const slotKeys = [
      ...new Set(
        [...line.matchAll(SLOT_KEY_RE)].map((m) => m[1]!).filter(looksLikeFlowSlotKey),
      ),
    ];
    if (slotKeys.length === 0) continue;
    rules.push({ tools, slotKeys });
  }
  return rules;
}

function toolsToOmitWhenSlotsPresent(
  flowSlots: Record<string, string | number | boolean> | null | undefined,
  rules: Array<{ tools: string[]; slotKeys: string[] }>,
): string[] {
  if (!flowSlots || rules.length === 0) return [];
  const omit: string[] = [];
  for (const rule of rules) {
    const allPresent = rule.slotKeys.every((k) => {
      const v = flowSlots[k];
      return v != null && v !== "" && v !== 0;
    });
    if (allPresent) omit.push(...rule.tools);
  }
  return omit;
}

export function toolsMatchAlias(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/-/g, "_");
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Verifica se o conjunto de nomes viola algum par proibido.
 * Exige duas invocações distintas (índices diferentes) — um único
 * `audaar_consultar_reserva` NÃO pode satisfazer ambos os lados via alias.
 */
export function findForbiddenPairViolation(
  toolNames: string[],
  pairs: ForbiddenToolPair[],
): ForbiddenToolPair | null {
  for (const pair of pairs) {
    if (toolsMatchAlias(pair.a, pair.b)) continue;
    const indicesA: number[] = [];
    const indicesB: number[] = [];
    for (let i = 0; i < toolNames.length; i++) {
      const n = toolNames[i]!;
      if (toolsMatchAlias(n, pair.a)) indicesA.push(i);
      if (toolsMatchAlias(n, pair.b)) indicesB.push(i);
    }
    for (const i of indicesA) {
      for (const j of indicesB) {
        if (i !== j) return pair;
      }
    }
  }
  return null;
}

export function resolveTurnPolicy(
  behaviorConfig: Record<string, unknown> | null | undefined,
  options: {
    userMessage?: string;
    priorToolOutcomes?: PriorToolOutcome[];
    /** Catálogo real do agente — exclusive nunca agenda nomes fora deste set. */
    availableToolNames?: Iterable<string>;
    flowSlots?: Record<string, string | number | boolean> | null;
    /** Última resposta do agente (espelho / pergunta) — desambigua o passo C11. */
    lastAssistantMessage?: string | null;
    /** Memória do turno (facts EIL) — N de hóspedes quando ainda não está em flowSlots. */
    memory?: Record<string, unknown> | null;
    /**
     * Turno sintético pós-conclusão (Passo 8) ou sessão com conclusion pending.
     * Não reabre exclusive de gate nem trata "OK" como C11.
     */
    postCompletionFollowUp?: boolean;
  } = {},
): TurnPolicy {
  const empty: TurnPolicy = {
    forbiddenSameTurnPairs: [],
    exclusiveAllowedTools: null,
    completionToolHints: [],
    confirmationPrerequisiteTools: [],
    omitToolsWhenSlotsPresent: [],
    blockEscalation: false,
  };
  if (!behaviorConfig || typeof behaviorConfig !== "object") {
    return empty;
  }

  const playbook = playbookTextFromBehavior(behaviorConfig);
  const forbiddenSameTurnPairs = parseForbiddenSameTurnPairsFromPlaybook(playbook);
  let completionToolHints = parseCompletionToolHintsFromPlaybook(playbook);
  let confirmationPrerequisiteTools = parseExclusiveToolsForConfirmationTurn(playbook);
  const omitToolsWhenSlotsPresent = parseOmitToolsWhenSlotsPresentFromPlaybook(playbook);

  const available = new Set(
    [...(options.availableToolNames ?? [])].map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (available.size > 0) {
    confirmationPrerequisiteTools = confirmationPrerequisiteTools.filter((t) => available.has(t));
    completionToolHints = filterCompletionHintsAgainstCatalog(completionToolHints, available);
  } else {
    completionToolHints = completionToolHints.filter((t) => isPlausibleToolName(t));
  }

  const priorOk = (options.priorToolOutcomes ?? []).filter((t) => t.ok !== false);
  const completionAlreadyDone = completionToolHints.some((h) =>
    toolOutcomeSatisfiesRequired(h, priorOk),
  );
  const postCompletionMode =
    options.postCompletionFollowUp === true ||
    isPostCompletionPending(options.flowSlots) ||
    (completionAlreadyDone && assistantIsPostCheckInAck(options.lastAssistantMessage));

  // Passo 8 / pós-check-in: sem exclusive de gate; não bloquear KB/lookup por "OK".
  if (postCompletionMode) {
    return {
      forbiddenSameTurnPairs,
      exclusiveAllowedTools: null,
      completionToolHints,
      confirmationPrerequisiteTools,
      omitToolsWhenSlotsPresent,
      blockEscalation: false,
    };
  }

  const userMessage = (options.userMessage ?? "").trim();
  const isConfirmation = Boolean(userMessage && CONFIRMATION_USER_MSG_RE.test(userMessage));

  let exclusiveAllowedTools: string[] | null = null;
  const suppressExclusive =
    isConfirmation &&
    shouldSuppressConfirmationExclusiveTools({
      lastAssistantMessage: options.lastAssistantMessage,
      flowSlots: options.flowSlots,
      userMessage,
      memory: options.memory,
    });

  if (isConfirmation && confirmationPrerequisiteTools.length > 0 && !suppressExclusive) {
    const pendingExclusive = confirmationPrerequisiteTools.filter(
      (tool) => !toolOutcomeSatisfiesRequired(tool, priorOk),
    );
    if (pendingExclusive.length > 0) {
      exclusiveAllowedTools = pendingExclusive;
    }
  }

  return {
    forbiddenSameTurnPairs,
    exclusiveAllowedTools,
    completionToolHints,
    confirmationPrerequisiteTools,
    omitToolsWhenSlotsPresent,
    blockEscalation: isConfirmation,
  };
}

/**
 * Turno sim/ok: pré-requisitos do playbook já satisfeitos na sessão → exige tool de conclusão.
 * Genérico: lê confirmationPrerequisiteTools + completionToolHints do playbook (sem nomes fixos).
 *
 * Regras anti-salto de fase:
 * - freezeCompletionPromotion: turno começou com exclusive gate — não promove conclusão no mesmo turno
 * - awaitingPostGateData sem completionReady: falta recolha de dados após o gate
 * - completionReady explícito obrigatório (sem legado "flags ausentes ⇒ permitir")
 * - lastAssistantMessage: só promove no passo de conclusão (ficha), não no titular/S4c
 * - sessionPriorOutcomes: pré-requisitos têm de existir ANTES deste turno (não só após schedule)
 */
export function resolveCompletionRequiredToolsForConfirmation(
  policy: TurnPolicy,
  priorToolOutcomes: PriorToolOutcome[],
  opts?: {
    sessionPriorOutcomes?: PriorToolOutcome[];
    flowSlots?: Record<string, string | number | boolean> | null;
    freezeCompletionPromotion?: boolean;
    lastAssistantMessage?: string | null;
  },
): string[] {
  if (!policy.blockEscalation || (policy.exclusiveAllowedTools?.length ?? 0) > 0) {
    return [];
  }
  if (opts?.freezeCompletionPromotion) {
    return [];
  }
  const prerequisites = policy.confirmationPrerequisiteTools;
  if (prerequisites.length === 0 || policy.completionToolHints.length === 0) {
    return [];
  }

  const sessionOk = (opts?.sessionPriorOutcomes ?? priorToolOutcomes).filter(
    (t) => t.ok !== false,
  );
  const prerequisiteSatisfiedInSession = prerequisites.some((p) =>
    toolOutcomeSatisfiesRequired(p, sessionOk),
  );
  if (!prerequisiteSatisfiedInSession) return [];

  // Exige ready explícito — CPF/nacionalidade já não armam a flag.
  if (!isCompletionReady(opts?.flowSlots)) {
    return [];
  }
  if (isAwaitingPostGateData(opts?.flowSlots)) {
    return [];
  }

  if (
    !shouldAllowCompletionToolPromotion({
      lastAssistantMessage: opts?.lastAssistantMessage,
      flowSlots: opts?.flowSlots,
    })
  ) {
    return [];
  }

  const priorOk = priorToolOutcomes.filter((t) => t.ok !== false);
  const pendingCompletion = policy.completionToolHints.filter(
    (h) => !toolOutcomeSatisfiesRequired(h, priorOk),
  );
  return pendingCompletion.length > 0 ? [pendingCompletion[0]!] : [];
}

/** Valida outcomes do turno contra a política (genérico multi-segmento). */
export function validateToolOutcomesAgainstTurnPolicy(
  toolOutcomes: Array<{ name: string; ok?: boolean; preview?: string }>,
  policy: TurnPolicy,
): string[] {
  const alerts: string[] = [];
  if (toolOutcomes.length === 0) return alerts;

  // Só tools que correram com sucesso contam para pares — skipped/pre-block
  // (ok:false) não devem disparar validation_block_send após o runtime impedir o 2.º lado.
  const effectiveOutcomes = toolOutcomes.filter((t) => t.ok !== false);
  const names = effectiveOutcomes.map((t) => t.name);
  const violation = findForbiddenPairViolation(names, policy.forbiddenSameTurnPairs);
  if (violation) {
    alerts.push(
      `Ferramentas proibidas no mesmo turno: ${violation.a} + ${violation.b}`,
    );
  }

  if (policy.blockEscalation) {
    for (const name of names) {
      if (isEscalationToolName(name)) {
        alerts.push(`Ferramenta fora da categoria do turno: ${name}`);
      }
    }
  }

  if (policy.exclusiveAllowedTools && policy.exclusiveAllowedTools.length > 0) {
    for (const name of names) {
      if (isEscalationToolName(name)) continue;
      // S9 / exclusividade pendente: conclusão e uploads também são fora de categoria.
      // S10 (pré-requisito já satisfeito) limpa exclusiveAllowedTools e permite check-in.
      const allowed = policy.exclusiveAllowedTools.some(
        (a) => toolOutcomeSatisfiesRequired(a, [{ name, preview: "" }]),
      );
      if (!allowed) {
        alerts.push(`Ferramenta fora da categoria do turno: ${name}`);
      }
    }
  }

  return alerts;
}

/**
 * Motivo para bloquear execução *antes* do side-effect (transfer/status/check-in).
 * null = permitido.
 *
 * Quando exclusiveAllowedTools está definido (ex. S9 / pré-requisito pendente),
 * APENAS essas tools podem correr — incluindo bloqueio de conclusão/upload.
 * S10 (pré-requisito já satisfeito) limpa exclusiveAllowedTools e permite check-in.
 */
export function turnPolicyPreExecBlockReason(
  toolName: string,
  policy: TurnPolicy,
): string | null {
  if (policy.blockEscalation && isEscalationToolName(toolName)) {
    const hint =
      policy.exclusiveAllowedTools && policy.exclusiveAllowedTools.length > 0
        ? ` Continue o fluxo — use apenas: ${policy.exclusiveAllowedTools.join(", ")}.`
        : " Continue o fluxo sem transferir.";
    return `Ferramenta de escalonamento ${toolName} bloqueada em turno de confirmação (C11).${hint}`;
  }
  if (!policy.exclusiveAllowedTools || policy.exclusiveAllowedTools.length === 0) {
    return null;
  }
  const allowed = policy.exclusiveAllowedTools.some((a) =>
    toolOutcomeSatisfiesRequired(a, [{ name: toolName, preview: "" }]),
  );
  if (!allowed) {
    return `Ferramenta ${toolName} fora da categoria deste turno. Use apenas: ${policy.exclusiveAllowedTools.join(", ")}. PARE e responda.`;
  }
  return null;
}

/** Resumo compacto da política de turno para Supervisor LLM / logs. */
export function formatTurnPolicyForSupervisor(policy: TurnPolicy): string {
  const lines: string[] = [];
  if (policy.blockEscalation) {
    lines.push(
      "- Escalonamento BLOQUEADO neste turno (sim/ok/não): proibido transfer_to_team, call_human, set_conversation_status.",
    );
  }
  if (policy.exclusiveAllowedTools?.length) {
    lines.push(`- Ferramentas permitidas neste turno: ${policy.exclusiveAllowedTools.join(", ")}.`);
  }
  if (policy.forbiddenSameTurnPairs.length > 0) {
    const sample = policy.forbiddenSameTurnPairs.slice(0, 6).map((p) => `${p.a}+${p.b}`);
    lines.push(`- Pares proibidos no mesmo turno (ex.): ${sample.join(" · ")}.`);
  }
  if (policy.completionToolHints.length > 0) {
    lines.push(
      `- Tools de conclusão (S10) quando aplicável: ${policy.completionToolHints.slice(0, 4).join(", ")}.`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : "(sem restrições de turno parseadas)";
}

/**
 * Bloqueio pre-exec unificado: escalonamento, exclusividade e pares proibidos.
 */
export function turnPolicyPreExecBlockReasonForTurn(
  toolName: string,
  existingToolNames: string[],
  policy: TurnPolicy,
): string | null {
  const exclusive = turnPolicyPreExecBlockReason(toolName, policy);
  if (exclusive) return exclusive;
  const proposed = [...existingToolNames, toolName];
  const pairHit = findForbiddenPairViolation(proposed, policy.forbiddenSameTurnPairs);
  if (pairHit) {
    return `PROIBIDO no mesmo turno: ${pairHit.a} + ${pairHit.b}. PARE e responda só com a acção da categoria actual.`;
  }
  return null;
}

function toolSatisfiedInSession(
  alias: string,
  priorToolNames: string[],
  existingToolNames: string[],
): boolean {
  const all = [...priorToolNames, ...existingToolNames];
  return all.some((n) => toolsMatchAlias(n, alias));
}

/** Omite uploads/media quando slots do playbook ou slots media genéricos já estão preenchidos. */
function inferUploadToolsToOmitWhenSlotsFilled(opts: {
  playbookText: string;
  flowSlots?: Record<string, string | number | boolean> | null;
  catalogToolNames?: string[];
}): string[] {
  const { playbookText, flowSlots, catalogToolNames = [] } = opts;
  const omit = new Set<string>();

  for (const line of playbookText.split(/\n+/)) {
    const slotKeys = extractSlotKeysFromLine(line);
    const uploadTools = extractToolNamesFromText(line).filter(isLikelyUploadOrMediaTool);
    if (slotKeys.length === 0 || uploadTools.length === 0) continue;
    if (slotKeys.every((k) => slotKeyIsFilled(flowSlots, k))) {
      for (const t of uploadTools) omit.add(t);
    }
  }

  if (hasFilledMediaOrDocumentSlots(flowSlots)) {
    for (const t of catalogToolNames.filter(isLikelyUploadOrMediaTool)) omit.add(t);
    for (const t of extractToolNamesFromText(playbookText).filter(isLikelyUploadOrMediaTool)) {
      omit.add(t);
    }
  }

  return [...omit];
}

/** Aliases a omitir do catálogo OpenAI neste turno (antes do LLM escolher). */
export function toolAliasesToOmitFromCatalog(opts: {
  policy: TurnPolicy;
  existingToolNames: string[];
  priorToolNames?: string[];
  flowSlots?: Record<string, string | number | boolean> | null;
  /** Texto do playbook — inferência de upload omit quando slots preenchidos. */
  playbookText?: string;
  /** Nomes reais no catálogo (HTTP + nativas) — omit genérico de uploads. */
  catalogToolNames?: string[];
}): string[] {
  const omit = new Set<string>();
  const { policy, existingToolNames } = opts;
  const priorToolNames = opts.priorToolNames ?? [];
  const pairs = policy.forbiddenSameTurnPairs;
  const catalog = opts.catalogToolNames ?? [];

  for (const pair of pairs) {
    if (toolsMatchAlias(pair.a, pair.b)) continue;
    const hasA = existingToolNames.some((n) => toolsMatchAlias(n, pair.a));
    const hasB = existingToolNames.some((n) => toolsMatchAlias(n, pair.b));
    if (hasA && !hasB) omit.add(pair.b);
    if (hasB && !hasA) omit.add(pair.a);
  }

  // Confirmação: nunca expor escalonamento (listar_equipas / transfer / call_human).
  if (policy.blockEscalation) {
    for (const name of catalog) {
      if (isEscalationToolName(name)) omit.add(name);
    }
    omit.add("listar_equipas");
    omit.add("transfer_to_team");
    omit.add("call_human");
    omit.add("set_conversation_status");
  }

  if (policy.exclusiveAllowedTools?.length) {
    // Allowlist estrito: só as tools exclusive (e ainda não satisfeitas neste turno).
    // Se o gate já correu (Scheduler), o catálogo fica vazio → LLM só responde.
    for (const name of catalog) {
      const allowed = policy.exclusiveAllowedTools.some((ex) => toolsMatchAlias(ex, name));
      if (!allowed) {
        omit.add(name);
        continue;
      }
      if (toolSatisfiedInSession(name, priorToolNames, existingToolNames)) {
        omit.add(name);
      }
    }
    for (const hint of policy.completionToolHints) omit.add(hint);
    for (const pair of pairs) {
      if (toolsMatchAlias(pair.a, pair.b)) continue;
      const aAllowed = policy.exclusiveAllowedTools.some((ex) => toolsMatchAlias(ex, pair.a));
      const bAllowed = policy.exclusiveAllowedTools.some((ex) => toolsMatchAlias(ex, pair.b));
      if (!aAllowed) omit.add(pair.a);
      if (!bAllowed) omit.add(pair.b);
    }
  } else if (policy.blockEscalation && policy.completionToolHints.length > 0) {
    for (const hint of policy.completionToolHints) {
      for (const pair of pairs) {
        if (toolsMatchAlias(pair.a, pair.b)) continue;
        if (toolsMatchAlias(hint, pair.a) && toolSatisfiedInSession(pair.b, priorToolNames, existingToolNames)) {
          omit.add(pair.b);
        }
        if (toolsMatchAlias(hint, pair.b) && toolSatisfiedInSession(pair.a, priorToolNames, existingToolNames)) {
          omit.add(pair.a);
        }
      }
    }
  }

  for (const alias of toolsToOmitWhenSlotsPresent(opts.flowSlots, policy.omitToolsWhenSlotsPresent)) {
    omit.add(alias);
  }

  if (opts.playbookText?.trim()) {
    for (const alias of inferUploadToolsToOmitWhenSlotsFilled({
      playbookText: opts.playbookText,
      flowSlots: opts.flowSlots,
      catalogToolNames: opts.catalogToolNames,
    })) {
      omit.add(alias);
    }
  }

  return [...omit];
}

export function toolNameMatchesOmitAlias(toolName: string, omitAliases: string[]): boolean {
  if (omitAliases.length === 0) return false;
  return omitAliases.some((alias) => toolsMatchAlias(toolName, alias));
}

/**
 * Decide se um retry do supervisor deve ser reply-only
 * (há tools OK e a falha é de qualidade de resposta, não de tool em falta).
 */
export function shouldUseReplyOnlyRetry(opts: {
  toolOutcomes: Array<{ name: string; ok: boolean }>;
  supervisorChecks?: Array<{ id: string; passed: boolean }>;
}): boolean {
  const hasSuccess = opts.toolOutcomes.some((t) => t.ok);
  if (!hasSuccess) return false;
  const failed = (opts.supervisorChecks ?? []).filter((c) => !c.passed).map((c) => c.id);
  if (failed.length === 0) return true;
  // Tools em falta → precisa de retry completo com ferramentas
  const missingTools = failed.some((id) =>
    /^(tool_used|tools_not_ignored)$/i.test(id) || /required/i.test(id),
  );
  if (missingTools) return false;
  // validation_passed / qualidade / coerência: tools já correram (mesmo ilegais) —
  // NÃO reexecutar HTTP (evita embratur×2 + side-effects). Só regenerar reply.
  return true;
}

/**
 * Resposta segura quando o modo estrito bloqueia após um gate de confirmação OK.
 * Genérico (sem campos de formulário fixos) — evita silêncio total ao contacto.
 */
export function buildPostGateSafeFallbackReply(opts: {
  gateToolNames: string[];
}): string {
  const gates = opts.gateToolNames.filter(Boolean).slice(0, 3).join(", ");
  const gatePart = gates
    ? `O passo técnico (${gates}) foi concluído com sucesso.`
    : "O passo técnico de confirmação foi concluído com sucesso.";
  return (
    `${gatePart} ` +
    "Para continuar, envie agora os dados pedidos no fluxo (formulário / campos em falta). " +
    "Não invente valores — use apenas o que o hóspede fornecer."
  );
}

/** True se alguma tool de pré-requisito de confirmação correu OK neste turno. */
export function confirmationGateSatisfiedThisTurn(
  policy: TurnPolicy,
  toolOutcomes: Array<{ name: string; ok?: boolean }>,
): boolean {
  const prereqs = policy.confirmationPrerequisiteTools;
  if (prereqs.length === 0) return false;
  const ok = toolOutcomes.filter((t) => t.ok !== false);
  return prereqs.some((p) => toolOutcomeSatisfiesRequired(p, ok));
}

/** True se alguma tool de conclusão (hints ou padrão genérico) correu OK neste turno. */
export function completionToolSatisfiedThisTurn(
  policy: TurnPolicy | null | undefined,
  toolOutcomes: Array<{ name: string; ok?: boolean }>,
): boolean {
  const hints = policy?.completionToolHints ?? [];
  return toolOutcomes.some(
    (t) =>
      t.ok !== false &&
      (hints.some((h) => toolOutcomeSatisfiesRequired(h, [t])) ||
        isLikelyMutableOrCompletionTool(t.name, hints)),
  );
}

/**
 * Resposta segura quando o modo estrito bloqueia após tool de conclusão OK.
 * Genérico — evita silêncio total após check-in / submit / finalize bem-sucedido.
 */
export function buildCompletionSafeFallbackReply(opts: {
  completionToolNames: string[];
}): string {
  const tools = opts.completionToolNames.filter(Boolean).slice(0, 3).join(", ");
  const toolPart = tools
    ? `A operação técnica (${tools}) foi concluída com sucesso.`
    : "A operação técnica de conclusão foi concluída com sucesso.";
  return (
    `${toolPart} ` +
    "Se precisar de mais alguma informação (acesso, horários, próximos passos), diga-me. " +
    "Não invente dados — use apenas o que as ferramentas devolveram."
  );
}
