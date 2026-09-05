import { describe, expect, it } from 'vitest';
import { scheduledJobSchema } from '@/app/api/integrations/schemas';

/**
 * The date a sweep is told to believe in.
 *
 * Everything contractual in this system is a function of dates, so none of it
 * can be exercised on the day the data is entered: a notice due in 28 days is
 * not overdue, and the honest answer to every sweep is "nothing yet". `as_of`
 * is how a test gets past that without waiting a month, and it is refused by
 * the route unless ALLOW_JOB_TIME_TRAVEL is on.
 *
 * The format matters more than it looks. An n8n Code node is a bad place to
 * have to remember whether a field wants a date or a full ISO instant, so both
 * are accepted — and this is where that promise is kept.
 */
describe('scheduled job payload', () => {
  it('takes a job on its own, which is what every schedule sends', () => {
    expect(scheduledJobSchema.parse({ job: 'reminder_sweep' })).toEqual({
      job: 'reminder_sweep',
    });
  });

  it('takes a plain calendar date, because that is what a person types', () => {
    expect(scheduledJobSchema.parse({ job: 'client_followup', as_of: '2026-10-04' }).as_of).toBe(
      '2026-10-04',
    );
  });

  it('takes a full instant too', () => {
    const parsed = scheduledJobSchema.parse({
      job: 'bottleneck_sweep',
      as_of: '2026-10-04T06:30:00.000Z',
    });
    expect(parsed.as_of).toBe('2026-10-04T06:30:00.000Z');
  });

  it('refuses something that is not a date at all', () => {
    expect(() => scheduledJobSchema.parse({ job: 'reminder_sweep', as_of: 'next week' })).toThrow();
    expect(() => scheduledJobSchema.parse({ job: 'reminder_sweep', as_of: '04/10/2026' })).toThrow();
  });

  it('still refuses a job it does not have', () => {
    expect(() => scheduledJobSchema.parse({ job: 'send_everything' })).toThrow();
  });
});
