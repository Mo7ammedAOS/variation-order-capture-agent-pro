import { formatDate } from '@/lib/dates';

/**
 * The words of a notice.
 *
 * ── Why this is a pure function, and lives in lib/ ─────────────────────────
 * A notice is the most consequential text this system produces: it states a
 * contractual position in the company's name and starts a clock that decides
 * whether money is recoverable. So it is rendered by a function with no
 * database, no network and no clock of its own — every fact arrives as an
 * argument, which means the exact text can be asserted in a test, and two
 * people looking at the same change get the same words.
 *
 * ── It is a DRAFT, always ──────────────────────────────────────────────────
 * Nothing here decides entitlement, quantifies a claim, or asserts a cost or
 * time effect. It says what happened, when, who instructed it, and that the
 * contractor reserves its position — then a human edits it and two seats
 * approve it. Wording that concedes or claims is a commercial judgement, and
 * the system has no business making one.
 *
 * ── No em dashes, no smart quotes ──────────────────────────────────────────
 * This text is pasted into email clients and PDF viewers of unknown vintage,
 * and a mangled character in a contractual notice is an argument about whether
 * the notice was legible. Plain ASCII punctuation only.
 */

export interface NoticeFacts {
  companyName: string;
  projectCode: string;
  projectName: string;
  contractNumber: string | null;
  clientName: string;
  recipientName: string | null;
  recipientCompany: string | null;
  clauseReference: string | null;
  noticePeriodDays: number;
  pcNumber: string;
  reference: string;
  title: string;
  description: string;
  eventDate: Date;
  location: string | null;
  trade: string | null;
  instructedBy: string | null;
  instructionSource: string | null;
  potentialTimeImpact: boolean;
  /** The day the notice is drafted. Passed in, never read from the clock. */
  noticeDate: Date;
}

export interface RenderedNotice {
  subject: string;
  body: string;
}

function line(label: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return `${label}: ${value}`;
}

export function renderNotice(facts: NoticeFacts): RenderedNotice {
  const subject =
    `Notice of a potential variation - ${facts.reference} - ` +
    `${facts.projectCode} ${facts.projectName} - ${facts.title}`;

  const clause = facts.clauseReference
    ? `pursuant to clause ${facts.clauseReference} of the Contract`
    : 'pursuant to the Contract';

  const header = [
    line('Our reference', facts.reference),
    line('Internal reference', facts.pcNumber),
    line('Project', `${facts.projectCode} ${facts.projectName}`),
    line('Contract', facts.contractNumber),
    line('Employer / Client', facts.clientName),
    line('Date of this notice', formatDate(facts.noticeDate)),
  ].filter(Boolean) as string[];

  const salutation = facts.recipientName
    ? `Dear ${facts.recipientName},`
    : 'Dear Sirs,';

  const circumstance = [
    line('Date of the event', formatDate(facts.eventDate)),
    line('Location', facts.location),
    line('Trade', facts.trade),
    line('Instructed or raised by', facts.instructedBy),
    line('How it reached us', facts.instructionSource),
  ].filter(Boolean) as string[];

  // The time reservation is stated only when the change was actually flagged
  // as having a possible programme effect. Reserving on every notice trains
  // the recipient to ignore the paragraph, which is the opposite of the point.
  const timeParagraph = facts.potentialTimeImpact
    ? 'This matter may also affect the completion date. We reserve our position ' +
      'in respect of any extension of time and any associated cost, and will ' +
      'submit particulars once the effect can be assessed.'
    : 'Any effect on the completion date will be notified separately if one arises.';

  const body = [
    header.join('\n'),
    '',
    salutation,
    '',
    `NOTICE OF A POTENTIAL VARIATION - ${facts.title.toUpperCase()}`,
    '',
    `We give notice ${clause} that the matter described below is considered to ` +
      'be, or to give rise to, a variation to the Contract works.',
    '',
    'THE CIRCUMSTANCE',
    circumstance.join('\n'),
    '',
    'WHAT HAPPENED',
    facts.description.trim(),
    '',
    'OUR POSITION',
    'This notice is given to preserve our entitlement within the period required ' +
      `by the Contract (${facts.noticePeriodDays} days from the date of the event). ` +
      'It is a notice only. It is not a claim, it does not quantify any cost or ' +
      'time effect, and it does not confirm that the work will proceed.',
    '',
    timeParagraph,
    '',
    'WHAT WE ASK OF YOU',
    'Please confirm receipt of this notice, and confirm whether the work is to ' +
      'proceed. We will submit our detailed proposal once the scope is settled. ' +
      'Costs and programme effects continue to accrue until the matter is resolved.',
    '',
    'Yours faithfully,',
    facts.companyName,
  ].join('\n');

  return { subject, body };
}
