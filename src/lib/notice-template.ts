import { formatDate } from '@/lib/dates';
import { type PdfBlock, type PdfDocument, wrapText } from '@/lib/pdf';

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
  /**
   * Professional prose for the account of what happened, written by the model
   * from the reporter's own words.
   *
   * Optional, and the absence of it is a supported path rather than a
   * degraded one: with no narrative the notice quotes `description` exactly as
   * reported, which is what it did before and what it falls back to whenever
   * the model is unavailable, slow, or returns something that fails
   * validation. A notice must never fail to exist because a third party is
   * having a bad afternoon.
   */
  narrative?: string | null;
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
    (facts.narrative ?? facts.description).trim(),
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

/* ─────────────────────────── the printed notice ──────────────────────────── */

/**
 * The notice as a designed document rather than a typed page.
 *
 * ── It prints the STORED BODY, never a re-render from the facts ───────────
 * The body is edited by a person and approved by two seats. That edited text
 * IS the notice; anything else on the page would be a different document
 * wearing the same reference. So this reads the same plain text that was
 * approved and only decides how it looks — which means a wording change can
 * never fail to reach the PDF, and the PDF can never say something nobody
 * approved.
 *
 * ── How it knows what is what ─────────────────────────────────────────────
 * Two conventions the template above already writes, and nothing else:
 *
 *   A LINE IN CAPITALS      a section heading
 *   Label: value            a reference line, set in two columns
 *
 * Both are how the letter is written anyway, so the two files stay in step
 * without either importing the other's idea of structure. A hand-edited body
 * that abandons the conventions still prints correctly, just as prose.
 *
 * ── Why the layout carries meaning ────────────────────────────────────────
 *   the company name, large, at the top   this came from a company
 *   NOTICE, small and letter-spaced       what it is, before the words
 *   a two-column reference block          what a commercial team files by
 *   grey small-caps headings              scannable by someone after one fact
 *   a footer with the reference           a page separated from the bundle is
 *                                         still identifiable, which matters
 *                                         because notices get photocopied
 */
export function noticeLetterPdf(
  body: string,
  meta: { companyName: string; documentType?: string; footer: string },
): PdfDocument {
  const blocks: PdfBlock[] = [];

  blocks.push({ kind: 'text', text: meta.companyName, size: 17, bold: true, after: 2 });
  blocks.push({
    kind: 'text',
    text: (meta.documentType ?? 'NOTICE OF A POTENTIAL VARIATION').toUpperCase(),
    size: 8,
    tracked: true,
    color: [0.42, 0.45, 0.52],
    after: 10,
  });
  blocks.push({ kind: 'rule', thickness: 1.2, color: [0.07, 0.09, 0.15], after: 14 });

  // A reference line only counts while we are still in the block at the top.
  // After the first paragraph, "Location: reception" is prose that happens to
  // contain a colon, and setting it in two columns would look like a mistake.
  let inReferenceBlock = true;

  for (const raw of body.split('\n')) {
    const text = raw.trimEnd();

    if (text.trim() === '') {
      blocks.push({ kind: 'space', height: 6 });
      continue;
    }

    const isHeading = text === text.toUpperCase() && /[A-Z]/.test(text);
    if (isHeading) {
      inReferenceBlock = false;
      blocks.push({ kind: 'keepWithNext' });
      blocks.push({ kind: 'space', height: 8 });
      blocks.push({
        kind: 'text',
        text,
        size: 8,
        bold: true,
        tracked: true,
        color: [0.31, 0.35, 0.44],
        after: 3,
      });
      continue;
    }

    const field = text.match(/^([A-Z][A-Za-z /]{2,30}):\s+(.+)$/);
    if (field?.[1] && field[2]) {
      blocks.push({ kind: 'field', label: field[1], value: field[2] });
      continue;
    }

    if (inReferenceBlock && text.startsWith('Dear ')) inReferenceBlock = false;

    for (const wrapped of wrapText(text)) {
      blocks.push({ kind: 'text', text: wrapped, size: 10 });
    }
  }

  return { blocks, footer: meta.footer };
}
