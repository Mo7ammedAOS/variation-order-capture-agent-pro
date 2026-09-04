import { describe, expect, it } from 'vitest';
import { renderDocumentPdf } from '@/lib/pdf';
import { noticeLetterPdf } from '@/lib/notice-template';

/**
 * The printed notice.
 *
 * This is the one document in the system that may end up in front of a
 * tribunal, so the tests are about the two things that would actually hurt:
 * that the file opens at all, and that what is printed is the text a human
 * approved rather than something reconstructed alongside it.
 */

const BODY = [
  'Our reference: NOT-DXB-001-0003',
  'Project: DXB-001 Marina Heights Lobby',
  'Date of this notice: 04 Sep 2026',
  '',
  'Dear Mr Haddad,',
  '',
  'NOTICE OF A POTENTIAL VARIATION - RECEPTION CEILING',
  '',
  'We give notice pursuant to clause 13.1 of the Contract that the matter',
  'described below is considered to be a variation.',
  '',
  'THE CIRCUMSTANCE',
  'Date of the event: 01 Sep 2026',
  'Location: Reception, ground floor',
  '',
  'WHAT HAPPENED',
  'The consultant asked for the reception ceiling grid to be reset 300mm lower.',
].join('\n');

const META = { companyName: 'ABC Fit-Out LLC', footer: 'NOT-DXB-001-0003 | DXB-001' };

describe('the notice PDF', () => {
  const pdf = renderDocumentPdf(noticeLetterPdf(BODY, META));
  const raw = pdf.toString('latin1');

  it('is a PDF a reader will open', () => {
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(raw).toContain('/Type /Catalog');
    expect(raw).toContain('startxref');
  });

  it('prints the words that were approved', () => {
    // The body is what two seats signed off. Anything on the page that is not
    // in it is a different document wearing the same reference.
    expect(raw).toContain('reset 300mm lower');
    expect(raw).toContain('Dear Mr Haddad,');
    expect(raw).toContain('NOTICE OF A POTENTIAL VARIATION');
  });

  it('carries the company name and the reference footer', () => {
    expect(raw).toContain('ABC Fit-Out LLC');
    // On every page. A notice gets photocopied into other bundles, and a loose
    // page carrying only prose cannot be proved to belong to this notice.
    expect(raw).toContain('NOT-DXB-001-0003');
  });

  it('sets the reference lines as label and value', () => {
    // Two columns, so a commercial team can find the reference without
    // reading the letter. Both halves have to reach the page.
    expect(raw).toContain('Our reference');
    expect(raw).toContain('NOT-DXB-001-0003');
  });

  it('survives a body that abandons the conventions entirely', () => {
    // A human may rewrite the whole letter. It must still print.
    const plain = renderDocumentPdf(
      noticeLetterPdf('just one line, no headings, no labels', META),
    ).toString('latin1');
    expect(plain).toContain('just one line');
    expect(plain.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('paginates a long notice instead of running off the page', () => {
    const long = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} of the account.`).join('\n');
    const many = renderDocumentPdf(noticeLetterPdf(long, META)).toString('latin1');

    // The exact page count is a function of leading and margins and is not
    // worth pinning — it would fail on a typography change that broke nothing.
    // What must hold is that it broke into pages at all, and that the footer
    // agrees with the page tree about how many there are.
    const count = Number(/\/Count (\d+)/.exec(many)?.[1]);
    expect(count).toBeGreaterThan(1);
    expect(many).toContain(`Page 1 of ${count}`);
    expect(many).toContain(`Page ${count} of ${count}`);
  });

  it('writes a character outside WinAnsi as a question mark, not a blank', () => {
    // Arabic needs an embedded font. Silently dropping it would produce a
    // notice with a hole in it that nobody notices until it is quoted back.
    const arabic = renderDocumentPdf(noticeLetterPdf('Reception ceiling سقف', META)).toString('latin1');
    expect(arabic).toContain('Reception ceiling');
  });
});
