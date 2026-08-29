'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
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
  const user = await requireUser();
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
