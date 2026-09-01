/**
 * Reading what a person meant, without a model and without a network call.
 *
 * Everything here is deterministic and pure, and that is deliberate. These
 * functions decide whether a message becomes a Potential Change, so their
 * behaviour has to be the same on a Tuesday afternoon as it was in the test
 * that proved it. A model that is having a bad day must never be able to turn
 * "thanks" into a claim, or lose a real report because it felt chatty.
 *
 * The bias throughout is the same one the capture path already takes: when a
 * message is not CLEARLY one of these small things, it is a report. Mistaking
 * courtesy for a report creates a junk record somebody has to close. Mistaking
 * a report for courtesy destroys it silently, and that is the one that costs
 * money six months later.
 */

/** What n8n sends when a message carried files and nothing else. */
const EVIDENCE_MARKERS = new Set(['[MEDIA ONLY]', '[EMPTY EMAIL]', '[NO TEXT]']);

/**
 * Courtesy. Every word of the reply has to be in here, or it is not courtesy.
 *
 * "no", "nope" and "nothing else" sit in this set on purpose: the system now
 * ends its messages with "anything else?", so a bare "no" is the single most
 * likely next thing anyone types. Without it, saying no to that question filed
 * a Potential Change titled "no".
 */
const PLEASANTRY = new Set([
  // agreement and receipt
  'OK', 'OKAY', 'OKY', 'K', 'KK', 'RIGHT', 'ALRIGHT', 'FINE', 'GOOD', 'GREAT',
  'PERFECT', 'NICE', 'SUPER', 'EXCELLENT', 'BRILLIANT', 'LOVELY', 'WELL',
  'NOTED', 'RECEIVED', 'UNDERSTOOD', 'CLEAR', 'DONE', 'SORTED', 'CONFIRMED',
  // thanks
  'THANK', 'THANKS', 'THANKYOU', 'THX', 'TQ', 'TY', 'TA', 'CHEERS',
  'APPRECIATE', 'APPRECIATED', 'SHUKRAN', 'TAMAM', 'MASHKOOR',
  // declining the follow-up
  'NO', 'NOPE', 'NOTHING', 'NONE', 'ELSE', 'MORE', 'NOT', 'FOR', 'NOW',
  'ALL', 'THATS', 'THAT', 'THIS', 'ITS', 'IT', 'IS', 'AM', 'ARE', 'WE', 'I',
  'YOU', 'YOUR', 'MY', 'MUCH', 'VERY', 'SO', 'TOO', 'A', 'THE', 'GOT',
  // signing off
  'BYE', 'GOODBYE', 'SALAM', 'SALAAM', 'REGARDS', 'LATER', 'SEE', 'SOON',
]);

/** A word cap, because a courteous sentence is short and a report is not. */
const PLEASANTRY_MAX_WORDS = 6;

/** "New one", "it's a new one", "separate change". */
const NEW_CHANGE_WORDS = new Set([
  'NEW', 'ONE', 'ANOTHER', 'SEPARATE', 'DIFFERENT', 'FRESH', 'ADDITIONAL',
  'ITS', 'IT', 'IS', 'A', 'AN', 'THIS', 'THATS', 'THAT', 'NOT', 'LISTED',
  'THERE', 'ABOVE', 'CHANGE', 'VARIATION', 'PLEASE',
]);

/** At least one of these has to appear, or "it is that one" would read as new. */
const NEW_CHANGE_ANCHORS = new Set(['NEW', 'ANOTHER', 'SEPARATE', 'DIFFERENT', 'FRESH', 'ADDITIONAL']);

const MONTHS: Record<string, number> = {
  JAN: 0, JANUARY: 0, FEB: 1, FEBRUARY: 1, MAR: 2, MARCH: 2, APR: 3, APRIL: 3,
  MAY: 4, JUN: 5, JUNE: 5, JUL: 6, JULY: 6, AUG: 7, AUGUST: 7,
  SEP: 8, SEPT: 8, SEPTEMBER: 8, OCT: 9, OCTOBER: 9, NOV: 10, NOVEMBER: 10,
  DEC: 11, DECEMBER: 11,
};

/** Beyond this, a "date" is far likelier to be a misread number than a memory. */
const MAX_DAYS_BACK = 730;

function words(text: string): string[] {
  return text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

function isMarker(text: string): boolean {
  return EVIDENCE_MARKERS.has(text.trim().toUpperCase());
}

/**
 * A message that carried files and no words of its own.
 *
 * Both channels substitute a marker rather than an empty string, so that an
 * event row is never blank. Treating those markers as a report would file a
 * Potential Change titled "[media only]" — a record with photographs attached
 * and no statement of what happened, which is worse than useless in a notice.
 */
export function looksEvidenceOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  if (isMarker(trimmed)) return true;
  // A forwarded photo often arrives with its own filename as the caption.
  return /^[\w \-.()]+\.(jpe?g|png|heic|pdf|docx?|xlsx?|dwg|dxf|mp4|m4a|ogg|opus)$/i.test(trimmed);
}

