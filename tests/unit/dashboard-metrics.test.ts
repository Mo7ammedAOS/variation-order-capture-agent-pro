import { describe, expect, it } from 'vitest';
import {
  actionsForPersona,
  blockageNextAction,
  buildPipeline,
  changeValue,
  daysBetween,
  filterActions,
  isClientDecisionOverdue,
  isPendingChange,
  isWorkStartedUnapproved,
  personaFor,
  pipelineStageFor,
  priorityFor,
  rankProjects,
  sortActions,
  type ActionRow,
  type ActionType,
} from '@/lib/dashboard-metrics';

/**
 * The dashboard's arithmetic, proved without a database.
 *
 * Every figure the screen promotes is a pure function of plain rows, which is
 * the whole reason those functions exist separately from the service. A wrong
 * definition here is a director repeating a wrong number in a meeting, and
 * that is the failure this file exists to prevent.
 */

const TODAY = new Date('2026-09-23T00:00:00.000Z');

function row(over: Partial<ActionRow> = {}): ActionRow {
  return {
    key: 'k',
    type: 'notice_decision',
    priority: 'green',
    changeId: 'c1',
    reference: 'PC-DXB-001-0001',
    description: 'Ceiling detail changed',
    projectId: 'p1',
    projectName: 'Office Fit-out',
    ownerName: 'Abdelmoneim',
    ownerUserId: 'u-pm',
    ownerRole: 'PM',
    nextAction: 'Decide if a notice is needed',
    value: 1000,
    dueDate: null,
    overdueDays: null,
    ageDays: 1,
    status: 'PM review',
    href: '/variations/c1',
    ...over,
  };
}

describe('pending change value', () => {
  it('counts a change nobody has answered yet', () => {
    expect(isPendingChange({ currentStatus: 'qs_pricing', clientResponse: null })).toBe(true);
  });

  it('counts one submitted and still awaiting the client', () => {
    expect(
      isPendingChange({ currentStatus: 'variation_approved', clientResponse: 'awaiting' }),
    ).toBe(true);
  });

  it('excludes cancelled, already-in-scope and rejected', () => {
    expect(isPendingChange({ currentStatus: 'cancelled' })).toBe(false);
    expect(isPendingChange({ currentStatus: 'included_scope' })).toBe(false);
    expect(
      isPendingChange({ currentStatus: 'variation_approved', clientResponse: 'rejected' }),
    ).toBe(false);
  });

  it('excludes one the client has approved — that is no longer pending', () => {
    expect(
      isPendingChange({ currentStatus: 'variation_approved', clientResponse: 'approved' }),
    ).toBe(false);
  });

  it('prefers the priced value over the reporter estimate', () => {
    expect(changeValue({ submittedValue: 24500, estimatedValue: 9000 })).toBe(24500);
  });

  it('falls back to the estimate so a fresh change is not worth nothing', () => {
    expect(changeValue({ submittedValue: null, estimatedValue: 9000 })).toBe(9000);
    expect(changeValue({ submittedValue: 0, estimatedValue: 9000 })).toBe(9000);
  });

  it('is zero when neither figure exists', () => {
    expect(changeValue({})).toBe(0);
  });
});

describe('work started without approval', () => {
  it('flags work in progress on an unapproved change', () => {
    expect(isWorkStartedUnapproved({ workStatus: 'in_progress', currentStatus: 'qs_pricing' })).toBe(true);
  });

  it('flags completed work that was never approved', () => {
    expect(isWorkStartedUnapproved({ workStatus: 'completed', currentStatus: 'notice_assessment' })).toBe(true);
  });

  it('does not flag work that has not started', () => {
    expect(isWorkStartedUnapproved({ workStatus: 'not_started', currentStatus: 'qs_pricing' })).toBe(false);
  });

  it('does not flag an approved variation', () => {
    expect(isWorkStartedUnapproved({ workStatus: 'in_progress', currentStatus: 'variation_approved' })).toBe(false);
  });

  it('does not flag work the QS found was already in the contract', () => {
    // That is a correct outcome, not exposure.
    expect(isWorkStartedUnapproved({ workStatus: 'completed', currentStatus: 'included_scope' })).toBe(false);
  });
});

