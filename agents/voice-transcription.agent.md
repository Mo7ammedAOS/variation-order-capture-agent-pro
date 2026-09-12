# Voice Transcription

> **Status:** built, 2026-09-12. `src/integrations/transcription/`.
> It is not an agent in the sense the other files here describe, and the
> sections below say why.

## Agent Name

Voice Transcription

## Purpose

Turn a WhatsApp or site voice note into text, in English or Arabic or both,
without ever replacing the audio.

Why it matters: fifteen seconds of audio recorded next to the wall that just
came down is the fastest report anybody sends, and it used to arrive as the
text `[media only]`. The change had no description, the capture reader had
nothing to read, the notice narrative had no facts, and the register showed a
row nobody could act on without opening the file. The most convenient way to
report was the least useful one to receive.

## Trigger / Called By

`hearVoiceNotes()` in `src/services/voice-note.service.ts`, from two places:

- `captureFromChannel()` — the live lane, before anything reads the message.
  Before the answer matcher, before the project is chosen, before the AI
  reader, because all three work on text.
- `fileTriagedEvent()` — a coordinator filing a parked message by hand. A voice
  note that arrived before a vendor was configured is read when it is filed,
  rather than staying `[media only]` for ever because of when it landed.

SOP: `/workflows/whatsapp-capture.md`.

## Model

ElevenLabs Scribe, through `TranscriptionProvider` in
`src/integrations/transcription/provider.ts`. Set by `TRANSCRIPTION_PROVIDER`
and `ELEVENLABS_STT_MODEL`; never a model string at the call site.

**This is a second vendor, deliberately.** Claude has no speech-to-text, so
transcription could not sit on `AiProvider` — the method was there and its one
real implementation could only throw. It has its own interface, its own key and
its own bill, the same way embeddings do. Scribe was chosen because site voice
notes are half Arabic, half English, frequently both in one sentence, and it
detects the language itself; nobody is going to tag a voice note with a
language before pressing send.

## Inputs

The audio bytes, its MIME type, the file name, and an optional ISO language
hint that is not currently passed.

**Bytes or nothing.** Where a payload carries a URL instead of a file, nothing
is transcribed. Fetching it would make this service a URL fetcher pointed by
whatever an inbound message names.

## Output Schema

Not the agent envelope, and this is the one place in the system where that is
right. A transcript has no `extracted_data` worth structuring, nothing to hold
a `source_reference` to beyond the file it came from, and no
`suggested_next_action` — it is a reading of audio, not a judgement about a
change. The judgement happens downstream, in Capture Extraction, which reads
the transcript exactly as it reads a typed message.

```text
text                  what the machine heard
language              the ISO code the vendor detected, or null
languageConfidence    0..1 that the LANGUAGE was identified correctly
durationSeconds       length of the audio, where reported
producedBy            vendor/model, e.g. elevenlabs/scribe_v2
```

`languageConfidence` is about the language, never about the words. There is no
number anywhere that claims the transcript is accurate, because no such number
would be honest.

## Confidence Handling

None, and none is wanted. A transcript is never held for review and never
surfaced as a suggestion to accept or reject: it is presented as what the
machine heard, attributed, alongside audio anybody can play. Everything that
follows treats it as a description a person can correct.

An **empty** transcript is a failure, not an empty success. Writing `""` onto a
change would say the engineer sent silence, and the audio would stop being
listened to because a transcript already existed.

## What This Agent May Decide

Nothing. It converts a format.

## What This Agent Must Never Decide

Everything in the global list, and one specific to it: it may never be treated
as the record of what was said. The audio is the record.

## Human Approval Gate

None, for the same reason a photograph does not have one. The description it
produces is editable on the change like any other, and the original audio sits
next to it in the evidence.

## Prompt Location

None. Speech to text takes no prompt, so there is nothing to version.

## Evidence Handling

The audio file is stored as evidence by the normal capture path, is never
overwritten, and is never deleted by the app. The transcript is additional
text on the change and says where it came from.

Where the reporter typed a caption as well, **their words come first** and the
transcript is added under them, attributed. A machine reading of somebody's
voice does not outrank what they chose to type. Only where the message had no
words at all does the transcript become the report.

## Failure Behaviour

Logged, never thrown. A vendor being down, a key expiring, or thirty seconds of
wind noise must not cost a site engineer their report: the change is created,
the audio is filed, and the text is unchanged. That is the same rule capture
extraction follows and it exists for the same reason.

Guards before the call, so a failure costs nothing: no key, no bytes, or over
25 MB and the request is never made. The vendor's own ceiling is gigabytes;
ours is far lower because anything that big is not a voice note, and paying to
transcribe an hour of audio somebody attached by accident is a bill nobody
authorised.

A vendor error body is truncated to 300 characters before it reaches a log
line — an error page is occasionally a whole HTML document.

## Audit Events

The transcript arrives as part of the change's description, so it is covered by
the change's own creation audit. `producedBy` names the vendor and model that
produced it.

## Edge Cases

- **Arabic, English, and both in one sentence** — detected, not configured.
- **Several voice notes in one message** — all are read and joined, in order.
  Keeping only the last would lose the first half of an instruction.
- **A voice note with a typed caption** — caption first, see Evidence Handling.
- **A photograph or a PDF** — never sent. Only `audio/*` reaches the vendor.
- **A forwarded voice note** — no different; the sender is resolved by the
  capture path, not here.
- **A message that turns out to contain no change at all** — capture decides
  that, on the transcript, exactly as it would on typed text.

## Definition of Done

Met. 16 tests in `tests/unit/transcription.test.ts` covering the request shape,
the key never appearing in a URL, an empty transcript treated as a failure, the
size and key guards, the truncated error, the selector never substituting the
mock for the real provider, a caption not being overwritten, a vendor outage
costing nothing, photographs not being transcribed, and URLs not being fetched.
