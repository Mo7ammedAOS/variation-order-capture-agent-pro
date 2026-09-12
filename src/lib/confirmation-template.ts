import { formatDate } from '@/lib/dates';

/**
 * Confirmation of a verbal instruction.
 *
 * ── Why this letter is the most commercially valuable page in the product ──
 * UAE Civil Code Article 887 governs the muqawala. On a lump-sum contract a
 * contractor generally cannot recover for extra work, however genuinely it was
 * instructed, without the employer's written agreement to the work AND to its
 * price. A verbal instruction is therefore worth close to nothing on its own,
 * and site staff receive them constantly: the consultant says do it now,
 * everybody does, and nine months later there is no document.
 *
 * This letter closes that gap in the only way available to a contractor. It
 * states, in writing, what was said, by whom, when and where, says the work is
 * proceeding on that basis, and asks the other side to confirm. Silence in
 * reply is not agreement in law, but a contemporaneous unanswered letter is a
 * far stronger position than a memory, and this one is dated and delivered
 * through a system that records the delivery.
 *
 * ── What it must never do ──────────────────────────────────────────────────
 * It does not claim, does not price, and does not assert entitlement. It
 * records. The moment a letter like this argues, it invites a reply arguing
 * back, and the point is to obtain a confirmation rather than to open a
 * correspondence.
 *
 * ── Pure, like the other two templates ─────────────────────────────────────
 * No database, no network, no clock. Every fact is an argument, so the exact
 * wording can be asserted in a test.
 *
 * ── No em dashes, no smart quotes ──────────────────────────────────────────
 * Same rule as the notice. A mangled character in a contractual letter is an
 * argument about whether it was legible.
 */

export interface ConfirmationFacts {
  companyName: string;
  projectCode: string;
  projectName: string;
  contractNumber: string | null;
  clientName: string;
  recipientName: string | null;
  recipientCompany: string | null;

  reference: string;
  pcNumber: string;
  title: string;
  description: string;

  /** When the instruction was given, which is not when we wrote this down. */
  eventDate: Date;
  /** The day this letter is drafted. Passed in, never read from the clock. */
  letterDate: Date;
  location: string | null;
  trade: string | null;
  /** The person who gave the instruction. The single most important fact. */
  instructedBy: string | null;
  /** Where the words were said: a site walk, a meeting, a phone call. */
  sourceLocation: string | null;

  /** Whether the work has already started, which changes the closing. */
  workStarted: boolean;
  /** Days the contract allows for a response, if the rules state one. */
  responseDays: number | null;
}

export interface RenderedConfirmation {
  subject: string;
  body: string;
}

function line(label: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return `${label}: ${value}`;
}

export function renderConfirmation(facts: ConfirmationFacts): RenderedConfirmation {
  const subject =
    `Confirmation of verbal instruction - ${facts.reference} - ` +
    `${facts.projectCode} ${facts.projectName} - ${facts.title}`;

  const header = [
    line('Our reference', facts.reference),
    line('Internal reference', facts.pcNumber),
    line('Project', `${facts.projectCode} ${facts.projectName}`),
    line('Contract', facts.contractNumber),
    line('Employer / Client', facts.clientName),
    line('Date of this letter', formatDate(facts.letterDate)),
  ].filter(Boolean) as string[];

  const salutation = facts.recipientName ? `Dear ${facts.recipientName},` : 'Dear Sirs,';

  const circumstance = [
    line('Date of the instruction', formatDate(facts.eventDate)),
    line('Given by', facts.instructedBy ?? 'your representative on site'),
    line('Given at', facts.sourceLocation),
    line('Location of the work', facts.location),
    line('Trade', facts.trade),
  ].filter(Boolean) as string[];

  /*
    Work already started is stated plainly rather than softened. It is the fact
    that makes the letter urgent, and a recipient who later argues the work was
    unauthorised will be answered with this paragraph and its date.
  */
  const position = facts.workStarted
    ? 'The work described above has been put in hand on the basis of that ' +
      'instruction, in order to avoid delay to the works.'
    : 'We are proceeding on the basis of that instruction.';

  const byWhen = facts.responseDays
    ? `within ${facts.responseDays} days of the date of this letter`
    : 'at your earliest convenience';

  const body = [
    ...header,
    '',
    salutation,
    '',
    'CONFIRMATION OF A VERBAL INSTRUCTION',
    '',
    'We write to record an instruction given verbally, which has not been ' +
      'confirmed in writing.',
    '',
    'THE INSTRUCTION',
    ...circumstance,
    '',
    'What we understood the instruction to be:',
    facts.description,
    '',
    position,
    '',
    'WHY WE ARE WRITING',
    'This letter is a record and not a claim. No cost or time effect is ' +
      'asserted here, and any such effect will be notified and submitted ' +
      'separately in accordance with the Contract.',
    '',
    `Please confirm in writing ${byWhen} that the above is a correct record of ` +
      'your instruction, or advise us if it is not. If any part of this record ' +
      'is inaccurate we would rather correct it now than rely on it later.',
    '',
    'Yours faithfully,',
    '',
    facts.companyName,
  ].join('\n');

  return { subject, body };
}
