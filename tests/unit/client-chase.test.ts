import { describe, expect, it } from 'vitest';
import { clientChaseDue } from '@/services/client-followup.service';

/**
 * The cadence of the only letters this system sends outside the company.
 *
 * Two things are being proved here. The first is that the company's setting is
 * actually obeyed — the field spent its whole life on the form driving nothing,
 * and a test is the only thing that stops that happening twice. The second is
 * that the interval is enforced by arithmetic rather than by how often the
 * schedule fires, which is what makes running the sweep twice in a morning
 * harmless.
 */

const weekly = { enabled: true, responseDays: 14, intervalDays: 7 };

describe('before the client is late', () => {
  it('says nothing during their own response period', () => {
    for (const waitingDays of [0, 1, 13]) {
      expect(clientChaseDue({ ...weekly, waitingDays }).due).toBe(false);
    }
  });

  it('sends the first chase on the day the period expires, not a day later', () => {
    expect(clientChaseDue({ ...weekly, waitingDays: 14 })).toEqual({ due: true, window: 0 });
  });

  it('moves with the response period, because that is the contract', () => {
    const long = { enabled: true, responseDays: 30, intervalDays: 7 };
    expect(clientChaseDue({ ...long, waitingDays: 20 }).due).toBe(false);
    expect(clientChaseDue({ ...long, waitingDays: 30 }).due).toBe(true);
  });
});

describe('the interval the company chose', () => {
  it('holds one window open for the whole seven days', () => {
    // Every sweep between day 14 and day 20 computes window 0, so every one
    // after the first writes nothing. This is what makes "weekly" true even
    // though the job runs every morning.
    const windows = [14, 15, 18, 20].map((waitingDays) =>
      clientChaseDue({ ...weekly, waitingDays }).window,
    );
    expect(windows).toEqual([0, 0, 0, 0]);
  });

  it('opens the next window on the seventh day', () => {
    expect(clientChaseDue({ ...weekly, waitingDays: 21 }).window).toBe(1);
    expect(clientChaseDue({ ...weekly, waitingDays: 28 }).window).toBe(2);
  });

  it('is honoured when the company wants it daily', () => {
    const daily = { enabled: true, responseDays: 14, intervalDays: 1 };
    expect(clientChaseDue({ ...daily, waitingDays: 14 }).window).toBe(0);
    expect(clientChaseDue({ ...daily, waitingDays: 15 }).window).toBe(1);
    expect(clientChaseDue({ ...daily, waitingDays: 16 }).window).toBe(2);
  });

  it('is honoured when the company wants it rarely', () => {
    const monthly = { enabled: true, responseDays: 14, intervalDays: 30 };
    expect(clientChaseDue({ ...monthly, waitingDays: 20 }).window).toBe(0);
    expect(clientChaseDue({ ...monthly, waitingDays: 43 }).window).toBe(0);
    expect(clientChaseDue({ ...monthly, waitingDays: 44 }).window).toBe(1);
  });

  it('falls back to weekly rather than dividing by zero', () => {
    // A row written before the field was validated, or edited by hand. "Every
    // zero days" is not a cadence, and the wrong thing to do with a nonsense
    // interval is to send continuously.
    expect(clientChaseDue({ enabled: true, responseDays: 14, intervalDays: 0, waitingDays: 20 }))
      .toEqual({ due: true, window: 0 });
    expect(clientChaseDue({ enabled: true, responseDays: 14, intervalDays: 0, waitingDays: 21 }))
      .toEqual({ due: true, window: 1 });
  });
});

describe('the switch', () => {
  it('means silence, however late the client is', () => {
    // Off is a real commercial answer, not a misconfiguration to be corrected.
    // Some contracts are chased by the commercial manager in person.
    for (const waitingDays of [14, 60, 400]) {
      expect(clientChaseDue({ ...weekly, enabled: false, waitingDays }).due).toBe(false);
    }
  });
});
