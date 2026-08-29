import { describe, expect, it } from 'vitest';
import { isNoticeOverdue, NOTICE_OUTSTANDING_STATUSES } from '@/services/notice.service';
import { humanise } from '@/services/dashboard.service';

/**
 * One definition of "overdue", used by the dashboard, the register and the
 * printed report.
 *
 * The report is the thing that goes in front of a client. If it says four
 * notices are late and the dashboard says three, the disagreement destroys
 * trust in both, and nobody can tell from the outside which one is wrong.
 */

const today = new Date(Date.UTC(2026, 7, 30));
const yesterday = new Date(Date.UTC(2026, 7, 29));
const tomorrow = new Date(Date.UTC(2026, 7, 31));

describe('isNoticeOverdue', () => {
  it('is overdue when the deadline has passed and nobody has answered the question', () => {
    expect(isNoticeOverdue(yesterday, 'not_assessed', today)).toBe(true);
  });

  it('is overdue when a notice is required and the deadline has passed', () => {
    expect(isNoticeOverdue(yesterday, 'required', today)).toBe(true);
  });

  it('is NOT overdue once the notice has been sent', () => {
    // The deadline was met. A date in the past is history, not a breach.
    expect(isNoticeOverdue(yesterday, 'sent', today)).toBe(false);
    expect(isNoticeOverdue(yesterday, 'acknowledged', today)).toBe(false);
  });

  it('is NOT overdue when the assessment concluded no notice was needed', () => {
    expect(isNoticeOverdue(yesterday, 'not_required', today)).toBe(false);
  });

  it('is not overdue before the deadline', () => {
    expect(isNoticeOverdue(tomorrow, 'required', today)).toBe(false);
  });

  it('is not overdue on the day itself', () => {
    expect(isNoticeOverdue(today, 'required', today)).toBe(false);
  });

  it('is not overdue when there is no deadline at all', () => {
    expect(isNoticeOverdue(null, 'required', today)).toBe(false);
  });

  it('exposes exactly the two statuses that leave a deadline live', () => {
    expect([...NOTICE_OUTSTANDING_STATUSES]).toEqual(['not_assessed', 'required']);
  });
});

describe('humanise', () => {
  it('leaves trade acronyms as acronyms', () => {
    // "Qs Pricing" on a document sent to a consultant reads as though it was
    // written by somebody who does not work in the industry.
    expect(humanise('qs_pricing')).toBe('QS pricing');
    expect(humanise('pm_scope_review')).toBe('PM scope review');
    expect(humanise('cm_review')).toBe('CM review');
  });

  it('still sentence-cases an ordinary status', () => {
    expect(humanise('notice_assessment')).toBe('Notice assessment');
    expect(humanise('included_scope')).toBe('Included scope');
  });
});
