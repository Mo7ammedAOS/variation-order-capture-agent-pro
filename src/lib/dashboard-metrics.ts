/**
 * What the dashboard counts, and what it calls each thing.
 *
 * ── Why this file is pure ─────────────────────────────────────────────────
 * Every definition here is a function of plain data. The service queries the
 * database and hands rows to these; nothing in this file touches Prisma. That
 * is what lets `npm test` — which has no database — prove the definitions,
 * and it is why "pending change value" cannot quietly mean one thing on the
 * dashboard and another on a report: there is one function and both call it.
 *
 * ── The rule that produced the rewrite ────────────────────────────────────
 * The old dashboard showed twenty-six equal cards. Twenty-six numbers of the
 * same size is not a summary, it is a haystack: the reader has to decide which
 * ones matter, which is the job the screen was supposed to do for them. So
 * four figures are promoted, everything else becomes a row in one queue with a
 * named next action and an owner, and the rest moves to Commercial Reports.
 */

/** Out of the workflow. Neither pending, nor blocked, nor anybody's action. */
export const CLOSED_STATUSES = ['included_scope', 'cancelled'] as const;

/** The PM holds it. */
export const PM_REVIEW_STATUSES = [
  'notice_assessment',
  'needs_evidence',
  'pm_scope_review',
  'notice_required',
] as const;

/** The final internal gate. `cm_review` is retired but historical rows sit there. */
export const PM_APPROVAL_STATUSES = ['cm_review', 'internal_approval'] as const;

export type Priority = 'red' | 'amber' | 'green';

/* ────────────────────────────── the four figures ─────────────────────────── */

/**
 * The value of one change, in the best number anybody has for it.
 *
 * The QS's submitted figure beats the reporter's estimate the moment it
 * exists. Falling back to the estimate matters more than it sounds: a change
 * captured this morning has no price and would otherwise count as zero, which
 * is how a dashboard tells a director there is nothing at stake on the day
 * something is.
 */
export function changeValue(row: {
  submittedValue?: number | null;
  estimatedValue?: number | null;
}): number {
  if (row.submittedValue != null && row.submittedValue > 0) return row.submittedValue;
  return row.estimatedValue ?? 0;
}

/**
 * Pending change value: not yet agreed by the client.
 *
 * Excluded: closed, cancelled, already in the contract, and anything the
 * client has actually answered — approved OR rejected. A rejected variation is
 * not pending; counting it would inflate the one figure on this screen that a
 * director may repeat out loud.
 */
export function isPendingChange(row: {
  currentStatus: string;
  clientResponse?: string | null;
}): boolean {
  if ((CLOSED_STATUSES as readonly string[]).includes(row.currentStatus)) return false;
  if (row.clientResponse && row.clientResponse !== 'awaiting') return false;
  return true;
}

/**
 * Work started without approval.
 *
 * Work is under way or finished on the ground and the change has not reached
 * `variation_approved`. If the client says no, it was built for nothing.
 *
 * `included_scope` is excluded because that is the QS finding the work was
 * already in the contract — a correct outcome, not exposure. This matches the
 * definition already used by `getOverview`; it is lifted here so the card, the
 * action row and the project table cannot drift apart.
 */
export function isWorkStartedUnapproved(row: {
  workStatus: string;
  currentStatus: string;
}): boolean {
  if (!['in_progress', 'completed'].includes(row.workStatus)) return false;
  return !['variation_approved', 'included_scope', 'cancelled'].includes(row.currentStatus);
}

/**
 * Overdue client decision: submitted, past the project's own response window,
 * and no answer recorded.
 *
 * The window is `voResponseDays` from the project's contract rules — never a
 * constant. Two projects on different contracts give the client different
 * amounts of time, and a dashboard that assumes one of them is wrong on the
 * other.
 */
export function isClientDecisionOverdue(
  row: {
    status: string;
    clientResponse: string;
    submittedAt: Date | string | null;
  },
  responseDays: number,
  today: Date,
): boolean {
  if (row.status !== 'submitted') return false;
  if (row.clientResponse !== 'awaiting') return false;
  if (!row.submittedAt) return false;
  return daysBetween(row.submittedAt, today) >= responseDays;
}

/* ──────────────────────────────── the queue ──────────────────────────────── */

