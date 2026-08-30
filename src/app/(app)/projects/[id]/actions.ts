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
      'qsPricingDueDays',
      'pmScopeReviewDueDays',
      'internalApprovalDueDays',
    ].map((key) => [key, formData.get(key) ?? '']),
  );

  const parsed = contractRuleUpdateSchema.safeParse({
    ...raw,
    eotAssessmentRequired: checkbox(formData, 'eotAssessmentRequired'),
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
