import { describe, expect, it } from 'vitest';
import type { PotentialChangeStatus } from '@prisma/client';
import { allowedNextStatuses } from '@/services/potential-change.service';
import { isRework, statusLabel } from '@/lib/status-labels';

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

/**
 * `cm_review` left the chain on 2026-08-31 when Osman settled the approval
 * flow: two gates, each needing a project manager AND a managing director, and
 * no separate commercial review stage — this company has no Commercial
 * Manager, so a change reaching that stage would have stopped there for good.
 */
const CHAIN: PotentialChangeStatus[] = ['pm_scope_review', 'qs_pricing', 'internal_approval'];

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
    ]);
  });

  it('sends a change waiting on evidence BACK to the assessment', () => {
    // "Needs more information" parks the entitlement question rather than
    // answering it. Without this route the change is stuck for good.
    expect(allowedNextStatuses('needs_evidence')).toContain('notice_assessment');
  });

  it('offers no way past a notice awaiting its two approvals', () => {
    // The approvals advance it, not a dropdown. Leaving `pm_scope_review` here
    // would let anyone holding `changeStatus` walk the change straight past a
    // gate that exists precisely so one person cannot — and a gate you can
    // step around is not a gate.
    expect(allowedNextStatuses('notice_required')).toEqual([]);
  });

  it('advances exactly one stage along the chain', () => {
    expect(allowedNextStatuses('pm_scope_review')[0]).toBe('qs_pricing');
  });

  /**
   * Leaving QS pricing means SUBMITTING a price, or recording that the work is
   * already in the contract. Both are decisions with evidence behind them, and
   * neither belongs in a dropdown — the same rule as the approval gates.
   */
  it('will not let a change leave pricing without a price', () => {
    expect(allowedNextStatuses('qs_pricing')).not.toContain('internal_approval');
    expect(allowedNextStatuses('qs_pricing')).not.toContain('variation_approved');
    expect(allowedNextStatuses('qs_pricing')).toContain('pm_scope_review');
  });

  it('will not carry a change past the final gate on its own', () => {
    // Reaching `internal_approval` OPENS the two-seat gate. Only both
    // approvals close it, so "included in scope" is never on offer here.
    expect(allowedNextStatuses('internal_approval')).not.toContain('included_scope');
  });

  it('never allows a stage to be skipped', () => {
    // The whole point: nothing reaches "included in scope" without approval.
    expect(allowedNextStatuses('pm_scope_review')).not.toContain('internal_approval');
    expect(allowedNextStatuses('pm_scope_review')).not.toContain('included_scope');
    expect(allowedNextStatuses('qs_pricing')).not.toContain('included_scope');
  });

  it('allows rework backwards to any earlier stage', () => {
    // Someone who spots a pricing error sends it back. A strictly forward
    // chain would leave "cancel" as the only correction, losing the change and
    // its history to fix an arithmetic slip.
    expect(allowedNextStatuses('qs_pricing')).toContain('pm_scope_review');
    expect(allowedNextStatuses('internal_approval')).toContain('qs_pricing');
    expect(allowedNextStatuses('internal_approval')).toContain('pm_scope_review');
  });

  it('offers no rework from the first stage of the chain', () => {
    expect(allowedNextStatuses('pm_scope_review')).toEqual(['qs_pricing']);
  });

  /**
   * Cancelling LEFT the dropdown on 2026-08-31.
   *
   * It is not one more status. It is the company deciding to stop pursuing
   * money it may be owed, and sitting in a list beside "QS pricing" it could be
   * picked by accident. It now has its own action, its own permission and a
   * mandatory reason — see `cancelPotentialChange`.
   */
  it('never offers cancelled as a status anybody can just pick', () => {
    const everywhere: PotentialChangeStatus[] = [
      ...CHAIN,
      'new_potential_change',
      'needs_evidence',
      'notice_required',
      'notice_assessment',
    ];
    for (const status of everywhere) {
      expect(allowedNextStatuses(status)).not.toContain('cancelled');
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

describe('the words people actually read', () => {
  it('never shows a raw enum name', () => {
    // "pm scope review" is the machine's word with the underscores taken out.
    // It reads as an unfinished screen and teaches people the app is talking
    // to itself.
    expect(statusLabel('pm_scope_review')).toBe('Scope review');
    expect(statusLabel('qs_pricing')).toBe('Pricing');
    expect(statusLabel('variation_approved')).toBe('Variation approved');
    expect(statusLabel('included_scope')).toBe('Already in the contract');
  });

  it('knows which way along the chain a move goes', () => {
    expect(isRework('qs_pricing', 'pm_scope_review')).toBe(true);
    expect(isRework('internal_approval', 'qs_pricing')).toBe(true);
    expect(isRework('pm_scope_review', 'qs_pricing')).toBe(false);
  });

  it('does not call a move to a closing status rework', () => {
    // Cancelled and approved sit outside the chain; treating them as backwards
    // would demand a rework reason for finishing something.
    expect(isRework('qs_pricing', 'cancelled')).toBe(false);
    expect(isRework('internal_approval', 'variation_approved')).toBe(false);
  });
});
