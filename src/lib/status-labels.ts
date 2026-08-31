/**
 * Human names for the lifecycle, shared by the server and the browser.
 *
 * The interface used to render the enum directly, so a project manager was
 * offered "pm scope review" and "qs pricing" — machine words with the
 * underscores taken out. It reads as an unfinished screen, and it quietly
 * teaches people that the app is talking to itself rather than to them.
 */

export const STATUS_LABELS: Record<string, string> = {
  new_potential_change: 'Newly captured',
  notice_assessment: 'Notice assessment',
  notice_required: 'Waiting to issue the notice',
  needs_evidence: 'Waiting for evidence',
  pm_scope_review: 'Scope review',
  qs_pricing: 'Pricing',
  cm_review: 'Commercial review',
  internal_approval: 'Final approval',
  variation_approved: 'Variation approved',
  included_scope: 'Already in the contract',
  cancelled: 'Cancelled',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

/** Order along the commercial chain, for telling forwards from backwards. */
const ORDER = [
  'new_potential_change',
  'notice_assessment',
  'needs_evidence',
  'notice_required',
  'pm_scope_review',
  'qs_pricing',
  'cm_review',
  'internal_approval',
];

/**
 * Whether moving to `target` sends the change BACKWARDS.
 *
 * Worth knowing because going back is rework — somebody else's finished work
 * being reopened — and it deserves different words, and a reason.
 */
export function isRework(current: string, target: string): boolean {
  const from = ORDER.indexOf(current);
  const to = ORDER.indexOf(target);
  return from !== -1 && to !== -1 && to < from;
}
