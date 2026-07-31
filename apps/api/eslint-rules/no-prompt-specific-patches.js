/**
 * ESLint rule — bloqueia patches prompt-specific (Fase 8).
 * Usável via ESLint flat config ou via scripts/check-prompt-specific-patches.mjs.
 */

/** @typedef {{ id: string; re: RegExp; message: string; blocking?: boolean }} PatchPattern */

/** @type {PatchPattern[]} */
export const PROMPT_SPECIFIC_PATCH_PATTERNS = [
  {
    id: "tool-name-if-check-in",
    re: /if\s*\(\s*(?:toolName|row\.name|\bname\b)\s*===?\s*['"][^'"]*(?:check[_-]?in|embratur|audaar)/gi,
    message: "IF específico por toolName — usar CapabilityGraph / LlmToolSandbox.",
  },
  {
    id: "prompt-includes",
    re: /prompt\.includes\s*\(/g,
    message: "prompt.includes() proibido — usar Prompt IR / TurnContextPacker.",
  },
  {
    id: "bot-id-branch",
    re: /\bif\s*\(\s*botId\s*===/g,
    message: "Branch por botId — mover para behaviorConfig / playbookEnrichment.",
  },
];

/** Patterns legacy — report-only até eliminação Fase 9. */
export const PROMPT_SPECIFIC_LEGACY_PATTERNS = [
  {
    id: "hardcoded-audaar-url",
    re: /https:\/\/pms\.audaar\.com\.br/g,
    message: "URL hardcoded — usar playbookEnrichment.checkinLink.",
  },
  {
    id: "build-modelo-s-direct",
    re: /\bbuildModeloS[0-9]+(?:\(|Template)/g,
    message: "Modelo S* legacy — migrar para ReplyTemplateRenderer.",
  },
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow prompt-specific runtime patches in agent-engine",
    },
    messages: {
      forbidden: "{{message}} (pattern: {{id}})",
    },
    schema: [],
  },
  create(context) {
    const source = context.sourceCode.getText();
    for (const pattern of PROMPT_SPECIFIC_PATCH_PATTERNS) {
      pattern.re.lastIndex = 0;
      let m;
      while ((m = pattern.re.exec(source)) !== null) {
        const loc = context.sourceCode.getLocFromIndex(m.index);
        context.report({
          loc: { line: loc.line, column: loc.column },
          messageId: "forbidden",
          data: { id: pattern.id, message: pattern.message },
        });
      }
    }
    return {};
  },
};

/**
 * Scan ficheiros por patterns proibidos (sem ESLint).
 * @param {string} content
 * @param {string} relPath
 */
export function scanContentForPromptPatches(content, relPath) {
  const hits = [];
  for (const pattern of PROMPT_SPECIFIC_PATCH_PATTERNS) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split("\n").length;
      hits.push({
        pattern: pattern.id,
        rel: relPath,
        line,
        message: pattern.message,
        snippet: m[0].slice(0, 80),
      });
    }
  }
  return hits;
}
