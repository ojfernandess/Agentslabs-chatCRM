import {
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
   */
  exclusiveAllowedTools: string[] | null;
  /** Nomes que o playbook trata como conclusão / mutação (check-in, submit, etc.). */
  completionToolHints: string[];
};

const CONFIRMATION_MSG_RE = /^(sim|ok|okay|certo|confirmo|confirma|yes|yep|não|nao|no)$/i;

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
 * com "só/somente" + tool, ou da categoria de confirmação na tabela.
 * Nunca inclui tools de conclusão/mutação (essas pertencem a outro passo).
 */
export function parseExclusiveToolsForConfirmationTurn(playbookText: string): string[] {
  const exclusive = new Set<string>();
  if (!playbookText.trim()) return [];

  const addNonCompletion = (tools: string[]) => {
    for (const t of tools) {
      if (!MUTABLE_OR_COMPLETION_RE.test(t)) exclusive.add(t);
    }
  };

  for (const line of playbookText.split(/\n+/)) {
    const isConfirmContext =
      /\b(sim|ok|C11|titular OK|após TITULAR|N\s*=\s*1\s*→\s*S9|N=1 → S9)\b/i.test(line) ||
      (/\bN\s*=\s*1\b/.test(line) && /S9|reference/i.test(line));
    if (!isConfirmContext) continue;
    if (!/\bs[oó]\s+|somente\s+|apenas\s+|only\s+|`[^`]+`/.test(line)) continue;
    if (/\bs[oó]\s+|somente\s+|apenas\s+|only\s+/i.test(line) || /N\s*=\s*1/i.test(line)) {
      addNonCompletion(extractToolNamesFromText(line));
    }
  }

  if (exclusive.size === 0) {
    for (const line of playbookText.split(/\n+/)) {
      if (!/N\s*=\s*1/i.test(line) || !/S9|reference/i.test(line)) continue;
      addNonCompletion(extractToolNamesFromText(line));
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
  if (!behaviorConfig || typeof behaviorConfig !== "object") {
    return { forbiddenSameTurnPairs: [], exclusiveAllowedTools: null, completionToolHints: [] };
  }

  const playbook = playbookTextFromBehavior(behaviorConfig);
  const forbiddenSameTurnPairs = parseForbiddenSameTurnPairsFromPlaybook(playbook);
  const completionToolHints = parseCompletionToolHintsFromPlaybook(playbook);

  const userMessage = (options.userMessage ?? "").trim();
  let exclusiveAllowedTools: string[] | null = null;
  if (userMessage && CONFIRMATION_MSG_RE.test(userMessage)) {
    const exclusive = parseExclusiveToolsForConfirmationTurn(playbook);
    if (exclusive.length > 0) exclusiveAllowedTools = exclusive;
  }

  return { forbiddenSameTurnPairs, exclusiveAllowedTools, completionToolHints };
}

/** Valida outcomes do turno contra a política (genérico multi-segmento). */
export function validateToolOutcomesAgainstTurnPolicy(
  toolOutcomes: Array<{ name: string; ok?: boolean; preview?: string }>,
  policy: TurnPolicy,
): string[] {
  const alerts: string[] = [];
  if (toolOutcomes.length === 0) return alerts;

  const names = toolOutcomes.map((t) => t.name);
  const violation = findForbiddenPairViolation(names, policy.forbiddenSameTurnPairs);
  if (violation) {
    alerts.push(
      `Ferramentas proibidas no mesmo turno: ${violation.a} + ${violation.b}`,
    );
  }

  if (policy.exclusiveAllowedTools && policy.exclusiveAllowedTools.length > 0) {
    for (const name of names) {
      const allowed = policy.exclusiveAllowedTools.some(
        (a) => toolOutcomeSatisfiesRequired(a, [{ name, preview: "" }]),
      );
      // Escalation tools always blocked on confirmation unless exclusive lists them
      if (!allowed) {
        alerts.push(`Ferramenta fora da categoria do turno: ${name}`);
      }
    }
  }

  return alerts;
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
  const toolFailure = failed.some((id) =>
    /tool_used|tools_not_ignored|validation_passed|required/i.test(id),
  );
  // Se a falha é sobretudo resposta/memória/coerência → reply-only
  return !toolFailure || failed.some((id) => /prompt_coherent|memory|hallucin|strict/i.test(id));
}
