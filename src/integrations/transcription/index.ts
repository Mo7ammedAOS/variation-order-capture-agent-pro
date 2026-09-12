import { getEnv } from '@/lib/env';
import type { TranscriptionProvider } from '@/integrations/transcription/provider';
import { mockTranscriptionProvider } from '@/integrations/transcription/mock';
import { elevenLabsTranscriptionProvider } from '@/integrations/transcription/elevenlabs';

export * from '@/integrations/transcription/provider';

/**
 * Null when nobody has chosen a vendor.
 *
 * `none` is the default and is a real answer rather than a broken state: the
 * audio is still captured, still filed as evidence, still opened by a person.
 * What is missing is a machine reading of it. Returning a mock here instead
 * would put the string "[mock transcript...]" on live changes.
 */
export function getTranscriptionProvider(): TranscriptionProvider | null {
  switch (getEnv().TRANSCRIPTION_PROVIDER) {
    case 'elevenlabs':
      return elevenLabsTranscriptionProvider;
    case 'mock':
      return mockTranscriptionProvider;
    case 'none':
    default:
      return null;
  }
}
