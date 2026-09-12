import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Hearing a voice note.
 *
 * What is worth testing is not whether ElevenLabs can transcribe Arabic — it
 * can. It is everything around the call: that a vendor failure never costs a
 * site engineer their report, that an empty answer is a failure rather than an
 * empty success, that a typed caption is not overwritten by a machine reading
 * of somebody's voice, and that nothing pays to transcribe a photograph.
 */

const env = {
  TRANSCRIPTION_PROVIDER: 'elevenlabs' as 'none' | 'mock' | 'elevenlabs',
  ELEVENLABS_API_KEY: 'test-key-not-real',
  ELEVENLABS_STT_MODEL: 'scribe_v2',
};

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ getEnv: () => env }));

const { elevenLabsTranscriptionProvider, MAX_AUDIO_BYTES } = await import(
  '@/integrations/transcription/elevenlabs'
);
const { getTranscriptionProvider } = await import('@/integrations/transcription');
const { hearVoiceNotes } = await import('@/services/voice-note.service');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const SCRIBE = {
  text: 'They took the reception wall down this morning, nobody told us.',
  language_code: 'en',
  language_probability: 0.98,
  audio_duration_secs: 12.4,
};

const audio = (bytes = 64) => ({
  externalId: 'note-1',
  fileName: 'voice-note.ogg',
  mimeType: 'audio/ogg; codecs=opus',
  contentBase64: Buffer.alloc(bytes, 7).toString('base64'),
});

beforeEach(() => {
  fetchMock.mockReset();
  env.TRANSCRIPTION_PROVIDER = 'elevenlabs';
  env.ELEVENLABS_API_KEY = 'test-key-not-real';
});

