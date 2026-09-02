'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import {
  assignMember,
  memberAssignSchema,
  removeMember,
  setMemberNotify,
} from '@/services/project-member.service';
import { contactSchema, createContact } from '@/services/contact.service';
import { isAppError } from '@/lib/errors';
import { contractRuleUpdateSchema, updateContractRules } from '@/services/project.service';
import type { DocumentType } from '@prisma/client';
import { uploadDocument } from '@/services/document.service';
import { indexDocument } from '@/services/document-index.service';
import { assertProjectAccess } from '@/services/project-access.service';

export interface ContractRulesState {
  error?: string;
  ok?: boolean;
}

/** Checkboxes are absent from FormData when unticked, which is not the same as false. */
function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on' || formData.get(name) === 'true';
}

/**
 * Saving the contract rules.
 *
 * The capability check is in the service, not here — a server action is a public
 * entry point like any route handler, and putting the gate at the edge would
 * leave the API route to repeat it and eventually disagree.
 */
export async function saveContractRules(
  _prev: ContractRulesState,
  formData: FormData,
): Promise<ContractRulesState> {
  const user = await requirePageUser();
  const projectId = String(formData.get('projectId') ?? '');

  const raw = Object.fromEntries(
    [
      'contractType',
      'contractClauseReference',
      'noticePeriodDays',
      'detailedClaimPeriodDays',
      'noticeDeliveryMethod',
      'noticeRecipientName',
      'noticeRecipientEmail',
      'noticeRecipientCompany',
      'noticeTemplateName',
      'variationProposalTemplateName',
      'approvalThresholdPm',
      'approvalThresholdCm',
      'approvalThresholdCommercialDirector',
      'approvalThresholdManagingDirector',
      'highRiskVoValue',
      'clientFollowUpDays',
      'voResponseDays',
      'qsPricingDueDays',
      'pmScopeReviewDueDays',
      'internalApprovalDueDays',
    ].map((key) => [key, formData.get(key) ?? '']),
  );

  const parsed = contractRuleUpdateSchema.safeParse({
    ...raw,
    eotAssessmentRequired: checkbox(formData, 'eotAssessmentRequired'),
    clientFollowUpEnabled: checkbox(formData, 'clientFollowUpEnabled'),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') ?? '';
    return { error: field ? `${field}: ${issue?.message}` : (issue?.message ?? 'Check the values') };
  }

  try {
    await updateContractRules(user, projectId, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/* ───────────────────────────── team ─────────────────────────────────────── */

export interface MemberFormState {
  error?: string;
  ok?: string;
}

export async function assignMemberAction(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const user = await requirePageUser();

  const parsed = memberAssignSchema.safeParse({
    projectId: formData.get('projectId'),
    userId: formData.get('userId'),
    projectRole: formData.get('projectRole'),
    notifyOnChange: formData.get('notifyOnChange') === 'on',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details' };
  }

  try {
    await assignMember(user, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: 'Added to the project' };
}

/** Notification is toggled on its own, never as a side effect of a role change. */
export async function toggleMemberNotifyAction(formData: FormData) {
  const user = await requirePageUser();
  const memberId = String(formData.get('memberId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  const notify = formData.get('notify') === 'true';

  await setMemberNotify(user, memberId, notify);
  revalidatePath(`/projects/${projectId}`);
}

export async function removeMemberAction(formData: FormData) {
  const user = await requirePageUser();
  const memberId = String(formData.get('memberId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');

  await removeMember(user, memberId);
  revalidatePath(`/projects/${projectId}`);
}

/* ──────────────────────────── contacts ──────────────────────────────────── */

export interface ContactFormState {
  error?: string;
  ok?: string;
}

export async function createContactAction(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const user = await requirePageUser();

  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  const parsed = contactSchema.safeParse({
    projectId: formData.get('projectId'),
    fullName: formData.get('fullName'),
    companyName: text('companyName'),
    jobTitle: text('jobTitle'),
    email: text('email'),
    phone: text('phone'),
    contactType: text('contactType') ?? 'other',
    // Authority is what makes an instruction binding, so each flag is explicit
    // rather than inferred from the contact type. A client representative who
    // cannot approve cost is common, and guessing would be worse than asking.
    authorityVerified: formData.get('authorityVerified') === 'on',
    canRequestChange: formData.get('canRequestChange') === 'on',
    canIssueTechnicalInstruction: formData.get('canIssueTechnicalInstruction') === 'on',
    canInstructWork: formData.get('canInstructWork') === 'on',
    canApproveCost: formData.get('canApproveCost') === 'on',
    canApproveTime: formData.get('canApproveTime') === 'on',
    canSignFinalVo: formData.get('canSignFinalVo') === 'on',
    notes: text('notes'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details' };
  }

  try {
    await createContact(user, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: `${parsed.data.fullName} added` };
}

export interface LibraryFormState {
  error?: string;
  ok?: string;
}

/**
 * Uploads a commercial document and makes it searchable by meaning.
 *
 * Gated on `document.manageRegister`, not the looser `document.upload` that
 * covers site photos. These are the documents the system will REASON from — a
 * wrong BOQ in here does not just sit in a list, it starts telling people their
 * change is already in scope.
 *
 * Indexing runs after the upload and is allowed to fail on its own. A scanned
 * contract with no text layer is still a document worth keeping and serving; it
 * is simply not searchable, and the panel says so instead of implying it was
 * read.
 */
export async function uploadLibraryDocumentAction(
  _prev: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const user = await requirePageUser();
  const projectId = String(formData.get('projectId') ?? '');
  const documentType = String(formData.get('documentType') ?? 'contract') as DocumentType;
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file' };

  try {
    await assertProjectAccess(user, projectId, 'document.manageRegister');

    const document = await uploadDocument(user, {
      projectId,
      documentType,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      content: Buffer.from(await file.arrayBuffer()),
    });

    const result = await indexDocument(document.id).catch((error) => ({
      chunks: 0,
      skipped: error instanceof Error ? error.message : 'Could not read the file',
    }));

    revalidatePath(`/projects/${projectId}`);

    return {
      ok:
        result.chunks > 0
          ? `${file.name} uploaded and indexed — ${result.chunks} searchable sections.`
          : `${file.name} uploaded, but NOT searchable: ${result.skipped ?? 'no readable text'}.`,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

/** Re-reads a document that was uploaded before indexing existed, or failed. */
export async function reindexDocumentAction(formData: FormData): Promise<void> {
  const user = await requirePageUser();
  const projectId = String(formData.get('projectId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');

  await assertProjectAccess(user, projectId, 'document.manageRegister');
  await indexDocument(documentId);
  revalidatePath(`/projects/${projectId}`);
}
