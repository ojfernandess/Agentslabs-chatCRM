const QUOTE_HEADER_PATTERNS = [
  /^on .+ wrote:?$/i,
  /^em .+ escreveu:?$/i,
  /^le .+ a écrit\s*:/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*mensagem original\s*-{2,}$/i,
  /^_{5,}\s*$/,
  /^from:\s+.+/i,
];

/** Corta citação inline ("… Em … escreveu:" / "… On … wrote:" na mesma linha). */
function truncateAtInlineQuoteHeader(line: string): { text: string; stop: boolean } {
  const match = line.match(/^(.+?)\s+(?:em .+ escreveu:?|on .+ wrote:?)\s*$/i);
  if (match?.[1]?.trim()) {
    return { text: match[1].trim(), stop: true };
  }
  return { text: line, stop: false };
}

/** Remove citações de resposta (>, "Em ... escreveu:", "On ... wrote:", etc.). */
export function stripEmailQuotedContent(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (QUOTE_HEADER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      break;
    }
    if (trimmed.startsWith(">")) {
      break;
    }
    const inline = truncateAtInlineQuoteHeader(line);
    if (inline.text.trim()) kept.push(inline.text);
    if (inline.stop) break;
  }

  let result = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  result = result
    .split("\n")
    .filter((line) => line.trim() !== ">")
    .join("\n")
    .trim();

  return result;
}

/** Extrai corpo exibível a partir do formato armazenado "assunto\\n\\ncorpo". */
export function emailMessageDisplayBody(body: string | null | undefined): string {
  const raw = body?.trim();
  if (!raw) return "";

  let content = raw;
  const subjectSplit = raw.split(/\n\n/);
  if (subjectSplit.length >= 2 && subjectSplit[0]?.trim()) {
    content = subjectSplit.slice(1).join("\n\n").trim();
  }

  return stripEmailQuotedContent(content);
}
