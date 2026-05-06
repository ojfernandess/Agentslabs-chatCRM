/** Etiquetas de sistema usadas no backoffice — não mostrar em cartões/listagens. */
const HIDDEN_TAG_NAMES_LOWER = new Set(["desconhecido", "unknown"]);

export function filterTagsForDisplay<T extends { tag: { name: string } }>(rows: T[]): T[] {
  return rows.filter(({ tag }) => !HIDDEN_TAG_NAMES_LOWER.has(tag.name.trim().toLowerCase()));
}
