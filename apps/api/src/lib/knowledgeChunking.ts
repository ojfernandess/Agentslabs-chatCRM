/** Segmentação simples por caracteres com sobreposição (pipeline RAG interno). */
export function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  const size = Math.max(200, Math.min(chunkSize, 8000));
  const ov = Math.max(0, Math.min(overlap, Math.floor(size / 2)));
  const chunks: string[] = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + size, t.length);
    chunks.push(t.slice(start, end));
    if (end >= t.length) break;
    start = Math.max(0, end - ov);
  }
  return chunks;
}
