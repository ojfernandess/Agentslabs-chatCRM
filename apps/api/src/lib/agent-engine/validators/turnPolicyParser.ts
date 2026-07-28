import {
  extractPositiveToolNamesFromLine,
  extractToolNamesFromText,
  playbookTextFromBehavior,
  toolOutcomeSatisfiesRequired,
} from "./requiredToolNamesParser.js";

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
   * Nota: tools de conclusão (check-in) não são hard-blockadas por exclusividade
   * (ex.: Ficha→sim→audaar_check_in).
   */
  exclusiveAllowedTools: string[] | null;
  /** Nomes que o playbook trata como conclusão / mutação (check-in, submit, etc.). */
  completionToolHints: string[];
  /** true em turnos sim/ok/não — bloqueia transfer/call_human/status. */
  blockEscalation: boolean;
};

const CONFIRMATION_MSG_RE = /^(sim|ok|okay|certo|confirmo|confirma|yes|yep|não|nao|no)$/i;

export function isConfirmationUserMessage(msg: string): boolean {
  return CONFIRMATION_MSG_RE.test(msg.trim());
}

/**
 * Classifica o Portão C11 a partir da última resposta do agente (genérico).
 * titular_mirror → S9 (só reference/embratur); travel_form_mirror → S10 (só check_in).
 */
export type ConfirmationGateKind =
  | "titular_mirror"
  | "travel_form_mirror"
  | "data_collection"
  | "unknown";

export function classifyConfirmationGate(lastAssistantMessage: string): ConfirmationGateKind {
  const t = lastAssistantMessage.trim();
  if (!t) return "unknown";

  // Ficha / S9b — antes de titular (mais específico)
  if (
    /ficha\s+de\s+viagem|confirme\s+(?:os\s+dados\s+(?:da\s+)?)?ficha|dados\s+da\s+(?:sua\s+)?viagem/i.test(
      t,
    ) ||
    (/motivo\s+(?:da\s+)?viagem/i.test(t) &&
      /transporte|pa[ií]ses?/i.test(t) &&
      /confirm/i.test(t))
  ) {
    return "travel_form_mirror";
  }

  if (
    /confirme\s+os\s+dados\s+do\s+titular|dados\s+do\s+titular|espelho\s+(?:do\s+)?titular|cadastro\s+(?:anterior|encontrado).*titular|\bTITULAR\b/i.test(
      t,
    )
  ) {
    return "titular_mirror";
  }

  // Template S9 a pedir os 6 campos (ainda sem espelho ficha)
  if (
    /motivo\s+(?:da\s+)?viagem|meio\s+de\s+transporte|pa[ií]ses?\s+visitad|cidades?\s+visitad/i.test(
      t,
    )
  ) {
    return "data_collection";
  }

  return "unknown";
}

/** Exclusive lock só isenta tools de conclusão quando o allowlist já é de conclusão (S10). */
export function exclusiveExemptsCompletionTools(policy: TurnPolicy): boolean {
  const ex = policy.exclusiveAllowedTools;
  if (!ex || ex.length === 0) return true;
  return ex.some((a) => isLikelyMutableOrCompletionTool(a, policy.completionToolHints));
}

/** True se a reply volta a pedir a mesma confirmação que a última msg outbound. */
export function replyReasksSameConfirmationGate(
  replyText: string,
  lastAssistantMessage: string,
): boolean {
  const prior = classifyConfirmationGate(lastAssistantMessage);
  if (prior !== "titular_mirror" && prior !== "travel_form_mirror") return false;
  return classifyConfirmationGate(replyText) === prior;
}

type CatalogItem = { id?: number | string; name?: string };