/**
 * "Thanks", "ok", "no, that's all" — a message that closes a conversation
 * rather than starting a report.
 *
 * Only consulted when nothing is outstanding. While a question is open,
 * `tryAnswerQuestion` has already read the reply, so a "no" that means "wrong
 * project" can never be mistaken for a polite decline.
 */
export function isPleasantry(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || isMarker(trimmed)) return false;

  const parts = words(trimmed);

  // Only emoji, or only punctuation: a thumbs up is agreement, not a change.
  if (parts.length === 0) return true;

  if (parts.length > PLEASANTRY_MAX_WORDS) return false;
  // A digit in a short reply is a list position or a project code, not courtesy.
  if (parts.some((word) => /\d/.test(word))) return false;

  return parts.every((word) => PLEASANTRY.has(word));
}

/** "New one", "separate change" — a file that belongs to nothing on the list. */
export function isNewChangeRequest(text: string): boolean {
  const parts = words(text);
  if (parts.length === 0 || parts.length > 6) return false;
  if (!parts.some((word) => NEW_CHANGE_ANCHORS.has(word))) return false;
  return parts.every((word) => NEW_CHANGE_WORDS.has(word));
}

export interface ParsedDate {
  date: Date;
  /** What in the message said so, quoted back so a misread is visible. */
  phrase: string;
}

/**
 * When the reporter says something happened.
 *
 * This is the field the whole product turns on: the notice deadline is the
 * event date plus the contract's notice period, so a change that happened nine
 * days ago has nineteen days left, not twenty eight. Defaulting silently to
 * today does not make the deadline safe, it makes it wrong in the direction
 * that loses entitlement.
 *
 * ── Day first, and why that is stated rather than assumed ──────────────────
 * `10/08/2026` is the tenth of August here, not the eighth of October. UAE
 * convention is day first, and this project has already had one client
 * document misread the other way round. The parsed date is always echoed back
 * as `28 Aug 2026`, never as digits, so a wrong reading is visible to the one
 * person who knows.
 *
 * Refuses future dates. An event has happened; a date after today means the
 * digits were read in an order the writer did not intend, and asking again is
 * cheaper than starting a contractual clock from the wrong day.
 */
export function parseEventDate(text: string, today: Date): ParsedDate | null {
  const upper = text.toUpperCase();
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;

  const relative = (days: number, phrase: string): ParsedDate => ({
    date: new Date(base - days * dayMs),
    phrase,
  });

  if (/\b(TODAY|THIS MORNING|THIS AFTERNOON|THIS EVENING|JUST NOW|TODAY'?S)\b/.test(upper)) {
    return relative(0, 'today');
  }
  if (/\b(YESTERDAY|LAST NIGHT|YESTERDAY'?S)\b/.test(upper)) {
    return relative(1, 'yesterday');
  }

  const ago = upper.match(/\b(\d{1,3})\s*(DAY|DAYS|WEEK|WEEKS)\s+AGO\b/);
  if (ago) {
    const count = Number(ago[1]);
    const days = /WEEK/.test(ago[2] ?? '') ? count * 7 : count;
    if (days >= 0 && days <= MAX_DAYS_BACK) return relative(days, ago[0].toLowerCase());
  }
  if (/\bLAST WEEK\b/.test(upper)) return relative(7, 'last week');

  const iso = upper.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return accept(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), iso[0], base);
  }

  // 28/08/2026, 28-8-26, 28.08.2026 — day first.
  const numeric = upper.match(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = numeric[3] ? fullYear(Number(numeric[3])) : today.getUTCFullYear();
    const parsed = accept(year, month, day, numeric[0], base);
    if (parsed) return parsed;
  }

  // 28 Aug, 28 August 2026, Aug 28
  const dayMonth = upper.match(/\b(\d{1,2})\s+([A-Z]{3,9})\.?\s*(\d{4})?\b/);
  if (dayMonth && MONTHS[dayMonth[2] ?? ''] !== undefined) {
    const year = dayMonth[3] ? Number(dayMonth[3]) : today.getUTCFullYear();
    const parsed = accept(year, MONTHS[dayMonth[2] ?? ''] ?? 0, Number(dayMonth[1]), dayMonth[0], base);
    if (parsed) return parsed;
  }

  const monthDay = upper.match(/\b([A-Z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?\b/);
  if (monthDay && MONTHS[monthDay[1] ?? ''] !== undefined) {
    const year = monthDay[3] ? Number(monthDay[3]) : today.getUTCFullYear();
    const parsed = accept(year, MONTHS[monthDay[1] ?? ''] ?? 0, Number(monthDay[2]), monthDay[0], base);
    if (parsed) return parsed;
  }

  return null;
}

function fullYear(value: number): number {
  return value >= 100 ? value : 2000 + value;
}

function accept(
  year: number,
  month: number,
  day: number,
  phrase: string,
  baseMs: number,
): ParsedDate | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month, day);
  const date = new Date(stamp);
  // Rejects 31 February, which Date would roll forward into March.
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  if (stamp > baseMs) return null;
  if (baseMs - stamp > MAX_DAYS_BACK * 24 * 60 * 60 * 1000) return null;
  return { date, phrase: phrase.trim().toLowerCase() };
}

