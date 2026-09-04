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
  // A short reply is an ANSWER to "when did this happen?", so shapes that would
  // be reckless to hunt for inside a paragraph — a bare "15th", a bare "Sat" —
  // are safe here. In a report, "1st fix" and "the sun shade" are the words of
  // the trade, not a date.
  const brief = words(text).length <= 4;

  const relative = (days: number, phrase: string): ParsedDate => ({
    date: new Date(base - days * dayMs),
    phrase,
  });

  if (/\b(TODAY|THIS MORNING|THIS AFTERNOON|THIS EVENING|JUST NOW|TODAY'?S)\b/.test(upper)) {
    return relative(0, 'today');
  }
  if (/\bDAY BEFORE YESTERDAY\b/.test(upper)) return relative(2, 'the day before yesterday');
  if (/\b(YESTERDAY|LAST NIGHT|YESTERDAY'?S)\b/.test(upper)) {
    return relative(1, 'yesterday');
  }

  // "3 days ago", "two weeks ago", "a week back", "a couple of days ago".
  const ago = upper.match(
    /\b(\d{1,3}|[A-Z]+)\s+(?:OF\s+)?(DAYS?|WEEKS?|MONTHS?)\s+(?:AGO|BACK|EARLIER)\b/,
  );
  if (ago) {
    const raw = ago[1] ?? '';
    const count = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
    const unit = ago[2] ?? '';
    if (count !== undefined && count >= 0) {
      if (unit.startsWith('MONTH')) {
        const shifted = monthShift(today, -count);
        // Clamped, not rolled. "One month ago" on 31 March is 28 February, and
        // Date arithmetic would make it 3 March — a deadline three days out.
        const day = Math.min(today.getUTCDate(), daysInMonth(shifted.year, shifted.month));
        const parsed = accept(shifted.year, shifted.month, day, ago[0], base);
        if (parsed) return parsed;
      } else {
        const days = unit.startsWith('WEEK') ? count * 7 : count;
        if (days <= MAX_DAYS_BACK) return relative(days, ago[0].toLowerCase());
      }
    }
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

  // 28 Aug · 28th August 2026 · 23rd of August. Every candidate is tried, not
  // just the first: "2 rooms affected, happened 23 Aug" opens with a number and
  // a word that is not a month, and stopping there would lose the real date.
  for (const m of upper.matchAll(/\b(\d{1,2})(?:ST|ND|RD|TH)?\s*(?:OF\s+)?([A-Z]{3,9})\.?,?\s*(\d{4})?\b/g)) {
    const month = MONTHS[m[2] ?? ''];
    if (month === undefined) continue;
    const year = m[3] ? Number(m[3]) : today.getUTCFullYear();
    const parsed = accept(year, month, Number(m[1]), m[0], base);
    if (parsed) return parsed;
  }

  // Aug 28 · August 28, 2026 · Aug 28th
  for (const m of upper.matchAll(/\b([A-Z]{3,9})\.?\s+(\d{1,2})(?:ST|ND|RD|TH)?(?:,?\s*(\d{4}))?\b/g)) {
    const month = MONTHS[m[1] ?? ''];
    if (month === undefined) continue;
    const year = m[3] ? Number(m[3]) : today.getUTCFullYear();
    const parsed = accept(year, month, Number(m[2]), m[0], base);
    if (parsed) return parsed;
  }

  // "15th of this month", "3rd of last month".
  const ofMonth = upper.match(
    /\b(?:THE\s+)?(\d{1,2})(?:ST|ND|RD|TH)?\s+OF\s+(THIS|CURRENT|LAST|PREVIOUS)\s+MONTH\b/,
  );
  if (ofMonth) {
    const shifted = monthShift(today, /LAST|PREVIOUS/.test(ofMonth[2] ?? '') ? -1 : 0);
    const parsed = accept(shifted.year, shifted.month, Number(ofMonth[1]), ofMonth[0], base);
    if (parsed) return parsed;
  }

  // "last Monday", "on Friday", and — in a short answer only — a bare "Sat".
  const weekday = upper.match(
    /\b(LAST|THIS|PAST|ON)?\s*(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUN|MON|TUES|TUE|WEDS|WED|THURS|THUR|THU|FRI|SAT)\b/,
  );
  if (weekday) {
    const name = weekday[2] ?? '';
    const qualified = Boolean(weekday[1]);
    const target = WEEKDAYS[name];
    // "Sat" is a word on a building site before it is a day. An abbreviation
    // counts only when something in front of it says a day is meant, or when
    // the whole message is the answer to "when did this happen?".
    if (target !== undefined && (name.endsWith('DAY') || qualified || brief)) {
      const back = (new Date(base).getUTCDay() - target + 7) % 7;
      // Today, said as a weekday, means today — unless they said LAST, which
      // can only mean the one before.
      const days = back === 0 && weekday[1] === 'LAST' ? 7 : back;
      return relative(days, weekday[0].trim().toLowerCase());
    }
  }

  // "on the 15th", "the 3rd" — and a bare "15th" only in a short answer, where
  // it cannot be the "1st fix" every fit-out programme is full of.
  const ordinal = upper.match(/\b(ON\s+THE|ON|THE)?\s*(\d{1,2})(?:ST|ND|RD|TH)\b/);
  if (ordinal && (ordinal[1] || brief)) {
    const day = Number(ordinal[2]);
    // This month if that day has already been; otherwise the same day last
    // month, because an event that has not happened yet is not an event.
    const future = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day) > base;
    const shifted = monthShift(today, future ? -1 : 0);
    const parsed = accept(shifted.year, shifted.month, day, ordinal[0], base);
    if (parsed) return parsed;
  }

  return null;
}

/** Word forms of the small numbers people actually type. */
const WORD_NUMBERS: Record<string, number> = {
  A: 1, AN: 1, ONE: 1, COUPLE: 2, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
};

const WEEKDAYS: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
  SUN: 0, MON: 1, TUE: 2, TUES: 2, WED: 3, WEDS: 3, THU: 4, THUR: 4, THURS: 4, FRI: 5, SAT: 6,
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The same calendar month, so many months back. */
function monthShift(today: Date, months: number): { year: number; month: number } {
  const raw = today.getUTCMonth() + months;
  return {
    year: today.getUTCFullYear() + Math.floor(raw / 12),
    month: ((raw % 12) + 12) % 12,
  };
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

/* ────────────────────────── who asked for it ─────────────────────────────── */

/**
 * The parties who instruct a change on a fit-out job, and what each is called.
 *
 * A claim turns on WHO wanted it. The consultant asking for a different finish
 * is a variation; the same words from our own foreman is rework we pay for.
 * That distinction is decided months later by somebody reading the record, so
 * the answer is standardised on the way in — "the consultants", "consultant",
 * "supervision consultant" and "the engineer's rep" all have to be searchable
 * as one party, or a register cannot be counted.
 *
 * Abbreviations are marked because they are only safe in a short answer. "PM"
 * inside a paragraph is as likely to be four o'clock, and "CD" is anybody's
 * guess.
 */
const PARTIES: { match: string; label: string; short?: boolean }[] = [
  { match: 'MAIN\\s+CONTRACTOR', label: 'Main contractor' },
  { match: 'MC', label: 'Main contractor', short: true },
  { match: 'SUB\\s?CONTRACTOR|SUBBIE', label: 'Subcontractor' },
  { match: 'SUPERVISION\\s+CONSULTANT|CONSULTANTS?|ENGINEER\'?S?\\s+REPRESENTATIVE', label: 'Consultant' },
  { match: 'INTERIOR\\s+DESIGNER|DESIGNERS?', label: 'Interior designer' },
  { match: 'ARCHITECTS?', label: 'Architect' },
  { match: 'MEP\\s+CONSULTANT|MEP', label: 'MEP consultant' },
  { match: 'LANDLORD|BUILDING\\s+MANAGEMENT|MALL\\s+MANAGEMENT', label: 'Landlord' },
  { match: 'CIVIL\\s+DEFEN[CS]E', label: 'Civil Defence' },
  { match: 'MUNICIPALITY|TRAKHEES|DEWA|AUTHORITY|AUTHORITIES', label: 'Authority' },
  { match: 'DEVELOPER', label: 'Developer' },
  { match: 'TENANT', label: 'Tenant' },
  { match: 'CLIENT|EMPLOYER|OWNER', label: 'Client' },
  { match: 'PROJECT\\s+MANAGER', label: 'Project manager' },
  { match: 'PM', label: 'Project manager', short: true },
  { match: 'QUANTITY\\s+SURVEYOR', label: 'Quantity surveyor' },
  { match: 'QS', label: 'Quantity surveyor', short: true },
  { match: 'CONSTRUCTION\\s+MANAGER', label: 'Construction manager' },
  { match: 'SITE\\s+ENGINEER', label: 'Site engineer' },
  { match: 'FOREMAN', label: 'Foreman' },
];

/** Said next to a party, this is the party who ASKED rather than one mentioned. */
const REQUEST_VERBS =
  'ASKED|ASKS|REQUESTED|REQUESTS|INSTRUCTED|INSTRUCTS|WANTS|WANTED|REQUIRES|REQUIRED|TOLD|ORDERED|DIRECTED|RAISED|DECIDED|CONFIRMED|APPROVED|ISSUED';

/** Acronyms that are wrong in any other case, however the sentence is tidied. */
const ACRONYMS = new Set(['MEP', 'QS', 'PM', 'RFI', 'HSE', 'HVAC', 'AC', 'MD', 'IT', 'BOQ']);

/**
 * Who asked for the change.
 *
 * ── Why it is read twice, differently ─────────────────────────────────────
 * The same function reads a one-line ANSWER ("the consultant") and a whole
 * REPORT ("we told the client the ceiling would not clear, so the consultant
 * asked us to drop it"). Those need opposite instincts. In an answer, any
 * party word is the answer. In a report, half the parties on the job get
 * mentioned, and picking the first one would file "Client" against a change
 * the client never asked for — a wrong attribution on a claim is worse than an
 * empty field, because nobody goes back and checks a field that is filled in.
 *
 * So in a report a party counts only where the sentence says it instructed:
 * after "by" or "from", or in front of a verb like "asked" or "wants".
 */
export function parseInstructedBy(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '' || looksEvidenceOnly(trimmed) || isPleasantry(trimmed)) return null;

  const brief = words(trimmed).length <= 8;

  // "Requested by: the consultant" — how the follow-up labels an answer, and
  // how people write it themselves.
  const labelled = trimmed.match(
    /\b(?:REQUESTED|ASKED|INSTRUCTED|RAISED|ORDERED|DIRECTED)\s+BY\s*[:\-]?\s*([^\n.;]{2,60})/i,
  );
  const stated = labelled?.[1]?.trim() ?? null;
  const scope = stated ?? trimmed;
  const upper = scope.toUpperCase();
  const anywhere = brief || stated !== null;

  let party: string | null = null;
  for (const candidate of PARTIES) {
    if (candidate.short && !anywhere) continue;
    const found = anywhere
      ? new RegExp(`\\b(?:${candidate.match})\\b`).test(upper)
      : new RegExp(
          `\\b(?:BY|FROM)\\s+(?:THE\\s+)?(?:${candidate.match})\\b` +
            `|\\b(?:${candidate.match})\\b\\s+(?:HAS\\s+|HAVE\\s+)?(?:${REQUEST_VERBS})\\b`,
        ).test(upper);
    if (found) {
      party = candidate.label;
      break;
    }
  }

  // A named person, which is what actually gets quoted in a meeting six months
  // later. Kept ALONGSIDE the party rather than instead of it: "Eng. Khalid"
  // means nothing to a reader who does not know which side he is on.
  const person = scope.match(/\b(MR|MRS|MS|DR|ENG|ENGR|ENGINEER)\.?\s+([A-Za-z][A-Za-z'-]{1,20})/i);
  // "the engineer asked for" is a sentence, not a man called Asked. A title
  // followed by a verb names nobody.
  const candidate = person?.[2] ?? '';
  const named =
    person && !new RegExp(`^(?:${REQUEST_VERBS}|SAID|THINKS|FROM|THE|OF|ON|AT|AND|HAS|HAVE|IS|WAS|WILL|WANT)$`, 'i').test(candidate)
      ? `${titleWord(person[1] ?? '')} ${capitalise(candidate)}`
      : null;

  if (named && party) return `${named} (${party})`;
  if (named) return named;
  if (party) return party;

  // Nothing recognised. An explicit "requested by X" is taken at its word, and
  // so is a short answer — he was asked who, and this is what he said. A long
  // report that names nobody is left empty rather than guessed at.
  if (stated) return tidy(stated);
  if (brief) return tidy(trimmed);
  return null;
}

function capitalise(word: string): string {
  const upper = word.toUpperCase();
  if (ACRONYMS.has(upper)) return upper;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function titleWord(word: string): string {
  const upper = word.toUpperCase();
  if (upper === 'ENG' || upper === 'ENGR' || upper === 'ENGINEER') return 'Eng.';
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

/** House style for a free-text party: no leading article, no trailing full stop. */
function tidy(value: string): string {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/^(?:THE|A|AN|ITS|IT'?S|WAS|BY|FROM)\s+/i, '')
    .replace(/[.,;:!?\s]+$/, '')
    .trim();
  if (cleaned === '') return value.trim().slice(0, 60);
  const capped = cleaned.length > 60 ? `${cleaned.slice(0, 60).trimEnd()}…` : cleaned;
  return capped
    .split(' ')
    .map((word, index) => (index === 0 ? capitalise(word) : ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word))
    .join(' ');
}

/**
 * Words that are TRYING to say when, without landing on a day.
 *
 * "Last month", "over the weekend", "during Ramadan", "before Eid". Each is an
 * answer to "when did this happen?" and none of them is a date. Knowing the
 * difference between one of these and an unrelated new report is what keeps a
 * vague answer from being filed as a second change — see the detail branch of
 * `interpret`.
 */
const TEMPORAL_WORDS =
  /\b(TODAY|YESTERDAY|TOMORROW|MORNING|AFTERNOON|EVENING|NIGHT|WEEK|WEEKS|WEEKEND|MONTH|MONTHS|YEAR|YEARS|DAY|DAYS|AGO|BACK|EARLIER|RECENTLY|LATELY|SOMETIME|RAMADAN|EID|HOLIDAY|HOLIDAYS|SHUTDOWN|LAST|SINCE|BEFORE|AFTER|AROUND|BEGINNING|START|MIDDLE|MID|END)\b/;

export function looksTemporal(text: string): boolean {
  return TEMPORAL_WORDS.test(text.toUpperCase());
}

export type ReportedWorkStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold';

/**
 * Whether the work has started, which decides how urgent this is.
 *
 * Work already in progress on an uninstructed change is the expensive case:
 * cost is being incurred with no authority behind it, and the notice is late
 * the moment it is late.
 */
/**
 * The answer to a question we just asked, read in the light of the question.
 *
 * ── The bug this exists to kill ───────────────────────────────────────────
 * "Has the work started on site?" — "No". `parseWorkStatus` on its own reads
 * that as nothing, because "no" is not a statement about work. So the reply
 * yielded no fact, was treated as a brand new report, and the exchange asked
 * "which project?" all over again. Live on 2026-09-04, four times in a row,
 * which is exactly how long it takes somebody to stop using a system.
 *
 * A bare yes or no is only meaningful because of what was asked a moment ago,
 * so the field being asked is an argument. Nothing here guesses: if the field
 * is not `work_status`, yes and no still mean nothing.
 */
export function parseAnswerForField(
  field: 'work_status' | 'event_date' | 'instructed_by' | 'document_reference',
  text: string,
  today: Date = new Date(),
): ReportedWorkStatus | ParsedDate | string | null {
  if (field === 'work_status') {
    const explicit = parseWorkStatus(text);
    if (explicit) return explicit;

    const words = text.toUpperCase().split(/[^A-Z']+/).filter(Boolean);
    // Only a SHORT reply is read as a bare yes or no. "No, the client said the
    // ceiling has to come down" is a report that happens to start with "no",
    // and reading it as a work status would throw the sentence away.
    if (words.length > 3) return null;
    if (words.some((word) => AFFIRMATIVE_ANSWER.has(word))) return 'in_progress';
    if (words.some((word) => NEGATIVE_ANSWER.has(word))) return 'not_started';
    return null;
  }

  if (field === 'event_date') return parseEventDate(text, today);
  if (field === 'instructed_by') return parseInstructedBy(text);
  return parseDocumentReference(text);
}

/** Whole words that answer "has it started?" without saying so. */
const AFFIRMATIVE_ANSWER = new Set([
  'YES', 'YEP', 'YEAH', 'YUP', 'Y', 'STARTED', 'DONE', 'ALREADY', 'AFFIRMATIVE', 'CORRECT',
]);

const NEGATIVE_ANSWER = new Set([
  'NO', 'NOPE', 'NOT', 'NONE', 'NEGATIVE', 'NIL', 'N', 'YET',
]);

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