function extractNamedCatalog(
  payload: unknown,
  keys: string[],
): CatalogItem[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  for (const key of keys) {
    const arr = data[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const items: CatalogItem[] = [];
    for (const el of arr.slice(0, 9)) {
      if (!el || typeof el !== "object") continue;
      const o = el as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.split(" - ")[0]!.trim() : undefined;
      if (!name) continue;
      items.push({
        id: typeof o.id === "number" || typeof o.id === "string" ? o.id : undefined,
        name,
      });
    }
    if (items.length > 0) return items;
  }
  return [];
}

/**
 * Após confirmação de identidade + tool de catálogo/referência OK: pedir formulário seguinte.
 * Genérico — usa listas `reasons`/`transports` (ou equivalentes) do JSON da tool.
 */
export function buildAdvanceAskFromReferenceCatalog(
  toolOutcomes: Array<{
    name: string;
    ok: boolean;
    preview: string;
    structuredPayload?: unknown;
  }>,
): string | null {
  const okTools = toolOutcomes.filter(
    (t) => t.ok && !isSkippedToolOutcome(t.preview) && !/check[_-]?in/i.test(t.name),
  );
  for (const t of okTools) {
    let payload: unknown = t.structuredPayload;
    if (payload == null) {
      try {
        payload = JSON.parse(t.preview);
      } catch {
        continue;
      }
    }
    // bodyPreview aninhado (HTTP wrapper)
    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      if (typeof p.bodyPreview === "string") {
        try {
          payload = JSON.parse(p.bodyPreview);
        } catch {
          /* keep wrapper */
        }
      }
    }
    const reasons = extractNamedCatalog(payload, ["reasons", "motivos", "travelReasons"]);
    const transports = extractNamedCatalog(payload, [
      "transports",
      "transportes",
      "transportTypes",
    ]);
    if (reasons.length === 0 && transports.length === 0) continue;

    const reasonHint = reasons
      .slice(0, 4)
      .map((r) => r.name)
      .filter(Boolean)
      .join(", ");
    const transportHint = transports
      .slice(0, 4)
      .map((r) => r.name)
      .filter(Boolean)
      .join(", ");

    const lines = [
      "Obrigado pela confirmação. Para avançarmos, informe:",
      reasonHint
        ? `• Motivo da viagem (ex.: ${reasonHint})`
        : "• Motivo da viagem",
      transportHint
        ? `• Meio de transporte (ex.: ${transportHint})`
        : "• Meio de transporte",
      "• País de residência",
      "• País de destino",
      "• Cidade de procedência",
      "• Cidade de destino",
    ];
    return lines.join("\n");
  }
  return null;
}

/** Escalonamento / handoff — nunca entram no allowlist de confirmação (C11). */
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

const FORBIDDEN_PAIR_LINE_RE =
  /proibid[oa]|n[aã]o\s+mistur|mesmo\s+turno|same\s*turn|must\s+not\s+(?:call|combine|mix)|never\s+(?:call|combine|mix)/i;

/** Heurística segment-agnóstica de tool mutável / de conclusão. */
const MUTABLE_OR_COMPLETION_RE =
  /(?:^|_)(?:check[_-]?in|checkin|submit|create|update|delete|cancel|confirm|finalize|concluir|gravar|salvar|enviar|post|put|patch|write|book|reservar)(?:_|$)/i;

/** Tokens de prosa em exemplos do playbook (ex.: "lookup + Embratur") — não são tools. */
const PROSE_CATEGORY_TOKENS = new Set([
  "lookup",
  "embratur",
  "modelo",
  "verificar",
  "category",
  "tool",
  "tools",
  "passo",
  "modelo_s1",
]);