export type ActionType =
  | 'notice_decision'
  | 'notice_draft_not_sent'
  | 'notice_pending_delivery'
  | 'notice_delivery_failed'
  | 'notice_awaiting_acknowledgement'
  | 'notice_due_soon'
  | 'notice_overdue'
  | 'qs_pricing_overdue'
  | 'pm_approval_overdue'
  | 'client_response_overdue'
  | 'missing_evidence'
  | 'clarification_required'
  | 'work_started_unapproved'
  | 'blocked';

/** What the row IS. Shown in its own column so the queue can be scanned by kind. */
export const ACTION_LABELS: Record<ActionType, string> = {
  notice_decision: 'Notice decision required',
  notice_draft_not_sent: 'Notice drafted, not sent',
  notice_pending_delivery: 'Notice pending delivery',
  notice_delivery_failed: 'Notice delivery failed',
  notice_awaiting_acknowledgement: 'Notice awaiting acknowledgement',
  notice_due_soon: 'Notice deadline approaching',
  notice_overdue: 'Notice overdue',
  qs_pricing_overdue: 'QS pricing overdue',
  pm_approval_overdue: 'PM approval overdue',
  client_response_overdue: 'Client response overdue',
  missing_evidence: 'Missing evidence',
  clarification_required: 'Clarification required',
  work_started_unapproved: 'Work started without approval',
  blocked: 'Blocked change',
};

/**
 * What to DO. The most important column on the screen, and the reason the old
 * dashboard failed: it told a PM there were four notices overdue and left him
 * to work out which one and what about it.
 *
 * Every string is an instruction to a person, in the words used on site.
 */
export const ACTION_NEXT: Record<ActionType, string> = {
  notice_decision: 'Decide if a notice is needed',
  notice_draft_not_sent: 'Read the notice and send it',
  notice_pending_delivery: 'Confirm it reached the client',
  notice_delivery_failed: 'Retry delivery',
  notice_awaiting_acknowledgement: 'Chase the acknowledgement',
  notice_due_soon: 'Send the notice before the deadline',
  notice_overdue: 'Send the notice now',
  qs_pricing_overdue: 'Submit pricing',
  pm_approval_overdue: 'Approve final VO',
  client_response_overdue: 'Chase the client',
  missing_evidence: 'Add the missing evidence',
  clarification_required: 'Answer the PM',
  work_started_unapproved: 'Approve it or stop the work',
  blocked: 'Unblock it',
};

/** Whose move it is. Not a job title — the seat that owns the next action. */
export const ACTION_OWNER_ROLE: Record<ActionType, string> = {
  notice_decision: 'PM',
  notice_draft_not_sent: 'PM',
  notice_pending_delivery: 'PM',
  notice_delivery_failed: 'PM',
  notice_awaiting_acknowledgement: 'PM',
  notice_due_soon: 'PM',
  notice_overdue: 'PM',
  qs_pricing_overdue: 'QS',
  pm_approval_overdue: 'PM',
  client_response_overdue: 'Client',
  missing_evidence: 'Site',
  clarification_required: 'Site',
  work_started_unapproved: 'PM',
  blocked: 'Owner',
};

export interface ActionRow {
  /** Unique per row, because one change can raise several actions at once. */
  key: string;
  type: ActionType;
  priority: Priority;
  changeId: string;
  reference: string;
  description: string;
  projectId: string;
  projectName: string;
  ownerName: string;
  ownerUserId: string | null;
  ownerRole: string;
  nextAction: string;
  value: number;
  /** The contractual date this row is measured against, when there is one. */
  dueDate: string | null;
  /** Days overdue when positive, days remaining when negative, null when neither. */
  overdueDays: number | null;
  /** How long it has been sitting, whether or not it has a deadline. */
  ageDays: number;
  status: string;
  href: string;
}

export type QueueFilter =
  | 'all'
  | 'mine'
  | 'notices'
  | 'qs_pricing'
  | 'pm_approval'
  | 'client'
  | 'red';

export const QUEUE_FILTERS: { value: QueueFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'notices', label: 'Notices' },
  { value: 'qs_pricing', label: 'QS pricing' },
  { value: 'pm_approval', label: 'PM approval' },
  { value: 'client', label: 'Client' },
  { value: 'red', label: 'Red only' },
];

const NOTICE_TYPES: ActionType[] = [
  'notice_decision',
  'notice_draft_not_sent',
  'notice_pending_delivery',
  'notice_delivery_failed',
  'notice_awaiting_acknowledgement',
  'notice_due_soon',
  'notice_overdue',
];

