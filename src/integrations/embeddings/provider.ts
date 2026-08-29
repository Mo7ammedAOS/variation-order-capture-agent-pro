/**
 * The embedding boundary.
 *
 * Vectors live in the same Postgres as the commercial data — see ADR 0002. A
 * hosted vector service would mean a shared control plane and per-client
 * accounts, and the embedded text here IS the client's commercial
 * correspondence.
 *
 * The model name and dimension are stored on every row. A model swap is then
 * detectable, and the affected rows can be re-embedded rather than silently
 * compared against vectors from a different space — which returns plausible,
 * meaningless neighbours.
 */

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dims: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dims: number;
  embed(text: string): Promise<EmbeddingResult>;
  embedMany(texts: string[]): Promise<EmbeddingResult[]>;
}

/** Vector column width. Changing this requires a migration and a re-embed. */
export const EMBEDDING_DIMS = 384;

export function normalise(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}
