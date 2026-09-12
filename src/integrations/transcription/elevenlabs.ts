import { getEnv } from '@/lib/env';
import { IntegrationError } from '@/lib/errors';
import type { TranscriptionProvider, Transcript } from '@/integrations/transcription/provider';

/**
 * ElevenLabs Scribe.
 *
 * ── Why this vendor ────────────────────────────────────────────────────────
 * Osman's call, 2026-09-12. What decides it for a UAE fit-out is that site
 * voice notes are half Arabic, half English, frequently both in one sentence,
 * recorded next to a concrete saw. Scribe detects the language itself rather
 * than being told, which matters because nobody is going to tag a voice note
 * with a language before pressing send.
 *
 * ── The one request ────────────────────────────────────────────────────────
 * Multipart, synchronous, one call per voice note. No webhook mode: an
 * asynchronous transcript arriving later would have to find its way back to a
 * change that has already been created, notified and possibly assessed, and
 * a second lane for that is not worth building for a thirty second clip.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 * Billed per minute of audio. A voice note is seconds, and only voice notes
 * reach here — nothing transcribes a photograph or a PDF.
 */

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';

/** Fail rather than hang. n8n retries the lane; a wedged request helps nobody. */
const TIMEOUT_MS = 120_000;

/**
 * The vendor's ceiling is gigabytes. Ours is far lower on purpose: anything
 * this big is not a voice note, and paying to transcribe an hour of audio
 * somebody attached by accident is a bill nobody authorised.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

interface ScribeResponse {
  text?: unknown;
  language_code?: unknown;
  language_probability?: unknown;
  audio_duration_secs?: unknown;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export const elevenLabsTranscriptionProvider: TranscriptionProvider = {
  name: 'elevenlabs',
  get model() {
    return getEnv().ELEVENLABS_STT_MODEL;
  },

  async transcribe(input): Promise<Transcript> {
    const env = getEnv();
    if (!env.ELEVENLABS_API_KEY) {
      throw new IntegrationError('ELEVENLABS_API_KEY is not set');
    }
    if (input.audio.byteLength === 0) {
      throw new IntegrationError('That voice note has no audio in it');
    }
    if (input.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new IntegrationError(
        `That audio is ${Math.round(input.audio.byteLength / 1024 / 1024)} MB, ` +
          `over the ${MAX_AUDIO_BYTES / 1024 / 1024} MB transcription limit`,
      );
    }

    const form = new FormData();
    form.append('model_id', env.ELEVENLABS_STT_MODEL);
    form.append(
      'file',
      new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
      input.fileName ?? 'voice-note',
    );
    // Speaker labels are not asked for. One person records a site voice note,
    // and diarisation on a single speaker buys nothing but a bigger answer.

    // Audio events OFF, and this is not a preference.
    //
    // Scribe tags non-speech by default and writes the tags INTO the text: a
    // tone comes back as "[tone]", and a voice note recorded next to a core
    // drill would come back with "[drilling]" and "[footsteps]" scattered
    // through it. That text becomes the description of a Potential Change,
    // which is printed in a notice and read by the other side's commercial
    // team. A variation record carrying "[footsteps]" is not a small
    // embarrassment; it is the sort of thing that gets a document dismissed.
    // Confirmed against the live API on 2026-09-12.
    form.append('tag_audio_events', 'false');

    if (input.languageHint) form.append('language_code', input.languageHint);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new IntegrationError(
        `Could not reach ElevenLabs: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    if (!response.ok) {
      // The body is read for the reason, and truncated. A vendor error page is
      // occasionally a whole HTML document, and it must not end up as a log
      // line thousands of characters long.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new IntegrationError(
        `ElevenLabs refused the voice note (${response.status}): ${detail || 'no detail'}`,
      );
    }

    const body = (await response.json().catch(() => null)) as ScribeResponse | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';

    // An empty transcript is a FAILURE, not an empty success. Writing "" onto
    // a change would say the engineer sent silence, and the audio would stop
    // being looked at because a transcript already existed.
    if (!text) {
      throw new IntegrationError('ElevenLabs returned no words for that voice note');
    }

    return {
      text,
      language: typeof body?.language_code === 'string' ? body.language_code : null,
      languageConfidence: num(body?.language_probability),
      durationSeconds: num(body?.audio_duration_secs),
      producedBy: `elevenlabs/${env.ELEVENLABS_STT_MODEL}`,
    };
  },
};
