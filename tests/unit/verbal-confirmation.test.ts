import { describe, expect, it } from 'vitest';
import { restsOnVerbalInstruction } from '@/services/verbal-confirmation.service';
import { renderConfirmation, type ConfirmationFacts } from '@/lib/confirmation-template';
import { formatConfirmationReference } from '@/lib/pc-number';

/**
 * Confirmation of a verbal instruction.
 *
 * UAE Civil Code Art. 887: on a lump-sum muqawala a contractor generally
 * cannot recover for extra work without the employer's written agreement to
 * the work and to its price. These tests hold the two halves that decide
 * whether the product is any use on that point — when the flag fires, and what
 * the letter says.
 */

describe('when a change rests on nothing written', () => {
  const route = (instructionRoute: string | null, sourceType = 'mobile_form') =>
    restsOnVerbalInstruction({
      instructionRoute: instructionRoute as never,
      sourceType: sourceType as never,
    });

  it('fires on a verbal instruction', () => {
    expect(route('verbal')).toBe(true);
  });

  it('fires on a meeting, because minutes are not an instruction', () => {
    // Minutes are written afterwards by one side and are routinely disputed.
    expect(route('meeting')).toBe(true);
  });

  it('does NOT fire on WhatsApp', () => {
    // Written, timestamped, and the normal instruction channel on a UAE
    // fit-out. Flagging it would raise a warning on most of the register and
    // train everybody to ignore the warning.
    expect(route('whatsapp')).toBe(false);
  });

  it('does not fire on a site instruction, a drawing or an email', () => {
    expect(route('site_instruction')).toBe(false);
    expect(route('drawing')).toBe(false);
    expect(route('email')).toBe(false);
  });

  it('falls back to how the report arrived when the route is unknown', () => {
    expect(route(null, 'verbal')).toBe(true);
    expect(route(null, 'meeting')).toBe(true);
    expect(route(null, 'meeting_online')).toBe(true);
    expect(route(null, 'mobile_form')).toBe(false);
  });

  it('prefers the stated route over the channel it arrived on', () => {
    // Somebody typed it into the web form, but said it came by signed SI. The
    // stated route is the better fact and wins.
    expect(route('site_instruction', 'mobile_form')).toBe(false);
    // And the other way: filed from the form, stated as verbal.
    expect(route('verbal', 'mobile_form')).toBe(true);
  });
});

describe('the reference', () => {
  it('uses CVI, which cannot be mistaken for a notice at a glance', () => {
    expect(formatConfirmationReference('DXB-001', 4)).toBe('CVI-DXB-001-0004');
  });

  it('refuses a bad project code rather than producing a bad reference', () => {
    expect(() => formatConfirmationReference('dxb 001', 1)).toThrow();
  });
});

const base: ConfirmationFacts = {
  companyName: 'ABC Fit-Out LLC',
  projectCode: 'DXB-001',
  projectName: 'DIFC Gate Avenue Office Fit-Out',
  contractNumber: 'C-2026-114',
  clientName: 'Gate Avenue Developments',
  recipientName: 'Mr Khalid',
  recipientCompany: 'Gate Avenue Developments',

  reference: 'CVI-DXB-001-0004',
  pcNumber: 'PC-DXB-001-0012',
  title: 'Reception marble wall',
  description: 'Eng. Samir asked on the walk for marble instead of paint.',

  eventDate: new Date('2026-08-14T00:00:00Z'),
  letterDate: new Date('2026-09-12T00:00:00Z'),
  location: 'Reception, Level 2',
  trade: 'Joinery',
  instructedBy: 'Eng. Samir, supervision consultant',
  sourceLocation: 'Site walk, Level 2',

  workStarted: false,
  responseDays: 14,
};

describe('the letter', () => {
  it('names who gave the instruction, when, and where it was said', () => {
    const { body } = renderConfirmation(base);
    expect(body).toContain('Given by: Eng. Samir, supervision consultant');
    expect(body).toContain('Given at: Site walk, Level 2');
    expect(body).toContain('Date of the instruction: 14 Aug 2026');
  });

  it('records, and explicitly does not claim', () => {
    // A letter that argues invites a reply arguing back. The point is to get a
    // confirmation, not to open a correspondence.
    const { body } = renderConfirmation(base);
    expect(body).toContain('This letter is a record and not a claim.');
    expect(body).toContain('No cost or time effect is asserted here');
  });

  it('asks for a written reply within the contract response window', () => {
    expect(renderConfirmation(base).body).toContain(
      'within 14 days of the date of this letter',
    );
  });

  it('still asks for a reply when no window is configured', () => {
    const { body } = renderConfirmation({ ...base, responseDays: null });
    expect(body).toContain('at your earliest convenience');
    expect(body).not.toContain('null days');
  });

  it('says plainly when work has already started', () => {
    // The fact that makes the letter urgent, and the paragraph that answers a
    // later argument that the work was unauthorised.
    const { body } = renderConfirmation({ ...base, workStarted: true });
    expect(body).toContain('has been put in hand on the basis of that instruction');
  });

  it('says only that we are proceeding when work has not started', () => {
    const { body } = renderConfirmation(base);
    expect(body).toContain('We are proceeding on the basis of that instruction.');
    expect(body).not.toContain('put in hand');
  });

  it('invites a correction, which is what makes silence useful later', () => {
    expect(renderConfirmation(base).body).toContain(
      'we would rather correct it now than rely on it later',
    );
  });

  it('falls back to a generic giver rather than leaving a blank', () => {
    const { body } = renderConfirmation({ ...base, instructedBy: null });
    expect(body).toContain('Given by: your representative on site');
  });

  it('names the letter in the subject so it files itself', () => {
    expect(renderConfirmation(base).subject).toBe(
      'Confirmation of verbal instruction - CVI-DXB-001-0004 - DXB-001 DIFC Gate Avenue Office Fit-Out - Reception marble wall',
    );
  });

  it('uses no em dashes or smart quotes', () => {
    const { body, subject } = renderConfirmation(base);
    for (const text of [body, subject]) {
      expect(text).not.toMatch(/[–—‘’“”]/);
    }
  });
});
