export const CONFIRMATION_USER_MSG_RE =  /^(sim|ok|okay|certo|confirmo|confirma|yes|yep|não|nao|no)$/i;

/** Tool com efeito colateral / conclusão de fluxo (segment-agnóstico). */
export const MUTABLE_OR_COMPLETION_TOOL_RE =
  /(?:^|_)(?:check[_-]?in|checkin|submit|create|update|delete|cancel|confirm|finalize|finalizar|concluir|gravar|salvar|enviar|post|put|patch|write|book|reservar|complete|finish|pedido|order)(?:_|$)/i;

/** Upload / media / anexo — omitível quando facts/slots já preenchidos. */
export const UPLOAD_OR_MEDIA_TOOL_RE =
  /(?:^|_)(?:upload|selfie|photo|foto|documento|document|image|media|attachment|anexo|file)(?:_|$)/i;

/** Linha do playbook que descreve conclusão de passo (S10, Passo 8, submit, etc.). */
export const COMPLETION_LINE_RE =
  /conclu[ií]d|\bfinaliz\w*|submit|complete|\bdone\b|passo\s*(?:final|\d+)|step\s*(?:final|\d+)|\bS10\b/i;

/** Linguagem exclusiva no playbook (só/somente/apenas/only). */
export const EXCLUSIVE_LANGUAGE_RE =
  /(?:somente|apenas|only|exclusiv)\b|\bs[oó](?=\s|[`|]|$)/i;

/** Confirmação mencionada numa linha do playbook. */
export const CONFIRMATION_IN_LINE_RE =
  /\b(?:sim|ok|okay|certo|confirm|yes|n[aã]o|no)\b|`(?:sim|ok)`/i;

/** Coluna/título de tabela que indica tool permitida neste turno. */
export const TURN_TOOL_TABLE_MARKER_RE =
  /\b(?:neste turno|tool neste turno|permitid|allowed|gate|port[aã]o|categoria|passo|step|fase|stage)\b/i;

/** Chaves de slot plausíveis (camelCase Id, snake_case_id, has*). */
export const SLOT_KEY_TOKEN_RE = /\b([a-z][a-zA-Z0-9]{2,48})\b/g;

/** Slot preenchido que tipicamente satisfaz upload (PhotoId, documentId, hasPhoto, etc.). */
export const MEDIA_SLOT_KEY_HEURISTIC_RE =
  /(?:Photo|Document|Image|File|Attachment|Media|Selfie|Avatar|Picture)(?:Id|URL|Uri|Ref|Key)?$|^has[A-Z]/;

export function isLikelyUploadOrMediaTool(name: string): boolean {
  return UPLOAD_OR_MEDIA_TOOL_RE.test(name.toLowerCase().replace(/-/g, "_"));
}

export function isLikelyMutableOrCompletionTool(
  name: string,
  completionHints: string[] = [],
): boolean {
  const n = name.toLowerCase().replace(/-/g, "_");
  if (MUTABLE_OR_COMPLETION_TOOL_RE.test(n)) return true;
  for (const h of completionHints) {
    const hl = h.toLowerCase().replace(/-/g, "_");
    if (n === hl || n.includes(hl) || hl.includes(n)) return true;
  }
  return false;
}

export function looksLikeFlowSlotKey(key: string): boolean {
  if (!key || key.length < 3) return false;
  if (/^__/.test(key)) return false;
  return (
    /^(?:[a-z]+(?:Id|Code|Number|Token|Ref|Key|Uri|URL))$/.test(key) ||
    /^has[A-Z]/.test(key) ||
    /_(?:id|code|ref|key|uri|url)$/i.test(key)
  );
}

export function extractSlotKeysFromLine(line: string): string[] {
  return [...new Set([...line.matchAll(SLOT_KEY_TOKEN_RE)].map((m) => m[1]!).filter(looksLikeFlowSlotKey))];
}

export function slotKeyIsFilled(
  flowSlots: Record<string, string | number | boolean> | null | undefined,
  key: string,
): boolean {
  if (!flowSlots) return false;
  const v = flowSlots[key];
  return v != null && v !== "" && v !== 0 && v !== false;
}

/** Slots de media/documento preenchidos — gatilho genérico para omitir uploads. */
export function hasFilledMediaOrDocumentSlots(
  flowSlots: Record<string, string | number | boolean> | null | undefined,
): boolean {
  if (!flowSlots) return false;
  return Object.entries(flowSlots).some(
    ([k, v]) =>
      v != null &&
      v !== "" &&
      v !== 0 &&
      v !== false &&
      MEDIA_SLOT_KEY_HEURISTIC_RE.test(k),
  );
}

/**
 * Linha do playbook descreve exclusividade em turno de confirmação (sim/ok).
 * Exige linguagem exclusiva + sinal de confirmação — não basta “passo/categoria” na tabela
 * (isso poluía o allowlist e impedia a tool de conclusão no OpenNexo Runtime).
 */
export function lineDescribesConfirmationExclusiveTools(line: string): boolean {
  if (!EXCLUSIVE_LANGUAGE_RE.test(line)) return false;
  if (/proibid/i.test(line) && !/(?:s[oó]|somente|apenas|only)\s+`/i.test(line)) return false;
  if (!/(?:s[oó]|somente|apenas|only)\s+`/i.test(line)) return false;

  if (CONFIRMATION_IN_LINE_RE.test(line)) return true;
  // Passo N=1 / seta de fluxo com “só `tool`”
  if (/\bN\s*=\s*1\b/i.test(line) || /(?:→|->)/.test(line)) return true;
  return false;
}

/**
 * Lookup / knowledge — em confirmação, costumam poluir o exclusive quando o playbook
 * mistura `só \`consulta\`` / valores de tabela com gates reais (`reference`, etc.).
 */
export function isLikelyLookupOrKnowledgeTool(toolName: string): boolean {
  const n = toolName.trim().toLowerCase().replace(/-/g, "_");
  if (!n) return false;
  if (/(?:conhecimento|knowledge|rag|faq|wiki)/i.test(n)) return true;
  return /(?:^|_)(?:consult|consulta|lookup|search|find|get|fetch|read|buscar|query|retrieve)(?:_|$)/i.test(
    n,
  );
}

/** Gate típico de confirmação (referência, validação, emissão, registro). */
export function isLikelyConfirmationGateTool(toolName: string): boolean {
  const n = toolName.trim().toLowerCase();
  if (!n) return false;
  return /(?:reference|referenc|valid|emit|register|ficha|form|gate|confirm)/i.test(n);
}

/** Turnos de recolha de dados (formulário) não devem exigir tools de conclusão. */
export function isDataCollectionPatternId(patternId: string): boolean {
  return patternId === "structured_form_submission";
}

export function shouldExcludeCompletionToolFromRequired(
  patternId: string,
  toolName: string,
  completionHints: string[] = [],
): boolean {
  if (!isDataCollectionPatternId(patternId)) return false;
  return isLikelyMutableOrCompletionTool(toolName, completionHints);
}
