import 'server-only';
import { getTranscriptionProvider } from '@/integrations/transcription';
import type { CaptureAttachment } from '@/services/document.service';

/**
 * Hearing a voice note.
 *
 * ── The problem this solves ────────────────────────────────────────────────
 * A site engineer standing next to a demolished wall records fifteen seconds
 * of audio. It is the fastest report anybody sends, it arrives with no text at
 * all, and until now the entire message read "[media only]" — so the change
 * had no description, the AI reader had nothing to read, the notice narrative
 * had no facts, and the register showed a row nobody could act on without
 * opening the audio. The most convenient way to report was the least useful
 * one to receive.
 *
 * ── What the transcript is allowed to be ───────────────────────────────────
 * It is the machine's reading of the audio, and it is labelled as such. The
 * original file is stored as evidence, is never replaced, and is what gets
 * played if anybody disputes a word of it. The transcript is a convenience on
 * top of the record, never the record.
 *
 * ── Why a failure is silent to the reporter ────────────────────────────────
 * A vendor being down, a key expiring, thirty seconds of wind noise: none of
 * those may cost a site engineer their report. The change is created either
 * way, with the audio filed and the text saying a voice note arrived. That is
 * the same rule the AI reader follows, for the same reason.
 */

/** Only audio is sent. Nothing pays to transcribe a photograph. */
function isVoiceNote(attachment: CaptureAttachment): boolean {
  return attachment.mimeType.toLowerCase().startsWith('audio/');
}

/**
 * True when the capture text is a placeholder rather than something a person
 * typed. A caption stands on its own and is never replaced by a transcript.
 */
function isPlaceholder(text: string): boolean {
  return text.trim() === '' || text.trim() === '[media only]';
}

export interface HeardVoiceNotes {
  /** The text the rest of capture should work from. */
  text: string;
  /** How many voice notes were actually transcribed. */
  transcribed: number;
  /** Vendor and model, for the audit trail. Null when nothing was heard. */
  producedBy: string | null;
}

export async function hearVoiceNotes(
  text: string,
  attachments: CaptureAttachment[],
): Promise<HeardVoiceNotes> {
  // Asked BEFORE the provider is looked up, so the overwhelmingly common case —
  // a message with no audio in it — reads no configuration and does no work.
  const notes = attachments.filter(isVoiceNote);
  if (notes.length === 0) return { text, transcribed: 0, producedBy: null };

  // Nobody has chosen a vendor. An ordinary answer, not a broken one.
  const provider = getTranscriptionProvider();
  if (!provider) return { text, transcribed: 0, producedBy: null };

  const heard: string[] = [];
  let producedBy: string | null = null;

  for (const note of notes) {
    // No bytes means n8n forwarded a link instead of the file. Downloading it
    // here would make this service a URL fetcher pointed at whatever an
    // inbound payload names, which is a different and much worse thing to be.
    if (!note.contentBase64) continue;

    try {
      const transcript = await provider.transcribe({
        audio: Buffer.from(note.contentBase64, 'base64'),
        mimeType: note.mimeType,
        fileName: note.fileName,
      });
      heard.push(transcript.text);
      producedBy ??= transcript.producedBy;
    } catch (error) {
      // Logged, never thrown. See the header: the report survives the vendor.
      console.error(`[transcription] could not read ${note.fileName}:`, error);
    }
  }

  if (heard.length === 0) return { text, transcribed: 0, producedBy: null };

  const spoken = heard.join('\n\n');

  return {
    // A typed caption is the reporter's own words and outranks a machine
    // reading of their voice, so it stays first and the transcript is added
    // under it, attributed. Where there was only a placeholder, the transcript
    // becomes the report — that is the whole point.
    text: isPlaceholder(text)
      ? `${spoken}\n\n(Transcribed from a voice note.)`
      : `${text}\n\nFrom the voice note sent with it: ${spoken}`,
    transcribed: heard.length,
    producedBy,
  };
}
