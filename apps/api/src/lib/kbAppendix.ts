/**
 * O appendix «sem resultados» também é longo; não confundir com excertos reais.
 * Usado para omitir `buscar_conhecimento` só quando já há conteúdo útil injectado.
 * Ficheiro sem dependências (DB/config) para poder testar em isolamento.
 */
export function kbAppendixHasRetrievedExcerpts(appendix: string): boolean {
  const a = appendix.trim();
  if (!a) return false;
  if (a.includes("Não foi encontrado nenhum trecho indexado relevante")) return false;
  // Qualquer provider (OpenNexo RAG, LlamaIndex, futuros): cabeçalho KB + itens numerados.
  if (/###\s*Base de conhecimento(?:\s*\([^)]+\))?/i.test(a) && /\*\*\d+\./.test(a)) return true;
  // Compatibilidade explícita com formatos legados sem regex genérico acima.
  if (a.includes("(excertos recuperados automaticamente)")) return true;
  if (/###\s*Base de conhecimento \(LlamaIndex\)/i.test(a) && /\*\*\d+\./.test(a)) return true;
  return false;
}

/** Remove cabeçalho/rodapé do appendix proactivo para extrair excertos (qualquer segmento). */
export function stripProactiveKnowledgeAppendixShell(appendix: string): string {
  return appendix
    .replace(/^[\s\S]*?###\s*Base de conhecimento(?:\s*\([^)]+\))?\s*/i, "")
    .replace(/\n\n\*\*Instruções:\*\*[\s\S]*$/i, "");
}