describe('overdue client decisions', () => {
  const submitted = { status: 'submitted', clientResponse: 'awaiting' };

  it('uses the project response window, not a constant', () => {
    const at = new Date('2026-09-10T00:00:00.000Z'); // 13 days ago
    expect(isClientDecisionOverdue({ ...submitted, submittedAt: at }, 14, TODAY)).toBe(false);
    expect(isClientDecisionOverdue({ ...submitted, submittedAt: at }, 7, TODAY)).toBe(true);
  });

  it('is not overdue on the day the window closes minus one', () => {
    const at = new Date('2026-09-17T00:00:00.000Z'); // 6 days ago
    expect(isClientDecisionOverdue({ ...submitted, submittedAt: at }, 7, TODAY)).toBe(false);
  });

  it('ignores a variation the client has answered', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    expect(
      isClientDecisionOverdue({ status: 'submitted', clientResponse: 'approved', submittedAt: at }, 7, TODAY),
    ).toBe(false);
  });

  it('ignores one never submitted', () => {
    expect(isClientDecisionOverdue({ ...submitted, submittedAt: null }, 7, TODAY)).toBe(false);
    expect(
      isClientDecisionOverdue({ status: 'draft', clientResponse: 'awaiting', submittedAt: new Date('2026-01-01') }, 7, TODAY),
    ).toBe(false);
  });
});

describe('priority', () => {
  it('is red the day the deadline is reached, not the day after', () => {
    expect(priorityFor({ overdueDays: 0 })).toBe('red');
    expect(priorityFor({ overdueDays: 4 })).toBe('red');
  });

  it('is amber inside the warning window', () => {
    expect(priorityFor({ overdueDays: -2 })).toBe('amber');
  });

  it('is green with time in hand', () => {
    expect(priorityFor({ overdueDays: -20 })).toBe('green');
  });

  it('is green when there is no deadline to breach', () => {
    expect(priorityFor({ overdueDays: null })).toBe('green');
  });

  it('never turns red because a change is large', () => {
    // Value orders rows inside a priority. It never sets one.
    expect(priorityFor({ overdueDays: -30 })).toBe('green');
  });
});

describe('the queue filters', () => {
  const rows = [
    row({ key: 'a', type: 'notice_decision', priority: 'red' }),
    row({ key: 'b', type: 'qs_pricing_overdue', ownerUserId: 'u-qs' }),
    row({ key: 'c', type: 'pm_approval_overdue' }),
    row({ key: 'd', type: 'client_response_overdue', ownerUserId: null }),
    row({ key: 'e', type: 'notice_delivery_failed', priority: 'red' }),
    row({ key: 'f', type: 'work_started_unapproved', priority: 'red' }),
  ];

  it('Mine is by owner, not by project', () => {
    expect(filterActions(rows, 'mine', 'u-qs').map((r) => r.key)).toEqual(['b']);
  });

  it('Notices gathers every notice state', () => {
    expect(filterActions(rows, 'notices', 'u').map((r) => r.key)).toEqual(['a', 'e']);
  });

  it('Client covers the client answering and acknowledging', () => {
    expect(filterActions(rows, 'client', 'u').map((r) => r.key)).toEqual(['d']);
  });

  it('Red only leaves the rest behind', () => {
    expect(filterActions(rows, 'red', 'u').map((r) => r.key)).toEqual(['a', 'e', 'f']);
  });

  it('All returns everything', () => {
    expect(filterActions(rows, 'all', 'u')).toHaveLength(6);
  });
});

