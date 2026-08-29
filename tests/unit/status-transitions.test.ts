import { describe, expect, it } from 'vitest';
import type { PotentialChangeStatus } from '@prisma/client';
import { allowedNextStatuses } from '@/services/potential-change.service';

/**
 * The lifecycle guard, as pure logic so it runs without a database.
 *
 * The chain is scope → price → CM → approval, settled 2026-08-30. Two cases
 * here earn their keep beyond documenting that.
 *
 * The notice gate: before any of this existed, `changeStatus` accepted anything,
 * so a change in `notice_assessment` could be moved straight to
 * `included_scope` — past the entitlement question, which is the single thing
 * this product exists to stop people skipping. Nothing would have looked wrong.
 *
 * The skip: advancing two stages at once is how a change reaches "included in
 * scope" without anybody approving it, which defeats the approval thresholds
 * silently rather than loudly.
 */

const CHAIN: PotentialChangeStatus[] = [
  'pm_scope_review',
  'qs_pricing',
  'cm_review',
  'internal_approval',
];

describe('allowedNextStatuses', () => {
  it('never offers a way out of notice assessment', () => {
    expect(allowedNextStatuses('notice_assessment')).toEqual([]);
  });

  it('offers nothing from a terminal status', () => {
    expect(allowedNextStatuses('included_scope')).toEqual([]);
    expect(allowedNextStatuses('cancelled')).toEqual([]);
  });

  it('sends a newly captured change into the assessment', () => {
    expect(allowedNextStatuses('new_potential_change')).toEqual([
      'notice_assessment',
      'cancelled',
    ]);
  });

  it('sends a change waiting on evidence BACK to the assessment', () => {
    // "Needs more information" parks the entitlement question rather than
    // answering it. Without this route the change is stuck for good.
    expect(allowedNextStatuses('needs_evidence')).toContain('notice_assessment');
  });

  it('sends a change with a notice raised into scope review', () => {
    expect(allowedNextStatuses('notice_required')).toEqual(['pm_scope_review', 'cancelled']);
  });

  it('advances exactly one stage along the chain', () => {
    expect(allowedNextStatuses('pm_scope_review')[0]).toBe('qs_pricing');
    expect(allowedNextStatuses('qs_pricing')[0]).toBe('cm_review');
    expect(allowedNextStatuses('cm_review')[0]).toBe('internal_approval');
    expect(allowedNextStatuses('internal_approval')[0]).toBe('included_scope');
  });

  it('never allows a stage to be skipped', () => {
    // The whole point: nothing reaches "included in scope" without approval.
    expect(allowedNextStatuses('pm_scope_review')).not.toContain('cm_review');
    expect(allowedNextStatuses('pm_scope_review')).not.toContain('included_scope');
    expect(allowedNextStatuses('qs_pricing')).not.toContain('internal_approval');
    expect(allowedNextStatuses('cm_review')).not.toContain('included_scope');
  });

  it('allows rework backwards to any earlier stage', () => {
    // A CM who spots a pricing error sends it back. A strictly forward chain
    // would leave "cancel" as the only correction, losing the change and its
    // history to fix an arithmetic slip.
    expect(allowedNextStatuses('cm_review')).toContain('qs_pricing');
    expect(allowedNextStatuses('cm_review')).toContain('pm_scope_review');
    expect(allowedNextStatuses('internal_approval')).toContain('cm_review');
    expect(allowedNextStatuses('internal_approval')).toContain('pm_scope_review');
  });

  it('offers no rework from the first stage of the chain', () => {
    expect(allowedNextStatuses('pm_scope_review')).toEqual(['qs_pricing', 'cancelled']);
  });

  it('allows cancelling from anywhere that is not already an end', () => {
    for (const status of [...CHAIN, 'needs_evidence', 'notice_required'] as PotentialChangeStatus[]) {
      expect(allowedNextStatuses(status)).toContain('cancelled');
    }
  });

  it('never offers a status the change is already in', () => {
    for (const status of CHAIN) {
      expect(allowedNextStatuses(status)).not.toContain(status);
    }
  });

  it('never routes a chain stage back into the assessment', () => {
    // The question has been answered and recorded against a name.
    for (const status of CHAIN) {
      expect(allowedNextStatuses(status)).not.toContain('notice_assessment');
    }
  });
});
