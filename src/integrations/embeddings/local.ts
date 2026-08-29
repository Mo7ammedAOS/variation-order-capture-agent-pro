import {
  EMBEDDING_DIMS,
  normalise,
  type EmbeddingProvider,
  type EmbeddingResult,
} from '@/integrations/embeddings/provider';

/**
 * Local embeddings via Transformers.js — MiniLM-L6-v2, 384 dimensions.
 *
 * Runs inside the Node process, so there is no API call, no cost, and no
 * client text leaving the deployment. This is the reason the app is hosted on a
 * long-lived container rather than serverless: the model loads once, and a cold
 * start per request would make it unusable.
 *
 * The weights are baked into the Docker image at build time, so a container
 * start never reaches out to download them.
 */

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

type FeatureExtractor = (
  text: string | string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<FeatureExtractor> | undefined;

async function getExtractor(): Promise<FeatureExtractor> {
  extractorPromise ??= (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const pipe = await pipeline('feature-extraction', MODEL_ID);
    return pipe as unknown as FeatureExtractor;
  })();
  return extractorPromise;
}

export const localEmbeddingProvider: EmbeddingProvider = {
  name: 'local',
  model: MODEL_ID,
  dims: EMBEDDING_DIMS,

  async embed(text: string): Promise<EmbeddingResult> {
    const [result] = await this.embedMany([text]);
    if (!result) throw new Error('Local embedding returned no vector');
    return result;
  },

  async embedMany(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    const extractor = await getExtractor();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const rows = output.tolist();

    return rows.map((vector) => {
      if (vector.length !== EMBEDDING_DIMS) {
        throw new Error(
          `Expected ${EMBEDDING_DIMS} dimensions from ${MODEL_ID}, got ${vector.length}. ` +
            'The vector column width and this model must agree.',
        );
      }
      return { vector: normalise(vector), model: MODEL_ID, dims: EMBEDDING_DIMS };
    });
  },
};
