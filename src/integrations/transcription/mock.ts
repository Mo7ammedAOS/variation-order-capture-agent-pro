import type { TranscriptionProvider, Transcript } from '@/integrations/transcription/provider';

/**
 * The deterministic one, for tests and for a machine with no vendor key.
 *
 * It says plainly that it is a mock. A plausible invented sentence would be
 * far worse than an obvious marker: it would read as a real transcript in the
 * evidence pack, and somebody would eventually quote it at a client.
 */
export const mockTranscriptionProvider: TranscriptionProvider = {
  name: 'mock',
  model: 'mock',

  async transcribe(input): Promise<Transcript> {
    return {
      text: `[mock transcript of ${input.mimeType}, ${input.audio.byteLength} bytes]`,
      language: 'en',
      languageConfidence: null,
      durationSeconds: null,
      producedBy: 'mock',
    };
  },
};
