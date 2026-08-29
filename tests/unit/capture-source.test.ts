import { describe, expect, it } from 'vitest';
import { potentialChangeCreateSchema } from '@/services/potential-change.service';

/**
 * Where and when a change was RAISED, as opposed to where and when it happened.
 *
 * The form previously hardcoded `sourceType: 'mobile_form'`, so every capture
 * claimed to have originated in the app even when the person was writing up a
 * meeting or relaying a WhatsApp message. That is not a cosmetic error: when a
 * variation is challenged, the question is who instructed it, where, and when,
 * and a record that says "mobile form" answers none of them.
 */

const base = {
  projectId: '11111111-1111-4111-8111-111111111111',
  title: 'Reception marble changed',
  description: 'Client asked for a different marble on the feature wall',
  eventDate: '2026-08-01',
};

describe('capture source', () => {
  it('accepts an in-person meeting with the room it was held in', () => {
    const parsed = potentialChangeCreateSchema.parse({
      ...base,
      sourceType: 'meeting',
      sourceLocation: 'Site office, Level 3',
      sourceOccurredAt: '2026-08-01T10:30',
    });

    expect(parsed.sourceType).toBe('meeting');
    expect(parsed.sourceLocation).toBe('Site office, Level 3');
    expect(parsed.sourceOccurredAt).toBeInstanceOf(Date);
  });

  it('accepts an online meeting, where the platform is the place', () => {
    const parsed = potentialChangeCreateSchema.parse({
      ...base,
      sourceType: 'meeting_online',
      sourceLocation: 'Microsoft Teams',
    });

    expect(parsed.sourceType).toBe('meeting_online');
    expect(parsed.sourceLocation).toBe('Microsoft Teams');
  });

  it('accepts WhatsApp, where the place is the group', () => {
    const parsed = potentialChangeCreateSchema.parse({
      ...base,
      sourceType: 'whatsapp',
      sourceLocation: 'DXB-001 Site Coordination',
    });

    expect(parsed.sourceType).toBe('whatsapp');
  });

  it('treats a blank "when were you told" as absent, not as the epoch', () => {
    // An empty datetime-local posts as ''. Coercing that to a Date gives
    // Invalid Date, and storing it would put the change in 1970.
    const parsed = potentialChangeCreateSchema.parse({ ...base, sourceOccurredAt: '' });

    expect(parsed.sourceOccurredAt).toBeUndefined();
  });

  it('keeps the two places apart', () => {
    const parsed = potentialChangeCreateSchema.parse({
      ...base,
      location: 'Reception, Level 2',
      sourceType: 'verbal',
      sourceLocation: 'Level 2 corridor, by the risers',
    });

    // Where the work is affected, and where you were standing when told.
    expect(parsed.location).toBe('Reception, Level 2');
    expect(parsed.sourceLocation).toBe('Level 2 corridor, by the risers');
  });

  it('still defaults to the mobile form when no channel is given', () => {
    expect(potentialChangeCreateSchema.parse(base).sourceType).toBe('mobile_form');
  });

  it('refuses a channel that is not a real one', () => {
    expect(
      potentialChangeCreateSchema.safeParse({ ...base, sourceType: 'telepathy' }).success,
    ).toBe(false);
  });
});