/** Nome parece identificador de ferramenta (não categoria de prosa). */
function looksLikeToolIdentifier(token: string): boolean {
  const raw = token.toLowerCase().trim();
  const norm = raw.replace(/-/g, "_");
  if (PROSE_CATEGORY_TOKENS.has(norm) || PROSE_CATEGORY_TOKENS.has(raw)) return false;
  if (raw.includes("_") || raw.includes("-")) return true;
  // Aliases curtos legítimos (ex.: reference) — só se ≥ 8 e sem ser prosa conhecida
  return raw.length >= 8;
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

    // Padrão sem backticks: "reference + check-in".
    // Ignorar exemplos de prosa curtos (ex.: "lookup + Embratur") — só tokens
    // que parecem nomes de tool (underscore, hífen composto, ou ≥12 chars).
    const plusMatch = line.match(
      /([a-z][a-z0-9_-]{2,40})\s*\+\s*([a-z][a-z0-9_-]{2,40})/gi,
    );
    if (plusMatch) {
      for (const m of plusMatch) {
        const parts = m.split(/\s*\+\s*/);
        if (parts.length === 2 && parts[0] && parts[1]) {
          const a = parts[0].toLowerCase();
          const b = parts[1].toLowerCase();
          if (!looksLikeToolIdentifier(a) || !looksLikeToolIdentifier(b)) continue;
          pairs.push({ a, b, source: line.trim().slice(0, 160) });
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
 * Em turnos de confirmação curta (sim/ok), extrai tools exclusivas de linhas
 * com "só/somente" + tool, ou da coluna "Tool neste turno" da tabela C11/N=1.
 * Nunca inclui conclusão/mutação nem escalonamento (call_human / transfer / status).
 */
export function parseExclusiveToolsForConfirmationTurn(playbookText: string): string[] {
  const exclusive = new Set<string>();
  if (!playbookText.trim()) return [];

  const addAllowed = (tools: string[]) => {
    for (const t of tools) {
      if (MUTABLE_OR_COMPLETION_RE.test(t)) continue;
      if (isEscalationToolName(t)) continue;
      exclusive.add(t);
    }
  };

  for (const line of playbookText.split(/\n+/)) {
    // Evitar `\bok\b` solto — casa com "já ok" (C8) e polui o allowlist.
    const isConfirmContext =
      /\b(C11|titular OK|após TITULAR|N\s*=\s*1\s*→\s*S9|N=1 → S9)\b/i.test(line) ||
      /`(?:sim|ok|okay|certo|não|nao)`/i.test(line) ||
      (/\bsim\b/i.test(line) && /\b(?:titular|S9|S4c|Portão|C11|espelho)\b/i.test(line)) ||
      (/\bN\s*=\s*1\b/.test(line) && /S9|reference/i.test(line));
    if (!isConfirmContext) continue;

    // Linha só de PROIBIDO (sem "só/somente") — não alimenta allowlist
    if (/proibid/i.test(line) && !/\bs[oó]\s+|somente\s+|apenas\s+|only\s+/i.test(line)) {
      continue;
    }

    // Tabela de categorias (GATE / C11): | categoria | tool permitida | proibido |
    // Não usar linhas do Portão cujo 1.º campo é "Espelho TITULAR" (coluna do meio ≠ tools).
    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cols.length >= 3 && /\b(?:C11\b|titular OK|N\s*=\s*1\s*→\s*S9)\b/i.test(cols[0]!)) {
      // Coluna "tool neste turno" — só positivas (só `x` / backticks sem never)
      const soMid = [
        ...cols[1]!.matchAll(/\b(?:s[oó]|somente|apenas|only)\s+`([a-z][a-z0-9_-]{2,80})`/gi),
      ];
      if (soMid.length > 0) {
        addAllowed(soMid.map((m) => m[1]!.toLowerCase()));
      } else if (!/proibid|nunca|zero/i.test(cols[1]!)) {
        addAllowed(extractPositiveToolNamesFromLine(cols[1]!));
      }
      // Última coluna (tabela 5 cols): só se tiver "só `tool`"
      if (cols.length >= 4) {
        const last = cols[cols.length - 1]!;
        const soLast = [
          ...last.matchAll(/\b(?:s[oó]|somente|apenas|only)\s+`([a-z][a-z0-9_-]{2,80})`/gi),
        ];
        addAllowed(soLast.map((m) => m[1]!.toLowerCase()));
      }
      continue;
    }

    // "só `embratur-reference`" — captura positiva após só/somente/apenas/only
    const soMatches = [
      ...line.matchAll(/\b(?:s[oó]|somente|apenas|only)\s+`([a-z][a-z0-9_-]{2,80})`/gi),
    ];
    if (soMatches.length > 0) {
      addAllowed(soMatches.map((m) => m[1]!.toLowerCase()));
    }
  }

  if (exclusive.size === 0) {
    for (const line of playbookText.split(/\n+/)) {
      if (!/N\s*=\s*1/i.test(line) || !/S9|reference/i.test(line)) continue;
      if (/proibid/i.test(line) && !/\bs[oó]\s+|somente|apenas|only/i.test(line)) continue;
      const soMatches = [
        ...line.matchAll(/\b(?:s[oó]|somente|apenas|only)\s+`([a-z][a-z0-9_-]{2,80})`/gi),
      ];
      if (soMatches.length > 0) {
        addAllowed(soMatches.map((m) => m[1]!.toLowerCase()));
      }
    }
  }

  return [...exclusive];
}

/** Tools de conclusão mencionadas junto a "concluído" / Passo final / S10. */
export function parseCompletionToolHintsFromPlaybook(text: string): string[] {
  const hints = new Set<string>();
  for (const line of text.split(/\n+/)) {
    if (!/conclu[ií]d|passo\s*8|S10|finaliz|submit|check[_-]?in/i.test(line)) continue;
    for (const t of extractToolNamesFromText(line)) {
      if (MUTABLE_OR_COMPLETION_RE.test(t) || /check/i.test(t)) hints.add(t);
    }
  }
  return [...hints];
}

/**
 * Só a tool de finalização (ex.: audaar_check_in) — exclui uploads/selfies
 * e atalhos de prosa do playbook (`s-check-in`) quando existe tool real.
 */
export function primaryFinalizeToolHints(hints: string[]): string[] {
  let primary = hints.filter(
    (h) =>
      /check[_-]?in|submit|finalize|concluir|gravar|salvar|enviar|book|reservar/i.test(h) &&
      !/upload|selfie|documento|document|photo|foto/i.test(h),
  );
  // Preferir identificadores reais (com `_`) — drop `s-check-in` / atalhos de 1 letra
  const vendorLike = primary.filter((h) => /_/.test(h) && !/^[a-z]-/i.test(h));
  if (vendorLike.length > 0) primary = vendorLike;
  return primary.length > 0 ? primary : hints;
}

/** Após conclusão OK: tools de entrega (KB / consulta) no mesmo turno — evita depender de continuação proactiva. */
export function isPostCompletionDeliveryTool(name: string): boolean {
  if (isEscalationToolName(name)) return false;
  if (isLikelyMutableOrCompletionTool(name, [])) return false;
  return /buscar_conhecimento|knowledge|consultar_|lookup|disponib/i.test(name);
}

export function isLikelyMutableOrCompletionTool(
  name: string,
  completionHints: string[] = [],
): boolean {
  const n = name.toLowerCase();
  if (MUTABLE_OR_COMPLETION_RE.test(n)) return true;
  for (const h of completionHints) {
    const hl = h.toLowerCase();
    if (n === hl || n.includes(hl) || hl.includes(n)) return true;
  }
  return false;
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
  options: { userMessage?: string; lastAssistantMessage?: string } = {},
): TurnPolicy {
  const empty: TurnPolicy = {
    forbiddenSameTurnPairs: [],
    exclusiveAllowedTools: null,
    completionToolHints: [],
    blockEscalation: false,
  };
  if (!behaviorConfig || typeof behaviorConfig !== "object") {
    return empty;
  }

  const playbook = playbookTextFromBehavior(behaviorConfig);
  const forbiddenSameTurnPairs = parseForbiddenSameTurnPairsFromPlaybook(playbook);
  const completionToolHints = parseCompletionToolHintsFromPlaybook(playbook);

  const userMessage = (options.userMessage ?? "").trim();
  const isConfirmation = Boolean(userMessage && CONFIRMATION_MSG_RE.test(userMessage));

  let exclusiveAllowedTools: string[] | null = null;
  if (isConfirmation) {
    const gate = classifyConfirmationGate(options.lastAssistantMessage ?? "");
    if (gate === "titular_mirror") {
      // N=1 titular → S9: só embratur/reference — NÃO isentar check_in
      const exclusive = parseExclusiveToolsForConfirmationTurn(playbook);
      exclusiveAllowedTools = exclusive.length > 0 ? exclusive : null;
    } else if (gate === "travel_form_mirror") {
      // Ficha confirmada → S10: só tools de finalização (não uploads)
      const primary = primaryFinalizeToolHints(completionToolHints);
      exclusiveAllowedTools = primary.length > 0 ? primary : null;
    }
    // data_collection / unknown: sem exclusive (pares + blockEscalation bastam)
  }

  return {
    forbiddenSameTurnPairs,
    exclusiveAllowedTools,
    completionToolHints,
    blockEscalation: isConfirmation,
  };
}

/** Tool pré-bloqueada pela política (exclusive/pair) — não conta como execução real. */
export function isSkippedToolOutcome(preview: string | undefined): boolean {
  return /"skipped"\s*:\s*true/i.test(preview ?? "");
}

/** Valida outcomes do turno contra a política (genérico multi-segmento). */
export function validateToolOutcomesAgainstTurnPolicy(
  toolOutcomes: Array<{ name: string; ok?: boolean; preview?: string }>,
  policy: TurnPolicy,
): string[] {
  const alerts: string[] = [];
  // Skip/block pre-exec (exclusive) NÃO é violação — a política já impediu o side-effect.
  // Contá-los gerava falso alerta (ex.: reference OK + check_in skipped) → reply-only → loop.
  const effective = toolOutcomes.filter((t) => !isSkippedToolOutcome(t.preview));
  if (effective.length === 0) return alerts;

  const names = effective.map((t) => t.name);
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
    const exemptCompletion = exclusiveExemptsCompletionTools(policy);
    const completionOk = effective.some(
      (t) =>
        t.ok !== false &&
        isLikelyMutableOrCompletionTool(t.name, policy.completionToolHints),
    );
    for (const name of names) {
      if (isEscalationToolName(name)) continue;
      // Pós-conclusão no mesmo turno: KB/consulta permitidos (Passo 8)
      if (completionOk && isPostCompletionDeliveryTool(name)) continue;
      // Ficha→sim→check_in: conclusão só isenta quando o allowlist é de S10
      if (
        exemptCompletion &&
        isLikelyMutableOrCompletionTool(name, policy.completionToolHints)
      ) {
        continue;
      }
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
 * Motivo para bloquear execução *antes* do side-effect (transfer/status).
 * null = permitido.
 */
export function turnPolicyPreExecBlockReason(
  toolName: string,
  policy: TurnPolicy,
): string | null {
  if (policy.blockEscalation && isEscalationToolName(toolName)) {
    const hint =
      policy.exclusiveAllowedTools && policy.exclusiveAllowedTools.length > 0
        ? ` Continue o check-in — use apenas: ${policy.exclusiveAllowedTools.join(", ")}.`
        : " Continue o check-in sem transferir.";
    return `Ferramenta de escalonamento ${toolName} bloqueada em turno de confirmação (C11).${hint}`;
  }
  if (!policy.exclusiveAllowedTools || policy.exclusiveAllowedTools.length === 0) {
    return null;
  }
  if (
    exclusiveExemptsCompletionTools(policy) &&
    isLikelyMutableOrCompletionTool(toolName, policy.completionToolHints)
  ) {
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

export function requiredToolsPreExecBlockReason(input: {
  toolName: string;
  existingToolNames: string[];
  requiredToolNames?: string[];
}): string | null {
  const required = [...new Set((input.requiredToolNames ?? []).filter((n) => n.trim().length > 0))];
  if (required.length === 0) return null;
  const priorOutcomes = input.existingToolNames.map((name) => ({ name, preview: "" }));
  const missing = required.filter((name) => !toolOutcomeSatisfiesRequired(name, priorOutcomes));
  if (missing.length === 0) return null;
  const currentSatisfiesRequired = required.some((name) =>
    toolOutcomeSatisfiesRequired(name, [{ name: input.toolName, preview: "" }]),
  );
  if (currentSatisfiesRequired) return null;
  const hasSatisfiedRequired = required.some((name) =>
    toolOutcomeSatisfiesRequired(name, priorOutcomes),
  );
  if (!hasSatisfiedRequired) {
    return (
      `Ferramenta ${input.toolName} bloqueada: este turno deve começar com a ferramenta ` +
      `obrigatória da categoria actual (${missing.join(", ")}).`
    );
  }
  if (!isEscalationToolName(input.toolName)) return null;
  return (
    `Ferramenta de escalonamento ${input.toolName} bloqueada: ainda faltam ferramentas ` +
    `obrigatórias deste turno (${missing.join(", ")}). Execute a categoria actual primeiro e só escale se o playbook mandar.`
  );
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
 * @param opts.completionAlreadySucceeded — após mutação OK, permite KB/consulta no mesmo turno.
 */
export function turnPolicyPreExecBlockReasonForTurn(
  toolName: string,
  existingToolNames: string[],
  policy: TurnPolicy,
  requiredToolNames: string[] = [],
  opts?: { completionAlreadySucceeded?: boolean },
): string | null {
  const requiredToolsBlock = requiredToolsPreExecBlockReason({
    toolName,
    existingToolNames,
    requiredToolNames,
  });
  if (requiredToolsBlock) return requiredToolsBlock;

  // Pós-conclusão: permitir tools de entrega antes do exclusive lock
  const deliveryOk =
    opts?.completionAlreadySucceeded === true && isPostCompletionDeliveryTool(toolName);

  if (!deliveryOk) {
    const exclusive = turnPolicyPreExecBlockReason(toolName, policy);
    if (exclusive) return exclusive;
  } else if (policy.blockEscalation && isEscalationToolName(toolName)) {
    return turnPolicyPreExecBlockReason(toolName, policy);
  }

  const proposed = [...existingToolNames, toolName];
  // Pares com tool de conclusão já OK + delivery: não bloquear consultar/KB após check_in
  const pairsToCheck =
    opts?.completionAlreadySucceeded && isPostCompletionDeliveryTool(toolName)
      ? policy.forbiddenSameTurnPairs.filter(
          (p) =>
            !(
              (isLikelyMutableOrCompletionTool(p.a, policy.completionToolHints) &&
                isPostCompletionDeliveryTool(p.b)) ||
              (isLikelyMutableOrCompletionTool(p.b, policy.completionToolHints) &&
                isPostCompletionDeliveryTool(p.a))
            ),
        )
      : policy.forbiddenSameTurnPairs;
  const pairHit = findForbiddenPairViolation(proposed, pairsToCheck);
  if (pairHit) {
    return `PROIBIDO no mesmo turno: ${pairHit.a} + ${pairHit.b}. PARE e responda só com a acção da categoria actual.`;
  }
  return null;
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

/** Instrução injectada no retry reply-only para manter o passo Portão (C11). */
export function buildReplyOnlyRetryPromptBlock(userMessage: string): string {
  const msg = userMessage.trim();
  if (!msg || !CONFIRMATION_MSG_RE.test(msg)) return "";

  return (
    "\n\n[OpenConduit — retry reply-only / confirmação C11]\n" +
    "O Supervisor pediu regenerar **apenas a resposta** — **PROIBIDO** invocar ferramentas neste retry.\n" +
    "Leia a **última mensagem SUA** no histórico:\n" +
    "- Se era espelho **TITULAR** + hóspede confirmou (`sim`/`ok`): avance para **S9** — template dos 6 campos Embratur. **Não** peça confirmação de novo.\n" +
    "- Se era espelho **FICHA DE VIAGEM** + hóspede confirmou: avance para **S10** — mensagem curta de check-in concluído (sem re-confirmar ficha).\n" +
    "- **PROIBIDO** reiniciar S1 · pedir CPF/nacionalidade · `audaar_consultar_reserva` · combinar `embratur-reference` + `audaar_check_in`.\n"
  );
}
