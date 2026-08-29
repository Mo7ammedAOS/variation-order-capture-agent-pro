'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { assessNotice, noticeAssessmentSchema } from '@/services/notice.service';
import { isAppError } from '@/lib/errors';

export interface AssessmentState {
  error?: string;
  ok?: boolean;
}

/**
 * The entitlement decision. A human presses this — never a model, never a job.
 * "Needs more information" is a first-class outcome rather than a way of not
 * answering: it parks the change with a stated blocker and an owner.
 */
export async function submitNoticeAssessment(
  _prev: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  const user = await requireUser();
  const potentialChangeId = String(formData.get('potentialChangeId') ?? '');

  const parsed = noticeAssessmentSchema.safeParse({
    outcome: formData.get('outcome'),
    notes: formData.get('notes') || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose an outcome' };
  }

  try {
    await assessNotice(user, potentialChangeId, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath(`/variations/${potentialChangeId}`);
  revalidatePath('/variations');
  revalidatePath('/dashboard');
  return { ok: true };
}