export function filterActions(
  rows: ActionRow[],
  filter: QueueFilter,
  userId: string,
): ActionRow[] {
  switch (filter) {
    case 'mine':
      return rows.filter((row) => row.ownerUserId === userId);
    case 'notices':
      return rows.filter((row) => NOTICE_TYPES.includes(row.type));
    case 'qs_pricing':
      return rows.filter((row) => row.type === 'qs_pricing_overdue');
    case 'pm_approval':
      return rows.filter((row) => row.type === 'pm_approval_overdue');
    case 'client':
      return rows.filter(
        (row) =>
          row.type === 'client_response_overdue' ||
          row.type === 'notice_awaiting_acknowledgement',
      );
    case 'red':
      return rows.filter((row) => row.priority === 'red');
    default:
      return rows;
  }
}

export type QueueSort = 'priority' | 'oldest' | 'value' | 'deadline';

export const QUEUE_SORTS: { value: QueueSort; label: string }[] = [
  { value: 'priority', label: 'Highest priority' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'value', label: 'Highest value' },
  { value: 'deadline', label: 'Nearest deadline' },
];

const PRIORITY_RANK: Record<Priority, number> = { red: 0, amber: 1, green: 2 };

export function sortActions(rows: ActionRow[], sort: QueueSort): ActionRow[] {
  const copy = [...rows];
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => b.ageDays - a.ageDays);
    case 'value':
      return copy.sort((a, b) => b.value - a.value);
    case 'deadline':
      // A row with no deadline sorts last rather than first. Treated as zero it
      // would head the list, and "nearest deadline" would open on the rows that
      // have none at all.
      return copy.sort((a, b) => rank(a) - rank(b));
    default:
      return copy.sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          (b.overdueDays ?? -Infinity) - (a.overdueDays ?? -Infinity) ||
          b.value - a.value,
      );
  }

  function rank(row: ActionRow): number {
    if (row.dueDate === null) return Number.MAX_SAFE_INTEGER;
    return new Date(row.dueDate).getTime();
  }
}

/**
 * Red is a breached date or a failure. Amber is a date close enough to act on.
 * Green is everything else in the queue — still an action, just not yet late.
 *
 * Nothing is red because it is large. Value decides the order within a
 * priority, never the priority itself: a big variation with three weeks left
 * is not more urgent than a small one whose notice period expires tomorrow.
 */
export function priorityFor(input: {
  overdueDays: number | null;
  amberWithinDays?: number;
}): Priority {
  const { overdueDays } = input;
  if (overdueDays === null) return 'green';
  if (overdueDays >= 0) return 'red';
  return -overdueDays <= (input.amberWithinDays ?? 3) ? 'amber' : 'green';
}

/* ─────────────────────────────── the pipeline ────────────────────────────── */

/** The six words a client-facing reader uses. `Closed` is not a queue. */
export const PIPELINE_STAGES = [
  { key: 'new', label: 'New change', statuses: ['new_potential_change'] },
  { key: 'pm_review', label: 'PM review', statuses: [...PM_REVIEW_STATUSES] },
  { key: 'qs_pricing', label: 'QS pricing', statuses: ['qs_pricing'] },
  { key: 'pm_approval', label: 'PM approval', statuses: [...PM_APPROVAL_STATUSES] },
  { key: 'sent', label: 'Sent to client', statuses: ['variation_approved'] },
  { key: 'client_decision', label: 'Client decision', statuses: ['variation_approved'] },
] as const;

export interface PipelineStage {
  key: string;
  label: string;
  count: number;
  value: number;
  /** Age of the one that has waited longest, in days. */
  oldestDays: number;
  href: string;
}

/**
 * `variation_approved` splits in two on the client's side of the line.
 *
 * The status alone cannot tell "approved internally, not yet put to them" from
 * "put to them, waiting". The database keeps that on the variation order, so
 * the split is read from there — exactly as `customerStatus` already does on
 * the register, so the two screens agree.
 */
export function pipelineStageFor(row: {
  currentStatus: string;
  vo?: { submitted: boolean; answered: boolean } | null;
}): string | null {
  if ((CLOSED_STATUSES as readonly string[]).includes(row.currentStatus)) return null;
  if (row.currentStatus === 'variation_approved') {
    if (row.vo?.answered) return null;
    return row.vo?.submitted ? 'client_decision' : 'sent';
  }
  const stage = PIPELINE_STAGES.find(
    (entry) => entry.key !== 'client_decision' && (entry.statuses as readonly string[]).includes(row.currentStatus),
  );
  return stage?.key ?? null;
}

