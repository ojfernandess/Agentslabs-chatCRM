/**
 * O appendix «sem resultados» também é longo; não confundir com excertos reais.
 * Usado para omitir `buscar_conhecimento` só quando já há conteúdo útil injectado.
 * Ficheiro sem dependências (DB/config) para poder testar em isolamento.
 */
export function kbAppendixHasRetrievedExcerpts(appendix: string): boolean {
  const a = appendix.trim();
  if (!a) return false;
  if (a.includes("Não foi encontrado nenhum trecho indexado relevante")) return false;
  if (a.includes("(excertos recuperados automaticamente)")) return true;
  // LlamaIndex usa cabeçalho distinto mas injecta excertos reais da mesma forma.
  if (/###\s*Base de conhecimento \(LlamaIndex\)/i.test(a) && /\*\*\d+\./.test(a)) return true;
  return false;
}
