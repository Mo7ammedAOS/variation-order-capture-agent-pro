import { getEnv } from '@/lib/env';
import type { EmbeddingProvider } from '@/integrations/embeddings/provider';
import { mockEmbeddingProvider } from '@/integrations/embeddings/mock';
import { localEmbeddingProvider } from '@/integrations/embeddings/local';

export * from '@/integrations/embeddings/provider';

export function getEmbeddingProvider(): EmbeddingProvider {
  switch (getEnv().EMBEDDING_PROVIDER) {
    case 'mock':
      return mockEmbeddingProvider;
    case 'voyage':
      // Phase 2. Voyage is a deliberate second vendor: Anthropic has no
      // embeddings endpoint, so higher-quality vectors mean another provider.
      throw new Error('The Voyage embedding provider is not implemented until Phase 2');
    case 'local':
    default:
      return localEmbeddingProvider;
  }
}