const DOCUMENT_WORDS =
  /\b(DRAWING|DRAWINGS|DWG|DRG|RFI|SKETCH|REVISION|REV\b|DETAIL|SPEC|SPECIFICATION|SITE INSTRUCTION|INSTRUCTION|SHOP DRAWING|LAYOUT|MARK ?UP|IFC)\b/;

/**
 * Does this report hang off a document?
 *
 * Used only to decide whether asking for a reference is worth a message. A
 * change that came from a drawing revision is worth almost nothing at
 * adjudication without the drawing number, and everything with it.
 */
export function mentionsDocument(text: string): boolean {
  return DOCUMENT_WORDS.test(text.toUpperCase());
}

/**
 * A drawing, RFI or site-instruction reference.
 *
 * `excludeCodes` exists because "AR-201" and "DXB-001" are the same shape, and
 * quietly recording a project code as a drawing number would put a plausible
 * wrong reference on a claim. Project codes are passed in and skipped.
 */
export function parseDocumentReference(text: string, excludeCodes: string[] = []): string | null {
  const upper = text.toUpperCase();
  const banned = new Set(excludeCodes.map((code) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')));

  const explicit = upper.match(
    /\b(RFI|SI|EI|CVI|AI|IR|TQ|DWG|DRG)\s*(?:NO\.?|NUMBER|#|:)?\s*([A-Z0-9][A-Z0-9\-/]{0,15})\b/,
  );
  if (explicit) {
    const reference = `${explicit[1]}-${explicit[2]}`.replace(/-+/g, '-');
    if (!banned.has(reference.replace(/[^A-Z0-9]/g, ''))) return reference;
  }

  // The generic shape only applies when the message is talking about a
  // document at all. Outside that context it would match half the site slang.
  if (!mentionsDocument(text)) return null;

  const generic = upper.match(/\b([A-Z]{1,3}-?\d{2,4}(?:[-/][A-Z0-9]{1,4})?)(\s+REV\.?\s*[A-Z0-9]{1,3})?\b/);
  if (!generic) return null;

  const core = (generic[1] ?? '').replace(/[^A-Z0-9]/g, '');
  if (banned.has(core)) return null;

  return `${generic[1]}${generic[2] ? generic[2].replace(/\s+/g, ' ') : ''}`.trim();
}

export type ReportedWorkStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold';

/**
 * Whether the work has started, which decides how urgent this is.
 *
 * Work already in progress on an uninstructed change is the expensive case:
 * cost is being incurred with no authority behind it, and the notice is late
 * the moment it is late.
 */
export function parseWorkStatus(text: string): ReportedWorkStatus | null {
  const upper = text.toUpperCase();
  if (/\b(NOT STARTED|HAVEN'?T STARTED|HASN'?T STARTED|NO WORK|NOTHING STARTED|NOT YET)\b/.test(upper)) {
    return 'not_started';
  }
  if (/\b(ON HOLD|HELD|PAUSED|SUSPENDED|STOPPED)\b/.test(upper)) return 'on_hold';
  if (/\b(COMPLETED|COMPLETE|FINISHED|ALREADY DONE|IS DONE)\b/.test(upper)) return 'completed';
  if (/\b(STARTED|IN PROGRESS|ONGOING|UNDER WAY|UNDERWAY|WORKING ON IT|BUILDING IT)\b/.test(upper)) {
    return 'in_progress';
  }
  return null;
}

/**
 * The last line of a message, varied so a conversation does not read like a
 * receipt printer.
 *
 * Chosen by hashing a seed rather than at random, so the same exchange reads
 * the same way twice and a test can assert on it. Variety is the point, not
 * surprise.
 */
const CLOSINGS = [
  'Anything else, or is that everything for now?',
  'Anything else to report?',
  'Anything else from site today?',
  'Send the next one whenever you are ready.',
  'Anything else you want logged?',
];

export function closingLine(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return CLOSINGS[hash % CLOSINGS.length] ?? CLOSINGS[0]!;
}