export function buildPipeline(
  rows: {
    currentStatus: string;
    value: number;
    ageDays: number;
    vo?: { submitted: boolean; answered: boolean } | null;
  }[],
): PipelineStage[] {
  return PIPELINE_STAGES.map((stage) => {
    const inStage = rows.filter((row) => pipelineStageFor(row) === stage.key);
    return {
      key: stage.key,
      label: stage.label,
      count: inStage.length,
      value: inStage.reduce((sum, row) => sum + row.value, 0),
      oldestDays: inStage.reduce((max, row) => Math.max(max, row.ageDays), 0),
      href: `/variations?status=${stage.key === 'sent' || stage.key === 'client_decision' ? 'with_client' : stage.key}`,
    };
  });
}

/* ───────────────────────── project commercial position ───────────────────── */

export interface ProjectPosition {
  projectId: string;
  projectName: string;
  projectCode: string;
  pendingValue: number;
  approvedNotInvoiced: number;
  workStartedUnapproved: number;
  openChanges: number;
  overdueActions: number;
}

/**
 * Exposure first, money second, workload third.
 *
 * Sorted by what is being built without agreement, because that is the only
 * figure on the row that can still be prevented. Pending value is already
 * spent effort; unapproved work is effort still being spent.
 */
export function rankProjects(rows: ProjectPosition[]): ProjectPosition[] {
  return [...rows].sort(
    (a, b) =>
      b.workStartedUnapproved - a.workStartedUnapproved ||
      b.pendingValue - a.pendingValue ||
      b.overdueActions - a.overdueActions,
  );
}

/* ───────────────────────────────── helpers ───────────────────────────────── */

/** Whole days from `from` to `to`, floored. Negative when `from` is later. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.floor((b - a) / 86_400_000);
}

/* ──────────────────────────── who is looking ─────────────────────────────── */

/**
 * The dashboard adapts to the person, and it decides who they are from what
 * they may DO, never from a job title.
 *
 * That is the same rule the routing follows. A contract administrator who has
 * been granted the notice capability is doing the PM's job on that project and
 * should get the PM's screen; a job-title switch would have handed him the site
 * engineer's. The precedence runs widest-first, so someone who is both a PM and
 * a commercial manager sees the management view without losing the PM queue —
 * the queue is filtered separately, below.
 */
export type Persona = 'site_engineer' | 'qs' | 'pm' | 'management';

export function personaFor(caps: {
  viewAllProjects: boolean;
  manageInvoices: boolean;
  assessNotice: boolean;
  submitPricing: boolean;
}): Persona {
  if (caps.viewAllProjects || caps.manageInvoices) return 'management';
  if (caps.assessNotice) return 'pm';
  if (caps.submitPricing) return 'qs';
  return 'site_engineer';
}

export type KpiKey =
  | 'pending'
  | 'approved_not_invoiced'
  | 'work_started_unapproved'
  | 'client_overdue';

/**
 * Which of the four figures each person gets.
 *
 * A site engineer gets none. Not because the numbers are secret, but because
 * none of them is his: he cannot invoice, he cannot approve, and a screen that
 * opens with four figures he cannot move teaches him the app is not for him.
 * He gets his own changes and the button to report another.
 */
export const PERSONA_KPIS: Record<Persona, KpiKey[]> = {
  site_engineer: [],
  qs: ['pending', 'approved_not_invoiced', 'work_started_unapproved'],
  pm: ['pending', 'work_started_unapproved', 'client_overdue'],
  management: ['pending', 'approved_not_invoiced', 'work_started_unapproved', 'client_overdue'],
};

/** Null means every type. A named list is a filter, not a permission. */
export const PERSONA_ACTIONS: Record<Persona, ActionType[] | null> = {
  site_engineer: ['missing_evidence', 'clarification_required', 'work_started_unapproved'],
  qs: ['qs_pricing_overdue', 'missing_evidence', 'work_started_unapproved', 'blocked'],
  pm: null,
  management: null,
};

/** Whether this person sees the project-by-project money table at all. */
export const PERSONA_SHOWS_PROJECT_TABLE: Record<Persona, boolean> = {
  site_engineer: false,
  qs: true,
  pm: true,
  management: true,
};

export function actionsForPersona(rows: ActionRow[], persona: Persona): ActionRow[] {
  const allowed = PERSONA_ACTIONS[persona];
  if (allowed === null) return rows;
  return rows.filter((row) => allowed.includes(row.type));
}
