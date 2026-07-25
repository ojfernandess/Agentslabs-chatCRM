/** Resultado JSON de `buscar_conhecimento` (OpenNexo RAG legado e Knowledge Engine). */
export type BuscarConhecimentoPreview = {
  found?: boolean;
  ok?: boolean;
  skipped?: boolean;
  message?: string;
  bodyPreview?: string;
  articles?: Array<{ id?: string; title?: string; excerpt?: string; score?: number }>;
};

export function parseBuscarConhecimentoPreview(preview: string): BuscarConhecimentoPreview | null {
  const raw = preview.trim();
  if (!raw) return null;
  const tryParse = (text: string): BuscarConhecimentoPreview | null => {
    try {
      const parsed = JSON.parse(text) as BuscarConhecimentoPreview;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };
  let parsed = tryParse(raw);
  if (!parsed) return null;
  if (typeof parsed.bodyPreview === "string" && parsed.bodyPreview.trim()) {
    const inner = tryParse(parsed.bodyPreview.trim());
    if (inner) parsed = { ...parsed, ...inner };
  }
  return parsed;
}

/** Remove marcação markdown comum em excertos da KB para comparação textual. */
export function stripKnowledgeMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Texto legível extraído do preview JSON de buscar_conhecimento (qualquer segmento/título). */
export function buscarConhecimentoPreviewToPlainText(preview: string): string {
  const parsed = parseBuscarConhecimentoPreview(preview);
  if (!parsed) return preview;

  if (typeof parsed.message === "string" && parsed.message.trim() && parsed.found === false) {
    return parsed.message.trim();
  }

  if (Array.isArray(parsed.articles) && parsed.articles.length > 0) {
    return parsed.articles
      .slice(0, 6)
      .map((a) => {
        const title = typeof a.title === "string" ? a.title.trim() : "";
        const excerpt = typeof a.excerpt === "string" ? stripKnowledgeMarkdown(a.excerpt) : "";
        return [title, excerpt].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  if (typeof parsed.bodyPreview === "string" && parsed.bodyPreview.trim()) {
    return stripKnowledgeMarkdown(parsed.bodyPreview);
  }

  return preview;
}

export function buscarConhecimentoPreviewHasArticles(preview: string): boolean {
  const parsed = parseBuscarConhecimentoPreview(preview);
  if (!parsed || parsed.skipped) return false;
  if (parsed.found === false) return false;
  return Array.isArray(parsed.articles) && parsed.articles.some((a) => typeof a.excerpt === "string" && a.excerpt.trim().length > 0);
}