describe('the queue sorts', () => {
  const rows = [
    row({ key: 'green-big', priority: 'green', value: 90_000, ageDays: 1, dueDate: '2026-09-30T00:00:00.000Z' }),
    row({ key: 'red-small', priority: 'red', value: 500, overdueDays: 2, ageDays: 40, dueDate: '2026-09-21T00:00:00.000Z' }),
    row({ key: 'amber', priority: 'amber', value: 10_000, overdueDays: -1, ageDays: 5, dueDate: '2026-09-24T00:00:00.000Z' }),
    row({ key: 'no-date', priority: 'green', value: 1, ageDays: 2, dueDate: null }),
  ];

  it('puts the late small one above the fat safe one', () => {
    expect(sortActions(rows, 'priority')[0]!.key).toBe('red-small');
  });

  it('oldest is by age, not by deadline', () => {
    expect(sortActions(rows, 'oldest')[0]!.key).toBe('red-small');
  });

  it('highest value ignores priority', () => {
    expect(sortActions(rows, 'value')[0]!.key).toBe('green-big');
  });

  it('nearest deadline sends the undated row last, never first', () => {
    const sorted = sortActions(rows, 'deadline');
    expect(sorted[0]!.key).toBe('red-small');
    expect(sorted[sorted.length - 1]!.key).toBe('no-date');
  });

  it('does not mutate what it was given', () => {
    const before = rows.map((r) => r.key);
    sortActions(rows, 'value');
    expect(rows.map((r) => r.key)).toEqual(before);
  });
});

describe('the pipeline', () => {
  it('maps the internal statuses onto the six customer stages', () => {
    expect(pipelineStageFor({ currentStatus: 'new_potential_change' })).toBe('new');
    expect(pipelineStageFor({ currentStatus: 'notice_assessment' })).toBe('pm_review');
    expect(pipelineStageFor({ currentStatus: 'needs_evidence' })).toBe('pm_review');
    expect(pipelineStageFor({ currentStatus: 'qs_pricing' })).toBe('qs_pricing');
    expect(pipelineStageFor({ currentStatus: 'internal_approval' })).toBe('pm_approval');
  });

  it('keeps the two retired statuses readable rather than orphaned', () => {
    expect(pipelineStageFor({ currentStatus: 'pm_scope_review' })).toBe('pm_review');
    expect(pipelineStageFor({ currentStatus: 'notice_required' })).toBe('pm_review');
    expect(pipelineStageFor({ currentStatus: 'cm_review' })).toBe('pm_approval');
  });

  it('splits approved on whether it has actually been put to the client', () => {
    expect(
      pipelineStageFor({ currentStatus: 'variation_approved', vo: { submitted: false, answered: false } }),
    ).toBe('sent');
    expect(
      pipelineStageFor({ currentStatus: 'variation_approved', vo: { submitted: true, answered: false } }),
    ).toBe('client_decision');
  });

  it('drops answered and closed changes out of the pipeline entirely', () => {
    expect(
      pipelineStageFor({ currentStatus: 'variation_approved', vo: { submitted: true, answered: true } }),
    ).toBeNull();
    expect(pipelineStageFor({ currentStatus: 'cancelled' })).toBeNull();
    expect(pipelineStageFor({ currentStatus: 'included_scope' })).toBeNull();
  });

  it('totals count, value and the oldest wait per stage', () => {
    const stages = buildPipeline([
      { currentStatus: 'qs_pricing', value: 40_000, ageDays: 6 },
      { currentStatus: 'qs_pricing', value: 12_500, ageDays: 2 },
      { currentStatus: 'cancelled', value: 99_000, ageDays: 99 },
    ]);
    const pricing = stages.find((s) => s.key === 'qs_pricing')!;
    expect(pricing.count).toBe(2);
    expect(pricing.value).toBe(52_500);
    expect(pricing.oldestDays).toBe(6);
    expect(stages.every((s) => s.href.startsWith('/variations?status='))).toBe(true);
  });
});

describe('project commercial position', () => {
  const base = { approvedNotInvoiced: 0, openChanges: 1, overdueActions: 0, projectCode: 'X', projectName: 'X' };

  it('sorts by unapproved work before pending value', () => {
    const ranked = rankProjects([
      { ...base, projectId: 'rich', pendingValue: 900_000, workStartedUnapproved: 0 },
      { ...base, projectId: 'exposed', pendingValue: 10, workStartedUnapproved: 12_000 },
    ]);
    expect(ranked[0]!.projectId).toBe('exposed');
  });

  it('falls back to pending value, then to overdue actions', () => {
    const ranked = rankProjects([
      { ...base, projectId: 'a', pendingValue: 10, workStartedUnapproved: 0, overdueActions: 9 },
      { ...base, projectId: 'b', pendingValue: 50, workStartedUnapproved: 0, overdueActions: 0 },
    ]);
    expect(ranked.map((r) => r.projectId)).toEqual(['b', 'a']);
  });
});

