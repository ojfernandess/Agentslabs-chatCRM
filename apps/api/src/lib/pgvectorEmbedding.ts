/** Dimensão fixa da coluna `vector(1536)` (text-embedding-3-small). */
export const KB_EMBEDDING_DIMENSIONS = 1536;

export function assertKbEmbeddingVector(vec: number[]): void {
  if (vec.length !== KB_EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding dimension ${vec.length}; expected ${KB_EMBEDDING_DIMENSIONS} for KB pgvector column`);
  }
  for (const n of vec) {
    if (!Number.isFinite(n)) throw new Error("Embedding contains non-finite values");
  }
}

/** Literal seguro para `::vector` em SQL (apenas dígitos, sinais, `e`, ponto e vírgulas). */
export function embeddingToVectorLiteral(vec: number[]): string {
  assertKbEmbeddingVector(vec);
  return `[${vec.join(",")}]`;
}
