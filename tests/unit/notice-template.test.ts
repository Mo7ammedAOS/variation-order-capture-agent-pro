import { describe, expect, it } from 'vitest';
import { renderNotice, type NoticeFacts } from '@/lib/notice-template';
import { renderTextPdf, textToPdfLines, wrapText } from '@/lib/pdf';
import { formatNoticeReference } from '@/lib/pc-number';

/**
 * The one document in this system that may end up in front of a tribunal.
 *
 * What is tested here is not that it reads well. It is that it does not
 * OVERCLAIM: a generated notice that quantifies a cost, concedes a position,
 * or asserts an extension of time nobody has assessed would be worse than no
 * notice at all, because it would be signed by two directors who trusted it.
 */

function facts(overrides: Partial<NoticeFacts> = {}): NoticeFacts {
  return {
    companyName: 'ABC Fit-Out LLC',
    projectCode: 'DXB-001',
    projectName: 'Dubai Office Fit-Out',
    contractNumber: 'C-2026-11',
    clientName: 'Emaar Properties',
    recipientName: 'Ms Layla Haddad',
    recipientCompany: 'Emaar Properties',
    clauseReference: '13.3',
    noticePeriodDays: 28,
    pcNumber: 'PC-DXB-001-0042',
    reference: 'NOT-DXB-001-0007',
    title: 'Reception marble wall changed to porcelain',
    description: 'The consultant instructed a change of finish at the reception feature wall.',
    eventDate: new Date('2026-08-14T00:00:00Z'),
    location: 'Reception, Level 2',
    trade: 'Joinery',
    instructedBy: 'Ms Layla Haddad',
    instructionSource: 'site instruction',
    potentialTimeImpact: false,
    noticeDate: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

describe('the notice a director signs', () => {
  it('carries the references, the clause and both dates', () => {
    const { subject, body } = renderNotice(facts());

    expect(subject).toContain('NOT-DXB-001-0007');
    expect(body).toContain('PC-DXB-001-0042');
    expect(body).toContain('clause 13.3');
    expect(body).toContain('14 Aug 2026'); // the event
    expect(body).toContain('01 Sep 2026'); // the notice
    expect(body).toContain('28 days from the date of the event');
    expect(body).toContain('ABC Fit-Out LLC');
  });

  it('states plainly that it is a notice and not a claim', () => {
    const { body } = renderNotice(facts());

    expect(body).toContain('It is a notice only');
    expect(body).toContain('does not quantify any cost or time effect');
    // Nothing that reads as a number owed.
    expect(body).not.toMatch(/AED|\$|amount claimed/i);
  });

  it('reserves time only when a time effect was actually flagged', () => {
    const silent = renderNotice(facts({ potentialTimeImpact: false })).body;
    const reserved = renderNotice(facts({ potentialTimeImpact: true })).body;

    expect(silent).not.toContain('extension of time');
    expect(reserved).toContain('extension of time');
  });

  it('falls back to the contract when no clause is recorded', () => {
    const { body } = renderNotice(facts({ clauseReference: null }));

    expect(body).toContain('pursuant to the Contract');
    expect(body).not.toContain('clause null');
    expect(body).not.toContain('undefined');
  });

  it('addresses the reader by name, or as Sirs when nobody is named', () => {
    expect(renderNotice(facts()).body).toContain('Dear Ms Layla Haddad,');
    expect(renderNotice(facts({ recipientName: null })).body).toContain('Dear Sirs,');
  });

  it('never renders an em dash, which mangles in older mail clients', () => {
    const { subject, body } = renderNotice(facts());
    expect(`${subject}${body}`).not.toMatch(/[–—‘’“”]/);
  });
});

describe('the notice reference series', () => {
  it('is its own series, padded, and never collides with a PC number', () => {
    expect(formatNoticeReference('DXB-001', 7)).toBe('NOT-DXB-001-0007');
    expect(formatNoticeReference('DXB-001', 7)).not.toContain('PC-');
  });

  it('refuses a sequence that has not been allocated', () => {
    expect(() => formatNoticeReference('DXB-001', 0)).toThrow();
  });
});

describe('the PDF that gets filed', () => {
  it('produces a readable PDF carrying the notice text', () => {
    const { body } = renderNotice(facts());
    const pdf = renderTextPdf(textToPdfLines(body));

    const head = pdf.subarray(0, 8).toString('latin1');
    expect(head.startsWith('%PDF-1.4')).toBe(true);

    const text = pdf.toString('latin1');
    expect(text).toContain('NOT-DXB-001-0007');
    expect(text).toContain('startxref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('runs onto more pages rather than dropping the end of a long notice', () => {
    const long = Array.from({ length: 300 }, (_, i) => `Line ${i + 1} of the notice.`).join('\n');
    const pdf = renderTextPdf(textToPdfLines(long)).toString('latin1');

    expect(pdf).toContain('Line 1 of the notice.');
    expect(pdf).toContain('Line 300 of the notice.');
    expect(pdf).toMatch(/\/Count [2-9]/);
  });

  it('escapes the characters that would otherwise corrupt the file', () => {
    const pdf = renderTextPdf([{ text: 'Cost (approx) 50% \\ per m2' }]).toString('latin1');
    expect(pdf).toContain('\\(approx\\)');
    expect(pdf).toContain('\\\\');
  });

  it('wraps a long line instead of running it off the page', () => {
    const lines = wrapText('word '.repeat(200).trim());
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length < 140)).toBe(true);
  });

  it('breaks a single unbreakable token rather than looping forever', () => {
    const lines = wrapText('A'.repeat(500));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('A'.repeat(500));
  });
});
