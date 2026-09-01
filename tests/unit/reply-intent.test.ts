import { describe, expect, it } from 'vitest';
import {
  closingLine,
  isNewChangeRequest,
  isPleasantry,
  looksEvidenceOnly,
  mentionsDocument,
  parseDocumentReference,
  parseEventDate,
  parseWorkStatus,
} from '@/lib/reply-intent';

/**
 * These functions decide whether a message becomes a claim.
 *
 * So the tests are weighted the way the code is: a handful prove the friendly
 * behaviour works, and most of them prove it cannot eat a real report. The
 * asymmetry is deliberate. A junk record titled "thanks" is an annoyance
 * somebody closes in a second; a report read as courtesy is gone, and nobody
 * finds out until the notice period has run.
 */

const TODAY = new Date(Date.UTC(2026, 8, 1)); // 01 Sep 2026

describe('courtesy, and what is not courtesy', () => {
  it.each([
    'ok',
    'OK thanks',
    'thank you',
    'thanks very much',
    'noted',
    'perfect, thank you',
    'no thanks',
    'nothing else for now',
    'all good',
    'cheers',
    'shukran',
    '👍',
    '🙏🙏',
  ])('reads %j as the end of a conversation', (text) => {
    expect(isPleasantry(text)).toBe(true);
  });

  it.each([
    'client wants the wall moved',
    'ok the client changed the ceiling grid this morning',
    'thanks but the marble is wrong',
    'ok 2',
    'DXB-001',
    'no the ceiling is not per drawing',
  ])('refuses to read %j as courtesy', (text) => {
    expect(isPleasantry(text)).toBe(false);
  });

  it('never treats a media marker as courtesy, so the files still get placed', () => {
    expect(isPleasantry('[media only]')).toBe(false);
    expect(isPleasantry('[empty email]')).toBe(false);
  });
});

describe('a message that is files and nothing else', () => {
  it.each(['', '   ', '[media only]', '[empty email]', 'IMG_2043.jpg', 'scan 001.pdf'])(
    'reads %j as evidence with no report',
    (text) => {
      expect(looksEvidenceOnly(text)).toBe(true);
    },
  );

  it('a caption is a report, however short', () => {
    expect(looksEvidenceOnly('ceiling grid at reception')).toBe(false);
  });
});

describe('"new one"', () => {
  it.each(['new', 'new one', 'its a new one', 'separate change', 'another one'])(
    'reads %j as a new change',
    (text) => {
      expect(isNewChangeRequest(text)).toBe(true);
    },
  );

  it.each(['the new ceiling at reception is wrong and needs to come down', '2', 'yes'])(
    'refuses %j',
    (text) => {
      expect(isNewChangeRequest(text)).toBe(false);
    },
  );
});

describe('when it happened', () => {
  const on = (text: string) => parseEventDate(text, TODAY)?.date.toISOString().slice(0, 10);

  it('reads the words people actually use', () => {
    expect(on('it happened today')).toBe('2026-09-01');
    expect(on('yesterday afternoon')).toBe('2026-08-31');
    expect(on('3 days ago')).toBe('2026-08-29');
    expect(on('2 weeks ago')).toBe('2026-08-18');
    expect(on('last week')).toBe('2026-08-25');
  });

  it('reads a slashed date DAY FIRST, which is what UAE site staff write', () => {
    // Not the eighth of October. This project has already had one client
    // document misread the other way round.
    expect(on('10/08/2026')).toBe('2026-08-10');
    expect(on('28-8-26')).toBe('2026-08-28');
  });

  it('reads month names in either order', () => {
    expect(on('28 Aug')).toBe('2026-08-28');
    expect(on('28 August 2026')).toBe('2026-08-28');
    expect(on('Aug 28')).toBe('2026-08-28');
  });

  it('reads an ISO date', () => {
    expect(on('on 2026-08-14 the client instructed it')).toBe('2026-08-14');
  });

  it('refuses a future date rather than starting a clock from the wrong day', () => {
    // Day-first would make this the twenty eighth of September, which has not
    // happened. Asking again is cheaper than a deadline computed from fiction.
    expect(parseEventDate('28/09/2026', TODAY)).toBeNull();
    expect(parseEventDate('tomorrow', TODAY)).toBeNull();
  });

  it('refuses an impossible date', () => {
    expect(parseEventDate('31/02/2026', TODAY)).toBeNull();
  });

  it('says nothing when the message says nothing', () => {
    expect(parseEventDate('client wants the wall moved', TODAY)).toBeNull();
  });

  it('quotes back what it read, so a misreading is visible', () => {
    expect(parseEventDate('yesterday', TODAY)?.phrase).toBe('yesterday');
  });
});

describe('the drawing or instruction it comes from', () => {
  it('reads an explicit reference', () => {
    expect(parseDocumentReference('as per RFI 042')).toBe('RFI-042');
    expect(parseDocumentReference('see DWG AR-201')).toBe('DWG-AR-201');
  });

  it('reads a bare drawing number when the message is talking about drawings', () => {
    expect(parseDocumentReference('drawing AR-201 Rev C shows it differently')).toContain('AR-201');
  });

  it('refuses a bare code when nothing in the message is about a document', () => {
    expect(parseDocumentReference('AR-201')).toBeNull();
  });

  it('never records the project code as a drawing number', () => {
    // "AR-201" and "DXB-001" are the same shape, and a plausible wrong
    // reference on a claim is worse than an empty field.
    expect(parseDocumentReference('drawing for DXB-001 is wrong', ['DXB-001'])).not.toBe('DXB-001');
  });

  it('knows when a reference is worth asking for', () => {
    expect(mentionsDocument('the drawing shows a different layout')).toBe(true);
    expect(mentionsDocument('client asked for another socket')).toBe(false);
  });
});

describe('whether the work has started', () => {
  it.each([
    ['we already started it', 'in_progress'],
    ['work is in progress', 'in_progress'],
    ['not started yet', 'not_started'],
    ['it is on hold', 'on_hold'],
    ['already done', 'completed'],
  ])('reads %j as %s', (text, expected) => {
    expect(parseWorkStatus(text)).toBe(expected);
  });

  it('says nothing when the message says nothing', () => {
    expect(parseWorkStatus('client wants the wall moved')).toBeNull();
  });
});

describe('closing a conversation', () => {
  it('is stable for the same exchange and varies across exchanges', () => {
    expect(closingLine('AB12')).toBe(closingLine('AB12'));
    const lines = new Set(['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7'].map(closingLine));
    expect(lines.size).toBeGreaterThan(1);
  });
});
