import { formatDate } from '@/lib/dates';

/**
 * The variation order the client actually receives.
 *
 * ── Why this is not the notice ─────────────────────────────────────────────
 * A notice reserves a position: something happened, we are telling you inside
 * the window, we will quantify it later. A variation order is the opposite end
 * of the same story — here is the scope, here is the build-up, here is the
 * figure, please sign. Sending one when you meant the other is a commercial
 * mistake, so they are separate documents produced by separate functions with
 * different words.
 *
 * ── Pure, like the notice template, and for the same reason ────────────────
 * No database, no network, no clock. Every fact arrives as an argument, so the
 * exact text can be asserted in a test and two people looking at one variation
 * get the same page. The one thing this document must never do is compute: the
 * figures arrive already calculated by pricing.service, as strings, because a
 * rounding difference between the screen and the PDF is the kind of thing a
 * QS never fully trusts you about again.
 *
 * ── No em dashes, no smart quotes ──────────────────────────────────────────
 * Same rule as the notice. This is pasted into mail clients of unknown
 * vintage, and a mangled character in a priced document is an argument about
 * whether the figure was legible.
 */

export interface VoLineItem {
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  amount: string;
  rateSource: string;
  boqReference: string | null;
}

export interface VoFacts {
  companyName: string;
  projectCode: string;
  projectName: string;
  contractNumber: string | null;
  clientName: string;
  recipientName: string | null;
  recipientCompany: string | null;
  clauseReference: string | null;

  voNumber: string;
  pcNumber: string;
  title: string;
  /** The reporter's account, used only if there is no stated scope. */
  description: string;
  scopeOriginal: string | null;
  scopeRevised: string | null;

  eventDate: Date;
  /** The day the document is produced. Passed in, never read from the clock. */
  documentDate: Date;
  location: string | null;
  trade: string | null;
  instructedBy: string | null;
  instructionSource: string | null;

  lineItems: VoLineItem[];
  net: string;
  prelims: string;
  prelimsPercent: string | null;
  overheadProfit: string;
  overheadProfitPercent: string | null;
  total: string;
  currency: string;

  timeImpactDaysClaimed: number | null;
  timeImpactBasis: string | null;
}

export interface RenderedVo {
  subject: string;
  body: string;
}

function line(label: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return `${label}: ${value}`;
}

/** `1,250.00` from `1250`. The PDF has no layout engine to align on. */
function money(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  return `${currency} ${n.toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function renderVariationOrder(facts: VoFacts): RenderedVo {
  const subject =
    `Variation order ${facts.voNumber} - ` +
    `${facts.projectCode} ${facts.projectName} - ${facts.title}`;

  const clause = facts.clauseReference
    ? `submitted pursuant to clause ${facts.clauseReference} of the Contract`
    : 'submitted pursuant to the Contract';

  const header = [
    line('Variation order', facts.voNumber),
    line('Internal reference', facts.pcNumber),
    line('Project', `${facts.projectCode} ${facts.projectName}`),
    line('Contract', facts.contractNumber),
    line('Employer / Client', facts.clientName),
    line('Date of this document', formatDate(facts.documentDate)),
  ].filter(Boolean) as string[];

  const salutation = facts.recipientName ? `Dear ${facts.recipientName},` : 'Dear Sirs,';

  const circumstance = [
    line('Date of the event', formatDate(facts.eventDate)),
    line('Location', facts.location),
    line('Trade', facts.trade),
    line('Instructed or raised by', facts.instructedBy),
    line('How it reached us', facts.instructionSource),
  ].filter(Boolean) as string[];

  /*
    Scope before and after is the heart of this document. When it has not been
    filled in the document still has to exist, so it falls back to the
    reporter's account under a heading that says exactly what it is — rather
    than presenting a site note as though it were a considered scope statement.
  */
  const scope = facts.scopeRevised
    ? [
        'ORIGINAL SCOPE',
        facts.scopeOriginal ?? 'Not stated.',
        '',
        'REVISED SCOPE',
        facts.scopeRevised,
      ]
    : ['THE CHANGE, AS REPORTED', facts.description];

  /*
    The build-up, in the order a QS checks it: what, how much, at what rate,
    on what basis. The basis is on every line on purpose — a rate derived from
    the bill and a rate we invented are different arguments, and hiding which
    is which is what makes a submission look evasive.
  */
  const items: string[] = [];
  for (const item of facts.lineItems) {
    items.push(
      `${item.description}  |  ${item.quantity} ${item.unit} @ ${money(item.rate, facts.currency)}` +
        `  =  ${money(item.amount, facts.currency)}`,
    );
    const basis = [
      `basis: ${item.rateSource.split('_').join(' ')}`,
      item.boqReference ? `bill ref ${item.boqReference}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    items.push(`    (${basis})`);
  }
  if (items.length === 0) items.push('No line items have been priced.');

  const summary = [
    line('Net', money(facts.net, facts.currency)),
    line(
      facts.prelimsPercent ? `Preliminaries at ${facts.prelimsPercent}%` : 'Preliminaries',
      money(facts.prelims, facts.currency),
    ),
    line(
      facts.overheadProfitPercent
        ? `Overhead and profit at ${facts.overheadProfitPercent}%`
        : 'Overhead and profit',
      money(facts.overheadProfit, facts.currency),
    ),
    line('Total', money(facts.total, facts.currency)),
  ].filter(Boolean) as string[];

  /*
    Time is stated as a SEPARATE claim, and only when days are actually
    claimed. Rolling an extension of time into a cost submission gets both
    rejected, because the assessor has to agree the whole thing or none of it.
  */
  const timeSection = facts.timeImpactDaysClaimed
    ? [
        '',
        'EFFECT ON TIME',
        `This variation is considered to affect the completion date by ` +
          `${facts.timeImpactDaysClaimed} day${facts.timeImpactDaysClaimed === 1 ? '' : 's'}.`,
        facts.timeImpactBasis
          ? `Basis: ${facts.timeImpactBasis}`
          : 'Particulars of the effect follow separately.',
        'This is claimed separately from the cost above and does not form part ' +
          'of the figure stated in this document.',
      ]
    : [];

  const body = [
    ...header,
    '',
    salutation,
    '',
    `We submit the following variation for your agreement, ${clause}.`,
    '',
    'THE CHANGE',
    ...circumstance,
    '',
    ...scope,
    '',
    'BUILD-UP',
    ...items,
    '',
    'SUMMARY',
    ...summary,
    ...timeSection,
    '',
    'CONFIRMATION',
    'Please confirm your agreement to the scope and the value stated above by ' +
      'signing and returning a copy of this document, or by written instruction ' +
      'referring to the variation order number.',
    '',
    'Yours faithfully,',
    '',
    facts.companyName,
  ].join('\n');

  return { subject, body };
}
