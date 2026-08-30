'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { assessNotice, noticeAssessmentSchema } from '@/services/notice.service';
import { changeStatus, statusChangeSchema } from '@/services/potential-change.service';
import { isAppError } from '@/lib/errors';
import { approvalDecisionSchema, recordApprovalDecision } from '@/services/approval.service';

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

export interface ApprovalState {
  error?: string;
  ok?: string;
}

/**
 * One seat, one decision, and it cannot be taken back.
 *
 * There is no "undo": an approval is a statement made on a date by a named
 * person, and the file has to be able to show that it was made. A change of
 * mind is a rejection at the next round, recorded as its own event, not an
 * erasure of the first answer.
 */
export async function decideApprovalAction(
  _prev: ApprovalState,
  formData: FormData,
): Promise<ApprovalState> {
  const user = await requirePageUser();

  const parsed = approvalDecisionSchema.safeParse({
    approvalId: formData.get('approvalId'),
    decision: formData.get('decision'),
    comment: formData.get('comment') || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose approve or reject' };
  }

  try {
    const result = await recordApprovalDecision(user, parsed.data);
    revalidatePath(`/variations/${formData.get('potentialChangeId')}`);
    revalidatePath('/my-tasks');
    revalidatePath('/notifications');

    if (result.rejected) {
      return { ok: 'Rejected. The change has gone back a stage with your reason.' };
    }
    if (result.complete) {
      return {
        ok:
          result.gate === 'notice_issue'
            ? 'Both approvals are in. The notice can be issued to the client.'
            : 'Both approvals are in. The variation is approved.',
      };
    }
    return { ok: 'Your approval is recorded. The other seat is still to decide.' };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