describe('the ElevenLabs adapter', () => {
  it('sends the audio as multipart with the key in the header, not the body', async () => {
    fetchMock.mockResolvedValue(ok(SCRIBE));

    await elevenLabsTranscriptionProvider.transcribe({
      audio: Buffer.from('fake-audio'),
      mimeType: 'audio/ogg',
      fileName: 'note.ogg',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.method).toBe('POST');
    // A key in a query string ends up in somebody's access log.
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('test-key-not-real');
    expect(url).not.toContain('test-key-not-real');

    const form = init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('turns off audio-event tagging, which is on by default', async () => {
    fetchMock.mockResolvedValue(ok(SCRIBE));
    await elevenLabsTranscriptionProvider.transcribe({
      audio: Buffer.from('fake-audio'),
      mimeType: 'audio/ogg',
    });
    // Scribe writes non-speech tags INTO the text. A voice note recorded next
    // to a core drill would otherwise reach a notice with "[drilling]" in it.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('tag_audio_events')).toBe('false');
  });

  it('does not tell the vendor what language to expect unless asked to', async () => {
    fetchMock.mockResolvedValue(ok(SCRIBE));
    await elevenLabsTranscriptionProvider.transcribe({
      audio: Buffer.from('fake-audio'),
      mimeType: 'audio/ogg',
    });
    // Site voice notes are half Arabic, half English, often both in a
    // sentence. Detection beats a guess we would have to make per project.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('language_code')).toBeNull();
  });

  it('returns the words, the language and who produced them', async () => {
    fetchMock.mockResolvedValue(ok(SCRIBE));
    const result = await elevenLabsTranscriptionProvider.transcribe({
      audio: Buffer.from('fake-audio'),
      mimeType: 'audio/ogg',
    });
    expect(result.text).toBe(SCRIBE.text);
    expect(result.language).toBe('en');
    expect(result.durationSeconds).toBe(12.4);
    // The audit trail has to be able to say which machine heard it.
    expect(result.producedBy).toBe('elevenlabs/scribe_v2');
  });

  it('treats an empty transcript as a failure, not an empty success', async () => {
    // Writing "" onto a change would say the engineer sent silence, and the
    // audio would stop being listened to because a transcript already existed.
    fetchMock.mockResolvedValue(ok({ ...SCRIBE, text: '   ' }));
    await expect(
      elevenLabsTranscriptionProvider.transcribe({
        audio: Buffer.from('fake-audio'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow(/no words/i);
  });

  it('refuses audio that is not a voice note', async () => {
    await expect(
      elevenLabsTranscriptionProvider.transcribe({
        audio: Buffer.alloc(MAX_AUDIO_BYTES + 1),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow(/transcription limit/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call the vendor with no key', async () => {
    env.ELEVENLABS_API_KEY = '';
    await expect(
      elevenLabsTranscriptionProvider.transcribe({
        audio: Buffer.from('fake-audio'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow(/ELEVENLABS_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not leak a vendor error page into the log line', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'x'.repeat(5000),
    } as unknown as Response);
    await expect(
      elevenLabsTranscriptionProvider.transcribe({
        audio: Buffer.from('fake-audio'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow(/^ElevenLabs refused the voice note \(401\): x{300}$/);
  });
});

describe('choosing a transcriber', () => {
  it('returns nothing when nobody has chosen a vendor', () => {
    env.TRANSCRIPTION_PROVIDER = 'none';
    // A working configuration, not a broken one. The audio is still captured.
    expect(getTranscriptionProvider()).toBeNull();
  });

  it('never silently substitutes the mock for the real one', () => {
    env.TRANSCRIPTION_PROVIDER = 'none';
    expect(getTranscriptionProvider()?.name).not.toBe('mock');
    env.TRANSCRIPTION_PROVIDER = 'mock';
    expect(getTranscriptionProvider()?.name).toBe('mock');
  });
});

describe('a captured voice note', () => {
  it('becomes the report when the message had no words in it', async () => {
    fetchMock.mockResolvedValue(ok(SCRIBE));
    const heard = await hearVoiceNotes('[media only]', [audio()]);
    expect(heard.text).toContain(SCRIBE.text);
    expect(heard.text).toContain('Transcribed from a voice note');
    expect(heard.transcribed).toBe(1);
  });

  it('never overwrites what the reporter actually typed', async () => {
    fetchMock.mockResolvedValue(ok(SCRIBE));
    const heard = await hearVoiceNotes('Reception wall, see photo', [audio()]);
    // Their own words outrank a machine reading of their voice.
    expect(heard.text.startsWith('Reception wall, see photo')).toBe(true);
    expect(heard.text).toContain('From the voice note sent with it:');
  });

  it('costs a site engineer nothing when the vendor is down', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const heard = await hearVoiceNotes('[media only]', [audio()]);
    // The change is still created, with the audio filed and a person to play it.
    expect(heard.text).toBe('[media only]');
    expect(heard.transcribed).toBe(0);
    // Logged, so a week of silent failures is visible.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not pay to transcribe a photograph', async () => {
    const heard = await hearVoiceNotes('[media only]', [
      { externalId: 'p1', fileName: 'wall.jpg', mimeType: 'image/jpeg', contentBase64: 'AAAA' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(heard.transcribed).toBe(0);
  });

  it('does not go and fetch a URL somebody put in an inbound payload', async () => {
    // Bytes or nothing. Downloading whatever an external payload names would
    // make this a URL fetcher pointed by strangers.
    const heard = await hearVoiceNotes('[media only]', [
      { externalId: 'n1', fileName: 'note.ogg', mimeType: 'audio/ogg', url: 'https://example.com/a.ogg' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(heard.transcribed).toBe(0);
  });

  it('does nothing at all when no vendor is configured', async () => {
    env.TRANSCRIPTION_PROVIDER = 'none';
    const heard = await hearVoiceNotes('[media only]', [audio()]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(heard.text).toBe('[media only]');
  });

  it('joins two voice notes rather than keeping only the last', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ ...SCRIBE, text: 'First half of the instruction.' }))
      .mockResolvedValueOnce(ok({ ...SCRIBE, text: 'Second half of the instruction.' }));
    const heard = await hearVoiceNotes('[media only]', [
      { ...audio(), externalId: 'a' },
      { ...audio(), externalId: 'b' },
    ]);
    expect(heard.text).toContain('First half');
    expect(heard.text).toContain('Second half');
    expect(heard.transcribed).toBe(2);
  });
});
