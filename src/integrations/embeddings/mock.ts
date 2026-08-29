import { createHash } from 'node:crypto';
import {
  EMBEDDING_DIMS,
  normalise,
  type EmbeddingProvider,
  type EmbeddingResult,
} from '@/integrations/embeddings/provider';

/**
 * Deterministic pseudo-embeddings for tests.
 *
 * Not semantic — it hashes tokens into buckets — but it is stable, offline, and
 * gives similar texts overlapping vectors, which is enough to prove that the
 * query path works and that project scoping holds. Never use it in production;
 * the similarity scores are meaningless as commercial signal.
 */
export const mockEmbeddingProvider: EmbeddingProvider = {
  name: 'mock',
  model: 'mock-hash-v1',
  dims: EMBEDDING_DIMS,

  async embed(text: string): Promise<EmbeddingResult> {
    const vector = new Array<number>(EMBEDDING_DIMS).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

    for (const token of tokens) {
      const digest = createHash('sha256').update(token).digest();
      const first = digest[0] ?? 0;
      const second = digest[1] ?? 0;
      const third = digest[2] ?? 0;
      const index = ((first << 8) | second) % EMBEDDING_DIMS;
      vector[index] = (vector[index] ?? 0) + 1 + third / 255;
    }

    return { vector: normalise(vector), model: 'mock-hash-v1', dims: EMBEDDING_DIMS };
  },

  async embedMany(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  },
};