describe('who is looking', () => {
  const none = {
    viewAllProjects: false,
    manageInvoices: false,
    assessNotice: false,
    submitPricing: false,
  };

  it('reads the person from what they may do, never a job title', () => {
    expect(personaFor({ ...none, viewAllProjects: true })).toBe('management');
    expect(personaFor({ ...none, manageInvoices: true })).toBe('management');
    expect(personaFor({ ...none, assessNotice: true })).toBe('pm');
    expect(personaFor({ ...none, submitPricing: true })).toBe('qs');
    expect(personaFor(none)).toBe('site_engineer');
  });

  it('gives the widest view to somebody who holds several', () => {
    expect(personaFor({ ...none, viewAllProjects: true, assessNotice: true })).toBe('management');
    expect(personaFor({ ...none, assessNotice: true, submitPricing: true })).toBe('pm');
  });

  it('shows a site engineer only what is his, and no money rows', () => {
    const rows: ActionRow[] = (
      [
        'missing_evidence',
        'clarification_required',
        'work_started_unapproved',
        'client_response_overdue',
        'pm_approval_overdue',
        'notice_delivery_failed',
      ] as ActionType[]
    ).map((type) => row({ key: type, type }));

    const seen = actionsForPersona(rows, 'site_engineer').map((r) => r.type);
    expect(seen).toEqual(['missing_evidence', 'clarification_required', 'work_started_unapproved']);
    expect(seen).not.toContain('client_response_overdue');
  });

  it('gives the QS the pricing queue and not the notice queue', () => {
    const rows = [
      row({ key: '1', type: 'qs_pricing_overdue' }),
      row({ key: '2', type: 'notice_decision' }),
    ];
    expect(actionsForPersona(rows, 'qs').map((r) => r.type)).toEqual(['qs_pricing_overdue']);
  });

  it('holds nothing back from a PM or from management', () => {
    const rows = [row({ key: '1', type: 'notice_decision' }), row({ key: '2', type: 'client_response_overdue' })];
    expect(actionsForPersona(rows, 'pm')).toHaveLength(2);
    expect(actionsForPersona(rows, 'management')).toHaveLength(2);
  });
});

describe('blocked changes', () => {
  it('turns a blockage type into something to do', () => {
    expect(blockageNextAction('qs_pricing_overdue', null)).toBe('Submit pricing');
    expect(blockageNextAction('invoice_overdue', null)).toBe('Chase the payment');
    expect(blockageNextAction('notice_drafted_not_sent', null)).toBe('Read the notice and send it');
  });

  it('falls back to what a person wrote, never to a guess', () => {
    expect(blockageNextAction('other', 'Waiting on the landlord')).toBe('Waiting on the landlord');
  });

  it('says something useful even with nothing to go on', () => {
    expect(blockageNextAction('other', null)).toBe('Find out who owns it');
  });

  it('covers every blockage the detection sweep actually raises', () => {
    // The sweep writes these eight. A type it raises with no prescription
    // would put a humanised enum in the column people read.
    for (const type of [
      'notice_assessment_overdue',
      'notice_required_not_drafted',
      'notice_drafted_not_sent',
      'notice_sent_no_proof',
      'vo_not_submitted',
      'client_approval_overdue',
      'approved_not_invoiced',
      'invoice_overdue',
    ]) {
      expect(blockageNextAction(type, null)).not.toBe('Find out who owns it');
    }
  });
});

describe('daysBetween', () => {
  it('is whole days, and negative when the first date is later', () => {
    expect(daysBetween('2026-09-20T00:00:00.000Z', TODAY)).toBe(3);
    expect(daysBetween('2026-09-25T00:00:00.000Z', TODAY)).toBe(-2);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });
});
