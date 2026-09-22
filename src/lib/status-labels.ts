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

/**
 * The seven words anybody outside this file uses.
 *
 * Eleven internal statuses exist because the engine needs to tell
 * `needs_evidence` from `notice_assessment` to know whose list a change sits
 * on. A person reading the register does not: both mean the project manager
 * has it. Showing them eleven states, two of which are retired and one of
 * which nothing enters, teaches them the app is talking to itself.
 *
 * So the internal statuses stay exactly as they are and this maps them down.
 * Nothing branches on the label — `statusLabel` is still what the rework
 * dropdown uses, where the precise stage is the whole point.
 */
export const CUSTOMER_STATUS: Record<string, string> = {
  new_potential_change: 'New change',

  // Everything the project manager holds. The distinction between "not yet
  // assessed" and "waiting for something we asked for" matters to the chase
  // and to nobody else.
  notice_assessment: 'PM review',
  needs_evidence: 'PM review',
  pm_scope_review: 'PM review',
  notice_required: 'PM review',

  qs_pricing: 'QS pricing',

  cm_review: 'PM approval',
  internal_approval: 'PM approval',

  variation_approved: 'Sent to client',

  included_scope: 'Closed',
  cancelled: 'Closed',
};

/**
 * `variation_approved` means two different things to a client-facing reader
 * depending on whether the variation has been put to them yet and whether they
 * have answered, and the database keeps that on the VO rather than the change.
 */
export function customerStatus(
  status: string,
  vo?: { submitted?: boolean; answered?: boolean } | null,
): string {
  if (status === 'variation_approved') {
    if (vo?.answered) return 'Closed';
    if (vo?.submitted) return 'Client decision';
    return 'Sent to client';
  }
  return CUSTOMER_STATUS[status] ?? statusLabel(status);
}

/**
 * The register's status filter, in the same seven words.
 *
 * A filter that offered eleven internal statuses asked the reader to know
 * which of four means "the PM has it" — and two of the eleven are retired, so
 * picking them returns an empty register that looks like a bug. Each entry
 * here expands to the statuses it covers.
 */
export const STAGE_FILTERS: { value: string; label: string; statuses: string[] }[] = [
  { value: 'new', label: 'New change', statuses: ['new_potential_change'] },
  {
    value: 'pm_review',
    label: 'PM review',
    statuses: ['notice_assessment', 'needs_evidence', 'pm_scope_review', 'notice_required'],
  },
  { value: 'qs_pricing', label: 'QS pricing', statuses: ['qs_pricing'] },
  { value: 'pm_approval', label: 'PM approval', statuses: ['cm_review', 'internal_approval'] },
  { value: 'with_client', label: 'With the client', statuses: ['variation_approved'] },
  { value: 'closed', label: 'Closed', statuses: ['included_scope', 'cancelled'] },
];

/**
 * Expands a filter value to the statuses it covers.
 *
 * Accepts a raw internal status too, so links people already saved, and the
 * dashboard tiles that deep-link to one precise stage, go on working.
 */
export function statusesForFilter(value: string): string[] {
  const stage = STAGE_FILTERS.find((entry) => entry.value === value);
  return stage ? stage.statuses : [value];
}
