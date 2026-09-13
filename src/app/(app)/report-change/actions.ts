'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import {
  createPotentialChange,
  potentialChangeCreateSchema,
} from '@/services/potential-change.service';
import { uploadDocument } from '@/services/document.service';
import { indexPotentialChange } from '@/services/search.service';
import { hearVoiceNotes } from '@/services/voice-note.service';

export interface ReportState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * The capture path. Everything else in the product depends on this working
 * first time, on a phone, outdoors, from someone who has thirty seconds.
 *
 * The change is saved BEFORE the photo is pushed to storage. If the upload
 * fails the change still exists, with its notice clock running — losing the
 * capture because a network hiccup ate a JPEG would be exactly backwards.
 */
export async function reportChange(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const user = await requirePageUser();

  const parsed = potentialChangeCreateSchema.safeParse({
    projectId: formData.get('projectId'),
    title: formData.get('title'),
    description: formData.get('description'),
    eventDate: formData.get('eventDate') || new Date(),
    location: formData.get('location') || null,
    trade: formData.get('trade') || null,
    workStatus: formData.get('workStatus') || 'not_started',
    estimatedValue: formData.get('estimatedValue') || null,
    potentialTimeImpact: formData.get('potentialTimeImpact') === 'on',
    // Was hardcoded to 'mobile_form', so every capture claimed it came from
    // this form even when the person was relaying a WhatsApp message or writing
    // up a meeting. The channel is now asked for, and the default only applies
    // when the field is genuinely absent.
    sourceType: formData.get('sourceType') || 'mobile_form',
    sourceLocation: formData.get('sourceLocation') || null,
    sourceOccurredAt: formData.get('sourceOccurredAt') || undefined,
    sourceSenderName: formData.get('requestedBy') || null,
    sourceReference: formData.get('drawingNumber') || null,
    urgency: formData.get('urgency') || 'normal',
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: 'Check the highlighted fields', fieldErrors };
  }

  const files = formData.getAll('evidence').filter((f): f is File => f instanceof File && f.size > 0);

  // Read once, used twice: transcription needs the bytes and so does the
  // upload, and asking the browser for them a second time would read a stream
  // that has already been consumed.
  const attached = await Promise.all(
    files.map(async (file) => ({
      file,
      bytes: Buffer.from(await file.arrayBuffer()),
    })),
  );

  // A voice note attached HERE is transcribed, exactly as one sent over
  // WhatsApp would be.
  //
  // This form accepted `audio/*` from the day it was built and then filed the
  // clip as a silent document, because it takes a different path from the
  // capture lanes. Somebody standing in front of the wall records fifteen
  // seconds rather than typing with one glove off, and every word of it was
  // invisible to the register, to the AI reader and to the notice.
  //
  // It is also the only channel where this works today: the form has the
  // bytes, and WhatsApp does not until the download lane is built.
  //
  // The typed description always comes first and is never replaced; the
  // transcript is added under it, attributed. A vendor failure is logged and
  // the description is unchanged.
  const heard = await hearVoiceNotes(
    parsed.data.description,
    attached.map(({ file, bytes }) => ({
      externalId: file.name,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      contentBase64: bytes.toString('base64'),
    })),
  );

  let change;
  try {
    change = await createPotentialChange(user, {
      ...parsed.data,
      description: heard.text,
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  let failedUploads = 0;

  for (const { file, bytes } of attached) {
    try {
      await uploadDocument(user, {
        projectId: parsed.data.projectId,
        potentialChangeId: change.id,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        // The audio itself is filed whether or not it was transcribed. The
        // recording is the record; the transcript is a reading of it.
        content: bytes,
      });
    } catch (error) {
      // The commercial record is already safe, so this never fails the capture.
      // But it is NOT silent: someone who watched a photo upload and got no
      // warning will believe the evidence exists, and find out it does not on
      // the day it matters most.
      failedUploads += 1;
      console.error('[report-change] evidence upload failed', error);
    }
  }

  // Indexing is best effort — duplicate detection is a convenience, and a
  // failure here must never cost the capture.
  await indexPotentialChange(change.id).catch((error) => {
    console.error('[report-change] indexing failed', error);
  });

  revalidatePath('/variations');
  revalidatePath('/dashboard');
  redirect(
    failedUploads > 0
      ? `/variations/${change.id}?evidenceFailed=${failedUploads}`
      : `/variations/${change.id}`,
  );
}
