'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { assessNotice, noticeAssessmentSchema } from '@/services/notice.service';
import {
  cancelPotentialChange,
  cancelSchema,
  changeStatus,
  potentialChangeUpdateSchema,
  reinstatePotentialChange,
  reopenPotentialChange,
  reopenSchema,
  statusChangeSchema,
  updatePotentialChange,
} from '@/services/potential-change.service';
import type { DocumentType } from '@prisma/client';
import { uploadDocument } from '@/services/document.service';

/**
 * What a file attached to a change is allowed to be.
 *
 * Contract, BOQ and specification are absent on purpose: those are the library
 * the system reasons FROM, they are the administrator's job, and they belong to
 * the project rather than to one change. Letting a site engineer attach a BOQ
 * here would put an unreviewed price list into the register.
 */
export const EVIDENCE_TYPES: DocumentType[] = [
  'drawing', 'rfi', 'instruction', 'correspondence', 'quotation',
  'site_photo', 'voice_note', 'other',
];
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

export interface EditState {
  error?: string;
  ok?: string;
}

/**
 * The reporter correcting their own account.
 *
 * Only the fields a person who was standing there would fix. Money and
 * programme are not here: those belong to whoever prices it, and letting the
 * reporter set them would put a number on the file that nobody with the
 * authority to stand behind it has seen.
 */
export async function updateChangeAction(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');

  const parsed = potentialChangeUpdateSchema.safeParse({
    title: formData.get('title') || undefined,
    description: formData.get('description') || undefined,
    location: formData.get('location') || undefined,
    trade: formData.get('trade') || undefined,
    eventDate: formData.get('eventDate') || undefined,
    workStatus: formData.get('workStatus') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again' };
  }

  try {
    await updatePotentialChange(user, id, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath(`/variations/${id}`);
  return { ok: 'Saved. The change history records what you altered.' };
}

/**
 * Sending it back for rework. Withdraws pending approvals, which is why it
 * insists on a reason and says plainly what it withdrew.
 */
export async function reopenChangeAction(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');

  const parsed = reopenSchema.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give a reason' };
  }

  try {
    const { approvalsWithdrawn } = await reopenPotentialChange(user, id, parsed.data);
    revalidatePath(`/variations/${id}`);
    revalidatePath('/my-tasks');
    return {
      ok:
        approvalsWithdrawn > 0
          ? `Reopened. ${approvalsWithdrawn} pending approval${approvalsWithdrawn === 1 ? ' was' : 's were'} withdrawn and nobody is being chased for them.`
          : 'Reopened and back with you for rework.',
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

/**
 * More evidence, added later.
 *
 * Never gated on the change's stage, and never treated as an edit. A
 * photograph that turns up a week later does not contradict anything anybody
 * approved — it only makes the file stronger, and refusing it would push
 * people into raising a duplicate change to carry one picture.
 */
export async function addEvidenceAction(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');

  const files = formData
    .getAll('evidence')
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) return { error: 'Choose at least one photograph or file' };

  // What the person says the files are. An image is still filed as a site photo
  // whatever the box says, because a phone photo on site is not an RFI and
  // labelling it one helps nobody.
  const declared = String(formData.get('documentType') ?? '');
  const documentType = EVIDENCE_TYPES.includes(declared as DocumentType)
    ? (declared as DocumentType)
    : undefined;

  let failed = 0;
  for (const file of files) {
    try {
      const isImage = (file.type || '').startsWith('image/');
      await uploadDocument(user, {
        projectId,
        potentialChangeId: id,
        documentType: isImage ? 'site_photo' : documentType,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: Buffer.from(await file.arrayBuffer()),
      });
    } catch (error) {
      failed++;
      console.error('[variations] evidence upload failed', error);
    }
  }

  revalidatePath(`/variations/${id}`);

  if (failed === files.length) {
    return { error: 'Nothing uploaded. Check your signal and try again.' };
  }
  // Said out loud rather than swallowed: someone who watched an upload and got
  // no warning would believe the evidence is there.
  if (failed > 0) {
    return { ok: `${files.length - failed} added, ${failed} failed. Try the rest again.` };
  }
  return { ok: `${files.length} added.` };
}

/**
 * Ending a claim, and bringing one back.
 *
 * Both demand a reason of real length, because the question they answer is
 * asked much later and by somebody who was not there.
 */
export async function cancelChangeAction(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');
  const reinstating = formData.get('mode') === 'reinstate';

  const parsed = cancelSchema.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give a reason' };
  }

  try {
    if (reinstating) {
      await reinstatePotentialChange(user, id, parsed.data);
      revalidatePath(`/variations/${id}`);
      return { ok: 'Reinstated and back at assessment, with its original capture date intact.' };
    }

    const { approvalsWithdrawn } = await cancelPotentialChange(user, id, parsed.data);
    revalidatePath(`/variations/${id}`);
    revalidatePath('/my-tasks');
    revalidatePath('/variations');
    return {
      ok:
        approvalsWithdrawn > 0
          ? `Cancelled. Open tasks closed and ${approvalsWithdrawn} pending approval${approvalsWithdrawn === 1 ? '' : 's'} withdrawn. The record stays.`
          : 'Cancelled. Open tasks closed, and the record stays on the file.',
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
