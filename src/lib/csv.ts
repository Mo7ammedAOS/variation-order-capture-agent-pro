/**
 * CSV, written for the one program that will actually open it.
 *
 * ── Why this is not `values.join(',')` ─────────────────────────────────────
 * The register carries free text a site engineer typed on a phone: commas in
 * descriptions, line breaks where they hit return, and double quotes around
 * the thing the consultant said. Each of those silently corrupts a naive join,
 * and the corruption is not visible until a QS is reading a column that has
 * slipped one place to the left.
 *
 * ── The BOM is not optional ────────────────────────────────────────────────
 * Excel on Windows does not detect UTF-8 in a .csv. Without a byte-order mark
 * it decodes as the system codepage, and every Arabic name, every accented
 * consultant, and the dirham sign arrive as mojibake. One three-byte prefix is
 * the whole fix, and it is invisible to everything else that reads CSV.
 *
 * ── Separator ──────────────────────────────────────────────────────────────
 * Comma, deliberately, with proper quoting — not the semicolon some locales
 * expect. A quoted comma-separated file opens correctly in Excel, Numbers,
 * Sheets and every parser; a semicolon file opens correctly in some of them.
 */

/** Excel's UTF-8 signal. Prepended by `toCsv`, never by the caller. */
const BOM = '﻿';

/**
 * One field, quoted only when it has to be.
 *
 * Quoting everything would also be correct and is what most exporters do; the
 * reason not to is that an unquoted file diffs and greps like text, which
 * matters the first time somebody has to check an export against the register
 * by eye.
 */
function field(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (text === '') return '';

  /*
    A leading =, +, - or @ makes Excel treat the cell as a formula. In a file
    built from text other people typed, that is a CSV injection: `=HYPERLINK(...)`
    in a description field becomes a live link in the QS's spreadsheet.

    Prefixing a single quote is the standard defence and Excel hides it, so the
    cell still reads as the original text.
  */
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /[",\n\r]/.test(safe) ? `"${safe.split('"').join('""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(field).join(',')];
  for (const row of rows) lines.push(row.map(field).join(','));
  // CRLF: the line ending the CSV RFC specifies and the one Excel is happiest
  // with. Everything else copes with it.
  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * A filename that sorts chronologically and survives every filesystem.
 *
 * Dated because a QS will export this repeatedly and end up with a download
 * folder full of them; without the date the browser appends "(3)" and the one
 * from this morning is indistinguishable from the one from last month.
 */
export function csvFilename(stem: string, on: Date): string {
  const date = on.toISOString().slice(0, 10);
  const clean = stem.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean}-${date}.csv`;
}
