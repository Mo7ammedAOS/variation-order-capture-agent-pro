import { describe, expect, it } from 'vitest';
import { approvalChase } from '@/services/reminder.service';

/**
 * Who gets chased, how hard, and who is deliberately left alone.
 *
 * The quiet cases are the ones worth testing. A director copied on every
 * decision from hour one stops reading any of them, and then the one that
 * mattered is the one he skimmed. Silence here is a designed behaviour, not an
 * absence of one, so it gets the same coverage as the shouting.
 */

const NOTICE = 'notice_issue' as const;
const MONEY = 'final_variation' as const;
const PM = 'project_manager' as const;
const MD = 'managing_director' as const;

describe('the project manager', () => {
  it('is chased every day on a notice, from day one', () => {
    for (const waitingDays of [0, 1, 5, 20]) {
      expect(approvalChase({ gate: NOTICE, seat: PM, waitingDays, otherSeatApproved: false }).chase)
        .toBe(true);
    }
  });

  it('is chased every day on the money too', () => {
    expect(approvalChase({ gate: MONEY, seat: PM, waitingDays: 0, otherSeatApproved: false }).chase)
      .toBe(true);
  });

  it('is never escalated over', () => {
    // The seats ARE the escalation. Copying somebody senior on a decision that
    // already sits with a project manager and a managing director means
    // copying nobody new.
    expect(approvalChase({ gate: NOTICE, seat: PM, waitingDays: 30, otherSeatApproved: false }).widen)
      .toBe(false);
  });
});

describe('the managing director, on a notice', () => {
  it('is left alone for the first three days', () => {
    // The project manager owns this call. The MD is the backstop for a PM who
    // has gone quiet, not the first line.
    expect(approvalChase({ gate: NOTICE, seat: MD, waitingDays: 0, otherSeatApproved: false }).chase)
      .toBe(false);
    expect(approvalChase({ gate: NOTICE, seat: MD, waitingDays: 2, otherSeatApproved: false }).chase)
      .toBe(false);
  });

  it('is chased from the third day on', () => {
    expect(approvalChase({ gate: NOTICE, seat: MD, waitingDays: 3, otherSeatApproved: false }).chase)
      .toBe(true);
    expect(approvalChase({ gate: NOTICE, seat: MD, waitingDays: 9, otherSeatApproved: false }).chase)
      .toBe(true);
  });
});

describe('the managing director, on the money', () => {
  it('is not chased while the project manager still has it', () => {
    // Chasing a man for a decision he cannot yet make is noise, and noise is
    // what makes the next message get ignored.
    expect(approvalChase({ gate: MONEY, seat: MD, waitingDays: 10, otherSeatApproved: false }).chase)
      .toBe(false);
  });

  it('is chased daily the moment the project manager approves', () => {
    expect(approvalChase({ gate: MONEY, seat: MD, waitingDays: 0, otherSeatApproved: true }).chase)
      .toBe(true);
  });
});
