'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { assessNotice, noticeAssessmentSchema } from '@/services/notice.service';
import { changeStatus, statusChangeSchema } from '@/services/potential-change.service';
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
  const user = await requirePageUser();
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

export interface StatusState {
  error?: string;
  ok?: boolean;
}

/**
 * Moving a change to its next stage.
 *
 * Whether a move is legal is the service's decision, not this action's — the
 * form only offers what `allowedNextStatuses` returned when the page rendered,
 * and the service checks again on arrival, because a page can be stale by the
 * time somebody presses the button.
 */
export async function submitStatusChange(
  _prev: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const user = await requirePageUser();
  const potentialChangeId = String(formData.get('potentialChangeId') ?? '');

  const parsed = statusChangeSchema.safeParse({
    status: formData.get('status'),
    note: formData.get('note') || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose a stage to move to' };
  }

  try {
    await changeStatus(user, potentialChangeId, parsed.data.status, parsed.data.note);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath(`/variations/${potentialChangeId}`);
  revalidatePath('/variations');
  revalidatePath('/dashboard');
  return { ok: true };
}
