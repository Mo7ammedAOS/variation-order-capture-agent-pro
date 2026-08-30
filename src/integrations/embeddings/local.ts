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
    const { pipeline, env } = await import('@huggingface/transformers');

    // Where the weights live, stated rather than inherited.
    //
    // Transformers.js defaults to caching inside its own package directory,
    // `node_modules/@huggingface/transformers/.cache`. The Docker image builds
    // in one stage and runs in another that carries only a traced subset of
    // node_modules, so a cache written to the library's default path in the
    // build stage is not necessarily at the same path at runtime. Naming the
    // directory makes both stages agree, and it is one COPY.
    //
    // Neither variable is set in local development, so this is inert there and
    // the library behaves exactly as before.
    if (process.env.TRANSFORMERS_CACHE_DIR) {
      env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
    }

    // In the container the weights are already present. Refusing to reach out
    // turns "the cache path is wrong" into an immediate loud failure, instead
    // of a silent download on the first capture — which would work, slowly,
    // and only until the VPS could not reach huggingface.co.
    if (process.env.TRANSFORMERS_OFFLINE === '1') {
      env.allowRemoteModels = false;
    }

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
