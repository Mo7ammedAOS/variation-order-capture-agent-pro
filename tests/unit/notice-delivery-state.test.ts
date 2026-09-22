import { describe, expect, it } from 'vitest';
import { noticeDisplayStatus, noticeNeedsWarning } from '@/lib/notice-status';

/**
 * One sentence, defended seven ways: the app may not say a notice was
 * delivered on the strength of its own outbound request.
 *
 * The failure this guards against is not a crash. It is a screen that reads
 * "Delivered" to a QS whose email bounced, which is confident false evidence —
 * worse than no evidence, because nobody goes looking.
 */

const notice = (status: string, acknowledgedAt: Date | null = null) => ({
  status,
  acknowledgedAt,
});

describe('where the notice actually is', () => {
  it('says nothing is needed when the PM said no notice was required', () => {
    const result = noticeDisplayStatus({ assessment: 'not_required', notice: null, delivery: null });
    expect(result.label).toBe('Not applicable');
    expect(result.tone).toBe('neutral');
  });

  it('calls it a draft while it is still ours to edit', () => {
    expect(
      noticeDisplayStatus({ assessment: 'drafted', notice: notice('draft'), delivery: null }).label,
    ).toBe('Draft');
  });

  it('says required-but-unwritten rather than showing nothing at all', () => {
    const result = noticeDisplayStatus({ assessment: 'required', notice: null, delivery: null });
    expect(result.label).toBe('Draft');
    expect(result.detail).toBe('Not drafted yet');
  });

  it('will NOT say delivered just because we sent it', () => {
    const result = noticeDisplayStatus({
      assessment: 'drafted',
      notice: notice('issued'),
      delivery: 'queued',
    });
    expect(result.label).toBe('Pending delivery');
    expect(result.label).not.toBe('Delivered');
  });

  it('turns red, and says to retry, when the carrying failed', () => {
    const result = noticeDisplayStatus({
      assessment: 'drafted',
      notice: notice('issued'),
      delivery: 'failed',
    });
    expect(result.label).toBe('Delivery failed');
    expect(result.tone).toBe('red');
  });

  it('asks for acknowledgement once the courier confirms, and keeps the fact', () => {
    const result = noticeDisplayStatus({
      assessment: 'sent',
      notice: notice('sent'),
      delivery: 'delivered',
    });
    // The open question is the headline; the settled fact sits under it.
    expect(result.label).toBe('Acknowledgement pending');
    expect(result.detail).toBe('Delivered');
  });

  it('is only finished when a human recorded the client acknowledging it', () => {
    const result = noticeDisplayStatus({
      assessment: 'acknowledged',
      notice: notice('acknowledged', new Date('2026-09-20')),
      delivery: 'delivered',
    });
    expect(result.label).toBe('Acknowledged');
    expect(result.tone).toBe('green');
  });

  it('reads a superseded round as back in drafting, never as gone', () => {
    const result = noticeDisplayStatus({
      assessment: 'required',
      notice: notice('superseded'),
      delivery: null,
    });
    expect(result.label).toBe('Draft');
    expect(result.detail).toBe('Redrafting');
  });
});

describe('what the approver is told before they commit the money', () => {
  it('says nothing when no notice was ever required', () => {
    expect(noticeNeedsWarning({ noticeRequired: false, state: 'not_applicable' })).toBe(false);
    // Even in a state that would otherwise shout.
    expect(noticeNeedsWarning({ noticeRequired: false, state: 'delivery_failed' })).toBe(false);
  });

  it('warns on anything short of the courier confirming it', () => {
    expect(noticeNeedsWarning({ noticeRequired: true, state: 'draft' })).toBe(true);
    expect(noticeNeedsWarning({ noticeRequired: true, state: 'pending_delivery' })).toBe(true);
    expect(noticeNeedsWarning({ noticeRequired: true, state: 'delivery_failed' })).toBe(true);
  });

  it('goes quiet once it is delivered, acknowledged or waiting to be', () => {
    // Delivered is the bar, not sent. A variation approved on the back of a
    // notice that never arrived is a claim that fails on procedure later.
    expect(noticeNeedsWarning({ noticeRequired: true, state: 'delivered' })).toBe(false);
    expect(noticeNeedsWarning({ noticeRequired: true, state: 'acknowledgement_pending' })).toBe(
      false,
    );
    expect(noticeNeedsWarning({ noticeRequired: true, state: 'acknowledged' })).toBe(false);
  });
});
