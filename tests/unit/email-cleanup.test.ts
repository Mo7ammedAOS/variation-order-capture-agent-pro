import { describe, expect, it } from 'vitest';
import { cleanCapturedText } from '@/lib/email-cleanup';

/**
 * Getting the report out of the email.
 *
 * The asymmetry that shapes every test here: a signature left in is untidy and
 * costs nothing. A report cut out is a lost variation, and nobody notices until
 * the money is gone. So the bar for deleting is high, and most of these tests
 * are about text the cleaner must NOT touch.
 */

describe('what gets cut', () => {
  it('cuts the signature at the standard delimiter', () => {
    // The real first capture from production, verbatim.
    const raw = [
      'client asks to change back yard design',
      '',
      'client ask to change back yard design and new stones',
      '',
      '-- ',
      '',
      'Mohammed Osman',
      '',
      'Structural Engineer | Python Developer',
      '',
      'www…',
    ].join('\n');

    const { text, removed } = cleanCapturedText(raw);
    expect(text).toBe(
      'client asks to change back yard design\n\nclient ask to change back yard design and new stones',
    );
    expect(removed).toContain('signature');
  });

  it('cuts a quoted reply header', () => {
    const raw = [
      'Yes, go ahead with the marble.',
      '',
      'On 1 Sep 2026 at 09:14, VO Capture <vo@example.com> wrote:',
      '> This looks like DXB-002.',
      '> Reply YES to file it there.',
    ].join('\n');

    expect(cleanCapturedText(raw).text).toBe('Yes, go ahead with the marble.');
  });

  it('cuts an Outlook quoted block', () => {
    const raw = [
      'The ceiling grid is wrong on level 2.',
      '',
      'From: Ahmed Rashid',
      'Sent: Monday, 1 September 2026 09:14',
      'To: Site Team',
      'Subject: RE: Level 2',
      '',
      'Please check the RCP.',
    ].join('\n');

    expect(cleanCapturedText(raw).text).toBe('The ceiling grid is wrong on level 2.');
  });

  it('cuts a mail client footer', () => {
    const raw = 'Wall came down this morning.\n\nSent from my iPhone';
    expect(cleanCapturedText(raw).text).toBe('Wall came down this morning.');
  });

  it('cuts a confidentiality disclaimer', () => {
    const raw = [
      'Client wants two extra sockets in reception.',
      '',
      'This e-mail and any attachments are confidential and intended solely for the',
      'addressee. If you have received it in error please notify the sender.',
    ].join('\n');

    const { text, removed } = cleanCapturedText(raw);
    expect(text).toBe('Client wants two extra sockets in reception.');
    expect(removed).toContain('disclaimer');
  });

  it('drops a trailing link and phone number with no delimiter to cut at', () => {
    const raw = ['Marble instead of paint.', '', 'Ahmed Rashid', '+971 50 123 4567', 'www.example.com'].join('\n');
    expect(cleanCapturedText(raw).text).toBe('Marble instead of paint.\n\nAhmed Rashid');
  });

  it('takes the EARLIEST cut when a mail carries several', () => {
    const raw = [
      'Approved, proceed.',
      '',
      '-- ',
      'Ahmed',
      '',
      'On 1 Sep 2026, someone <a@b.com> wrote:',
      '> the original question',
    ].join('\n');

    expect(cleanCapturedText(raw).text).toBe('Approved, proceed.');
  });
});

describe('what must survive', () => {
  it('leaves a plain report alone', () => {
    const raw = 'Client wants the reception wall moved 400mm. Please advise.';
    const { text, removed } = cleanCapturedText(raw);
    expect(text).toBe(raw);
    expect(removed).toEqual([]);
  });

  it('does not read a sentence ending "wrote:" as a quote header', () => {
    // No date, no address — it is somebody describing what happened.
    const raw = 'The consultant wrote:\nmove the wall 400mm and use marble.';
    expect(cleanCapturedText(raw).text).toBe(raw);
  });

  it('does not read "From: the client" as an Outlook header', () => {
    // The danger case. Nothing beneath it looks like a mail header, so the
    // whole report must survive.
    const raw = 'From: the client, verbally on site today.\nThey want the wall moved.';
    expect(cleanCapturedText(raw).text).toBe(raw);
  });

  it('does not eat a sentence that merely starts like a disclaimer', () => {
    const raw = 'This message is short.';
    expect(cleanCapturedText(raw).text).toBe(raw);
  });

  it('keeps a dash line that is not the delimiter', () => {
    const raw = 'Options:\n---\nMarble or paint.';
    expect(cleanCapturedText(raw).text).toBe(raw);
  });

  it('returns the ORIGINAL when cleaning would empty the message', () => {
    // A one line report that happens to look like a footer. Better untidy
    // than gone: an empty description is a variation nobody can assess.
    const raw = 'Sent from my iPhone';
    const { text, removed } = cleanCapturedText(raw);
    expect(text).toBe('Sent from my iPhone');
    expect(removed).toEqual([]);
  });

  it('handles an empty message without throwing', () => {
    expect(cleanCapturedText('').text).toBe('');
    expect(cleanCapturedText('   ').text).toBe('   ');
  });

  it('normalises Windows line endings and collapses blank runs', () => {
    const raw = 'Line one.\r\n\r\n\r\n\r\nLine two.';
    expect(cleanCapturedText(raw).text).toBe('Line one.\n\nLine two.');
  });
});

describe('why it runs before project matching', () => {
  it('removes a signature that would otherwise name the wrong client', () => {
    // "Al Futtaim Contracting" in a job title would match a client name and
    // have the system propose a project the message was never about.
    const raw = [
      'Client wants the wall moved 400mm.',
      '',
      '-- ',
      'Ahmed Rashid',
      'Site Engineer | Al Futtaim Contracting LLC',
    ].join('\n');

    const { text } = cleanCapturedText(raw);
    expect(text).not.toContain('Futtaim');
    expect(text).toContain('wall moved');
  });
});
