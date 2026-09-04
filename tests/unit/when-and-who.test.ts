import { describe, expect, it } from 'vitest';
import { parseEventDate, parseInstructedBy } from '@/lib/reply-intent';
import { plannedDetailFields } from '@/services/capture-question.service';

/**
 * The two facts a claim is argued over: WHEN it happened and WHO asked for it.
 *
 * Both are asked on WhatsApp, and both arrive as whatever a man on a ladder
 * types with one hand. The job of these parsers is to understand that and
 * store one standard thing — a calendar date and a named party — because a
 * register full of "last monday" and "the mall guy" cannot be counted, sorted,
 * or put in front of a client.
 *
 * Friday 4 September 2026 throughout, so a weekday answer has a fixed truth.
 */
const FRIDAY = new Date(Date.UTC(2026, 8, 4));

function iso(text: string): string | null {
  const parsed = parseEventDate(text, FRIDAY);
  return parsed ? parsed.date.toISOString().slice(0, 10) : null;
}

describe('when did this happen', () => {
  it('reads the words people actually use for recent days', () => {
    expect(iso('today')).toBe('2026-09-04');
    expect(iso('this morning')).toBe('2026-09-04');
    expect(iso('yesterday')).toBe('2026-09-03');
    expect(iso('last night')).toBe('2026-09-03');
    expect(iso('the day before yesterday')).toBe('2026-09-02');
  });

  it('counts back, in digits or in words', () => {
    expect(iso('3 days ago')).toBe('2026-09-01');
    expect(iso('two days ago')).toBe('2026-09-02');
    expect(iso('a week ago')).toBe('2026-08-28');
    expect(iso('a couple of weeks back')).toBe('2026-08-21');
    expect(iso('last week')).toBe('2026-08-28');
  });

  it('reads a written date however it is spelt', () => {
    for (const written of [
      '23 Aug',
      '23rd August 2026',
      '23rd of August',
      'Aug 23',
      'August 23, 2026',
      '2026-08-23',
      '23/08/2026',
      '23.08.26',
    ]) {
      expect(iso(written), written).toBe('2026-08-23');
    }
  });

  it('day first, always — 10/08 is the tenth of August', () => {
    expect(iso('10/08/2026')).toBe('2026-08-10');
  });

  it('reads a day of the month', () => {
    expect(iso('the 3rd of this month')).toBe('2026-09-03');
    expect(iso('the 28th of last month')).toBe('2026-08-28');
  });

  it('rolls a bare ordinal back when that day has not come round yet', () => {
    // The 15th of September has not happened on the 4th, so he means August.
    // An event that is still in the future is not an event.
    expect(iso('the 15th')).toBe('2026-08-15');
    expect(iso('on the 2nd')).toBe('2026-09-02');
  });

  it('reads a weekday as the one just gone', () => {
    expect(iso('last monday')).toBe('2026-08-31');
    expect(iso('on wednesday')).toBe('2026-09-02');
    // Today IS Friday, so "last Friday" can only be the week before.
    expect(iso('last friday')).toBe('2026-08-28');
  });

  it('finds the date even when the sentence opens with another number', () => {
    expect(iso('2 rooms affected, it happened 23 Aug')).toBe('2026-08-23');
  });

  it('refuses a date in the future rather than starting a clock from it', () => {
    expect(iso('23 October 2026')).toBeNull();
    expect(iso('2026-12-01')).toBeNull();
  });

  it('does not read the vocabulary of the trade as a date', () => {
    // "1st fix" is on every fit-out programme ever written, and "sat" is a
    // word before it is a day. Neither may move a notice deadline.
    expect(iso('1st fix electrical is complete on the ceiling grid above reception')).toBeNull();
    expect(iso('the sun shade above the entrance was removed by the landlord team')).toBeNull();
  });

  it('clamps a month back rather than rolling it into the next one', () => {
    // Naive arithmetic turns 31 March minus a month into 3 March, which is a
    // deadline three days out from the one the claim actually has.
    const march = new Date(Date.UTC(2026, 2, 31));
    const parsed = parseEventDate('one month ago', march);
    expect(parsed?.date.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('leaves a vague answer unread instead of guessing at it', () => {
    expect(iso('sometime last month')).toBeNull();
  });
});

describe('who asked for this change', () => {
  it('standardises however the party is named', () => {
    expect(parseInstructedBy('the consultant')).toBe('Consultant');
    expect(parseInstructedBy('consultants')).toBe('Consultant');
    expect(parseInstructedBy('supervision consultant')).toBe('Consultant');
    expect(parseInstructedBy('mall management')).toBe('Landlord');
    expect(parseInstructedBy('civil defence')).toBe('Civil Defence');
    expect(parseInstructedBy('MEP')).toBe('MEP consultant');
  });

  it('keeps the name and the side he is on together', () => {
    expect(parseInstructedBy('Eng. Khalid from the consultant')).toBe('Eng. Khalid (Consultant)');
    expect(parseInstructedBy('Mr Ahmed')).toBe('Mr Ahmed');
  });

  it('takes a short answer at its word when it recognises nobody', () => {
    expect(parseInstructedBy('the guy from Meraas')).toBe('Guy from Meraas');
  });

  it('reads the label the follow-up puts on an answer', () => {
    const report = 'Reception ceiling has to drop 300mm\n\nRequested by: the mall fit-out team';
    expect(parseInstructedBy(report)).toBe('Mall fit-out team');
  });

  it('inside a report, only credits a party the sentence says instructed', () => {
    expect(
      parseInstructedBy(
        'We told the client the ceiling would not clear the ducts, so the consultant asked us to drop it 300mm at the reception desk',
      ),
    ).toBe('Consultant');
  });

  it('will not attribute a change to whoever the report happens to mention', () => {
    // A wrong attribution is worse than an empty field: nobody goes back and
    // re-checks a field that is already filled in.
    expect(
      parseInstructedBy(
        'We told the client the ceiling would not clear the ducts and moved the grid across to suit the new layout',
      ),
    ).toBeNull();
  });

  it('is not fooled by courtesy or an empty message', () => {
    expect(parseInstructedBy('ok thanks')).toBeNull();
    expect(parseInstructedBy('[MEDIA ONLY]')).toBeNull();
    expect(parseInstructedBy('   ')).toBeNull();
  });
});

describe('what gets asked, and in what order', () => {
  it('asks work status, then when, then who', () => {
    expect(
      plannedDetailFields({
        text: 'reception ceiling has to drop 300mm',
        eventDateKnown: false,
        documentReferenceKnown: true,
        workStatusKnown: false,
        instructedByKnown: false,
      }),
    ).toEqual(['work_status', 'event_date', 'instructed_by']);
  });

  it('asks nothing it can already read out of the report', () => {
    expect(
      plannedDetailFields({
        text: 'the consultant asked us yesterday to drop the ceiling, not started',
        eventDateKnown: true,
        documentReferenceKnown: true,
        workStatusKnown: true,
        instructedByKnown: true,
      }),
    ).toEqual([]);
  });

  it('only asks for a drawing when the report is about one', () => {
    expect(
      plannedDetailFields({
        text: 'ceiling drops per the revised drawing',
        eventDateKnown: true,
        documentReferenceKnown: false,
        workStatusKnown: true,
        instructedByKnown: true,
      }),
    ).toEqual(['document_reference']);
  });
});
