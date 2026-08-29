'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import {
  createPotentialChange,
  potentialChangeCreateSchema,
} from '@/services/potential-change.service';
import { uploadDocument } from '@/services/document.service';
import { indexPotentialChange } from '@/services/search.service';

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
  const user = await requireUser();

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
    sourceType: 'mobile_form',
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

  let change;
  try {
    change = await createPotentialChange(user, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  const files = formData.getAll('evidence').filter((f): f is File => f instanceof File && f.size > 0);

  for (const file of files) {
    try {
      await uploadDocument(user, {
        projectId: parsed.data.projectId,
        potentialChangeId: change.id,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: Buffer.from(await file.arrayBuffer()),
      });
    } catch (error) {
      // Logged, not surfaced as a failure. The commercial record is already
      // safe; a missing photo is a follow-up, not a lost change.
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
  redirect(`/variations/${change.id}`);
}
