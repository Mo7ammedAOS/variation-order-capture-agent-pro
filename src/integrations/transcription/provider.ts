/**
 * The transcription boundary.
 *
 * ── Why this is not part of `AiProvider` ───────────────────────────────────
 * Claude has no speech-to-text. Transcription is therefore a SECOND VENDOR,
 * the same way embeddings were, and giving it its own interface says so
 * honestly: a provider that cannot transcribe has no method it must throw
 * from, and swapping the transcriber does not touch the model that reads text.
 *
 * ── What a transcript is, and is not ───────────────────────────────────────
 * A transcript is a READING of the audio, not the audio. The original file is
 * stored as evidence, is never replaced, and is what a tribunal would be
 * shown. Everything downstream treats the transcript as what the machine
 * heard, attributed to the machine, and a person can correct it.
 */

export interface Transcript {
  /** What the machine heard. Never presented as what was said. */
  text: string;
  /** BCP-47 / ISO code the vendor detected, or null when it does not say. */
  language: string | null;
  /** 0..1 that the language detection was right, not that the words are. */
  languageConfidence: number | null;
  /** Length of the audio, where the vendor reports it. */
  durationSeconds: number | null;
  /** Which vendor and model produced it. Goes in the audit trail. */
  producedBy: string;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Reads a voice note.
   *
   * Throws on failure. Callers decide what a failure means — for a captured
   * WhatsApp voice note it means the change is created anyway, with the audio
   * filed and no transcript, because losing a site engineer's report because
   * a vendor is down is the one outcome this product may not produce.
   */
  transcribe(input: {
    audio: Buffer;
    mimeType: string;
    fileName?: string;
    /** ISO language code, when the project knows. Null lets the vendor detect. */
    languageHint?: string | null;
  }): Promise<Transcript>;
}
