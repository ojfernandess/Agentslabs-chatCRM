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
  options: { userMessage?: string } = {},
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

  // Confirmação (sim/ok/não): bloquear só escalonamento.
  // NÃO aplicar exclusiveAllowedTools=[embratur-reference] a todo "sim":
  // isso quebra Ficha DE VIAGEM → S10 (`audaar_check_in`) — HJ2XQZXO-FICHA.
  // Pares proibidos + prompt cobrem titular→S9 vs ficha→S10.
  return {
    forbiddenSameTurnPairs,
    exclusiveAllowedTools: null,
    completionToolHints,
    blockEscalation: isConfirmation,
  };
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
      // Ficha→sim→check_in: conclusão não é hard-block por exclusividade C11/S9
      if (isLikelyMutableOrCompletionTool(name, policy.completionToolHints)) continue;
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
  if (isLikelyMutableOrCompletionTool(toolName, policy.completionToolHints)) {
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

/**
 * Aliases a omitir do catálogo OpenAI neste turno (antes do LLM escolher).
 * - Se A já correu, omite B (e vice-versa) para cada par proibido.
 * - Em confirmação (sim/ok) com completion hints: trata conclusão como iminente
 *   e omite o lado complementar do par (ex.: embratur-reference quando S10/check-in).
 */
export function toolAliasesToOmitFromCatalog(opts: {
  policy: TurnPolicy;
  existingToolNames: string[];
}): string[] {
  const omit = new Set<string>();
  const { policy, existingToolNames } = opts;
  const pairs = policy.forbiddenSameTurnPairs;
  if (pairs.length === 0) return [];

  for (const pair of pairs) {
    if (toolsMatchAlias(pair.a, pair.b)) continue;
    const hasA = existingToolNames.some((n) => toolsMatchAlias(n, pair.a));
    const hasB = existingToolNames.some((n) => toolsMatchAlias(n, pair.b));
    if (hasA && !hasB) omit.add(pair.b);
    if (hasB && !hasA) omit.add(pair.a);
  }

  if (policy.blockEscalation && policy.completionToolHints.length > 0) {
    for (const hint of policy.completionToolHints) {
      for (const pair of pairs) {
        if (toolsMatchAlias(pair.a, pair.b)) continue;
        if (toolsMatchAlias(hint, pair.a)) omit.add(pair.b);
        if (toolsMatchAlias(hint, pair.b)) omit.add(pair.a);
      }
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
