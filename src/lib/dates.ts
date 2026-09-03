import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

/**
 * Dates, deliberately unambiguous.
 *
 * Everything user-facing renders as `09 Aug 2026`. Never `09/08/2026` — this is
 * a UAE product read by people from DD/MM and MM/DD conventions alike, and a
 * misread notice deadline is a lost claim. The named month costs three
 * characters and removes the class of error entirely.
 *
 * TWO KINDS OF VALUE, and mixing them is how deadlines drift by a day:
 *
 *   CALENDAR DATE   event date, notice due date, task due date. A day on a
 *                   wall calendar with no time and no zone. Stored as
 *                   Postgres `date`, which Prisma hands back as UTC midnight.
 *                   Parsed as UTC and formatted in UTC.
 *
 *   INSTANT         created_at, capture_date. A moment in time. Formatted in
 *                   the deployment timezone so it reads as the local clock.
 *
 * `parseISO('2026-08-01')` interprets a bare date in LOCAL time. At UTC+4 that
 * is 2026-07-31T20:00Z, and every derived deadline lands a day early. Hence
 * `parseCalendarDate` below.
 */

export const DEFAULT_TIMEZONE = 'Asia/Dubai';

export const DATE_FORMAT = 'dd MMM yyyy';
export const DATE_TIME_FORMAT = 'dd MMM yyyy HH:mm';

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a value that represents a calendar date. Bare `yyyy-MM-dd` is UTC. */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isValid(value) ? value : null;

  if (CALENDAR_DATE_PATTERN.test(value)) {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const parsed = new Date(Date.UTC(y, m - 1, d));
    return isValid(parsed) ? parsed : null;
  }

  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

/** Renders a CALENDAR DATE. Formatted in UTC — the stored value has no zone. */
export function formatDate(value: Date | string | null | undefined) {
  const date = toDate(value);
  if (!date) return '—';
  return formatInTimeZone(date, 'UTC', DATE_FORMAT);
}

/**
 * Renders an INSTANT as a calendar date, in the deployment's local clock.
 *
 * The one to use for `created_at`, `submitted_at`, `issued_at`, `sent_at` and
 * every other timestamp shown as a plain date. `formatDate` renders in UTC,
 * which is right for a stored `date` column and WRONG for a timestamp: at
 * UTC+4 every instant between midnight and 04:00 belongs to the previous day
 * in UTC, so a variation filed at 01:00 on the 4th rendered as the 3rd. It is
 * only ever wrong by one day, only ever in the small hours, and it always
 * reads as a plausible date — which is exactly why it survived until somebody
 * happened to file something after midnight.
 */
export function formatInstant(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
) {
  const date = toDate(value);
  if (!date) return '—';
  return formatInTimeZone(date, timeZone, DATE_FORMAT);
}

/** Renders an INSTANT in the deployment's local clock. */
export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
) {
  const date = toDate(value);
  if (!date) return '—';
  return formatInTimeZone(date, timeZone, DATE_TIME_FORMAT);
}

/** ISO `yyyy-MM-dd`, for `<input type="date">` and API payloads. Never for display. */
export function toDateInputValue(value: Date | string | null | undefined) {
  const date = toDate(value);
  if (!date) return '';
  return format(
    new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    'yyyy-MM-dd',
  );
}

/**
 * Notice Due Date = Event Date + the project's contract notice period.
 *
 * Calendar days, which is the literal contractual formula. Switching to working
 * days is a one-line change to use `addWorkingDays` — do not do it without a
 * contract that says so, because a shorter clock is a missed notice.
 */
export function calculateNoticeDueDate(eventDate: Date | string, noticePeriodDays: number): Date {
  const start = toDate(eventDate);
  if (!start) throw new Error('calculateNoticeDueDate: invalid eventDate');
  if (!Number.isInteger(noticePeriodDays) || noticePeriodDays < 0) {
    throw new Error('calculateNoticeDueDate: noticePeriodDays must be a non-negative integer');
  }
  return addDays(startOfDayUtc(start), noticePeriodDays);
}

/**
 * Days remaining until a deadline. Negative means overdue; 0 means it falls due
 * today. Compared against the deployment's local calendar day, so "due today"
 * means today in Dubai, not today in UTC.
 */
export function daysUntil(
  deadline: Date | string | null | undefined,
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): number | null {
  const target = toDate(deadline);
  if (!target) return null;
  return differenceInCalendarDays(toZonedTime(target, timeZone), toZonedTime(now, timeZone));
}

export function daysSince(
  since: Date | string | null | undefined,
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): number | null {
  const start = toDate(since);
  if (!start) return null;
  return differenceInCalendarDays(toZonedTime(now, timeZone), toZonedTime(start, timeZone));
}

/**
 * Working-day arithmetic against the company workweek. The UAE default is
 * Monday–Friday (1–5); Saturday–Thursday deployments exist, which is why the
 * workweek is configuration and not a constant.
 */
export function addWorkingDays(
  start: Date | string,
  days: number,
  workweekStartDay = 1,
  workweekEndDay = 5,
): Date {
  const from = toDate(start);
  if (!from) throw new Error('addWorkingDays: invalid start date');
  if (!Number.isInteger(days) || days < 0) {
    throw new Error('addWorkingDays: days must be a non-negative integer');
  }

  let cursor = startOfDayUtc(from);
  let remaining = days;

  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor, workweekStartDay, workweekEndDay)) remaining -= 1;
  }
  return cursor;
}

/**
 * Working days from one date to another, counting the days WORKED in between.
 *
 * Used to decide how hard to chase an unanswered decision, so it deliberately
 * ignores weekends: a task that fell due on Friday is one working day late on
 * Monday, not three. Chasing someone for a weekend they were not expected to
 * work is how a system teaches people to ignore it.
 *
 * Returns 0 when `to` is on or before `from` — never a negative number, since
 * "not yet due" is not "minus two days late".
 */
export function workingDaysBetween(
  from: Date | string,
  to: Date | string,
  workweekStartDay = 1,
  workweekEndDay = 5,
): number {
  const start = toDate(from);
  const end = toDate(to);
  if (!start || !end) throw new Error('workingDaysBetween: invalid date');

  let cursor = startOfDayUtc(start);
  const target = startOfDayUtc(end);
  let count = 0;

  while (cursor.getTime() < target.getTime()) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor, workweekStartDay, workweekEndDay)) count += 1;
  }
  return count;
}

/** Day numbering follows `Date.getUTCDay()`: 0 = Sunday … 6 = Saturday. */
export function isWorkingDay(date: Date, workweekStartDay = 1, workweekEndDay = 5): boolean {
  const day = date.getUTCDay();
  return workweekStartDay <= workweekEndDay
    ? day >= workweekStartDay && day <= workweekEndDay
    : day >= workweekStartDay || day <= workweekEndDay;
}

export function startOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

/** Today as a calendar date at UTC midnight — the shape stored in `date` columns. */
export function todayUtc(now: Date = new Date(), timeZone = DEFAULT_TIMEZONE): Date {
  const local = toZonedTime(now, timeZone);
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}
