import { describe, expect, it } from 'vitest';
import type { PotentialChangeStatus } from '@prisma/client';
import { allowedNextStatuses } from '@/services/potential-change.service';

/**
 * The lifecycle guard, tested as pure logic so it runs without a database.
 *
 * The case that earns its keep is the notice gate. Before this existed,
 * `changeStatus` accepted any status at all, so a change sitting in
 * `notice_assessment` could be moved straight to `included_scope` — past the
 * entitlement question, which is the single thing this product exists to stop
 * people skipping. Nothing would have looked wrong: the change would appear to
 * be progressing normally, and the notice would simply never be served.
 */

describe('allowedNextStatuses', () => {
  it('never offers a way out of notice assessment', () => {
    // The outcome of the assessment decides where it goes, not a dropdown.
    expect(allowedNextStatuses('notice_assessment')).toEqual([]);
  });

  it('offers nothing from a terminal status', () => {
    expect(allowedNextStatuses('included_scope')).toEqual([]);
    expect(allowedNextStatuses('cancelled')).toEqual([]);
  });

  it('sends a newly captured change into the assessment, or nowhere else useful', () => {
    expect(allowedNextStatuses('new_potential_change')).toEqual([
      'notice_assessment',
      'cancelled',
    ]);
  });

  it('lets a change in the review stages move on, and to an end', () => {
    const next = allowedNextStatuses('qs_pricing');

    expect(next).toContain('cm_review');
    expect(next).toContain('internal_approval');
    expect(next).toContain('included_scope');
    expect(next).toContain('cancelled');
  });

  it('never offers a status the change is already in', () => {
    const stages: PotentialChangeStatus[] = [
      'needs_evidence', 'notice_required', 'pm_scope_review',
      'qs_pricing', 'cm_review', 'internal_approval',
    ];

    for (const stage of stages) {
      expect(allowedNextStatuses(stage)).not.toContain(stage);
    }
  });

  it('never offers a route back into notice assessment from a later stage', () => {
    const stages: PotentialChangeStatus[] = [
      'needs_evidence', 'notice_required', 'pm_scope_review',
      'qs_pricing', 'cm_review', 'internal_approval',
    ];

    // Re-entering the assessment would let someone re-answer a question that
    // has already been answered and recorded against a name.
    for (const stage of stages) {
      expect(allowedNextStatuses(stage)).not.toContain('notice_assessment');
    }
  });
});
