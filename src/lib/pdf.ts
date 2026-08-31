/**
 * A very small PDF writer, for one job: putting a plain typed letter on A4.
 *
 * ── Why not a library ──────────────────────────────────────────────────────
 * Every PDF library that renders HTML pulls in a browser engine, which is a
 * few hundred megabytes in an image that currently starts in seconds. The
 * pure-JS writers are lighter but still a dependency whose whole surface we do
 * not use. What a notice needs is a monospace-simple letter: a title, some
 * labelled lines, wrapped paragraphs, a signature block. That is about a
 * hundred lines of PDF syntax, and having it here means the one document in
 * this system that may end up in front of a tribunal has no third party
 * between the text and the bytes.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 * No images, no colour, no tables, no embedded fonts, and therefore NO ARABIC
 * or any non-Latin script: the base-14 fonts are WinAnsi, and a character
 * outside that set is written as '?' rather than silently producing a blank.
 * An Arabic notice needs a real embedded font, and that is the day to reach
 * for a library.
 */

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FONT_SIZE = 10;
const LINE_HEIGHT = 13.5;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

/**
 * Estimated Helvetica advance widths, in ems.
 *
 * Deliberately an estimate rather than the real AFM table: we only need to
 * decide where to break a line, and being a few percent out moves a word, it
 * does not corrupt anything. The estimate errs WIDE, so text wraps early
 * rather than running off the page.
 */
function charWidth(ch: string): number {
  if ('iljI.,:;\'!|`'.includes(ch)) return 0.3;
  if ('ftr()[]{}/\\-'.includes(ch)) return 0.36;
  if ('WM@%'.includes(ch)) return 0.95;
  if (ch >= 'A' && ch <= 'Z') return 0.75;
  if ('mw'.includes(ch)) return 0.85;
  if (ch === ' ') return 0.3;
  return 0.58;
}

function textWidth(text: string, size = FONT_SIZE): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch);
  return total * size;
}

/** Breaks a paragraph onto lines that fit. A word longer than a line is cut. */
export function wrapText(text: string, maxWidth = USABLE_WIDTH): string[] {
  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      out.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) out.push(current);

      // A single word wider than the page, such as a long URL or reference.
      let rest = word;
      while (textWidth(rest) > maxWidth) {
        let cut = rest.length;
        while (cut > 1 && textWidth(rest.slice(0, cut)) > maxWidth) cut -= 1;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    if (current) out.push(current);
  }

  return out;
}

/** PDF string escaping. Anything outside WinAnsi becomes '?', visibly. */
function escapePdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '\\') out += '\\\\';
    else if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (code < 32 || code > 126) out += '?';
    else out += ch;
  }
  return out;
}

interface PdfLine {
  text: string;
  bold?: boolean;
}

/**
 * Renders lines of text to a PDF document.
 *
 * Lines are already wrapped by the caller through `wrapText`, or short enough
 * not to need it. Bold lines use Helvetica-Bold; everything else Helvetica.
 */
export function renderTextPdf(lines: PdfLine[]): Buffer {
  const pages: PdfLine[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];

  // 1 catalog, 2 pages, 3 regular font, 4 bold font, then two objects per page.
  const FIRST_PAGE_OBJ = 5;
  pages.forEach((_, index) => pageObjectNumbers.push(FIRST_PAGE_OBJ + index * 2));

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pages.forEach((pageLines, index) => {
    const pageObj = pageObjectNumbers[index]!;
    const contentObj = pageObj + 1;

    const top = PAGE_HEIGHT - MARGIN;
    const parts: string[] = ['BT'];
    pageLines.forEach((pageLine, lineIndex) => {
      const y = top - lineIndex * LINE_HEIGHT;
      parts.push(`/${pageLine.bold ? 'F2' : 'F1'} ${FONT_SIZE} Tf`);
      parts.push(`1 0 0 1 ${MARGIN.toFixed(2)} ${y.toFixed(2)} Tm`);
      parts.push(`(${escapePdfText(pageLine.text)}) Tj`);
    });
    parts.push('ET');
    const stream = parts.join('\n');

    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  // Assemble, recording the byte offset of every object for the xref table.
  const chunks: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];

  const push = (text: string) => {
    const buffer = Buffer.from(text, 'latin1');
    chunks.push(buffer);
    offset += buffer.byteLength;
  };

  push('%PDF-1.4\n');
  // A binary comment, so tools that sniff the first bytes treat it as binary.
  push('%\xE2\xE3\xCF\xD3\n');

  const highest = objects.length - 1;
  for (let n = 1; n <= highest; n += 1) {
    const body = objects[n];
    if (body === undefined) continue;
    offsets[n] = offset;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  }

  const xrefStart = offset;
  const size = highest + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n <= highest; n += 1) {
    xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

/** Turns a plain-text letter into PDF lines, wrapping and emboldening headings. */
export function textToPdfLines(text: string): PdfLine[] {
  const out: PdfLine[] = [];
  for (const rawLine of text.split('\n')) {
    // A heading is a whole line in upper case with no lower-case letters. That
    // is exactly how the notice template writes its section headings, so the
    // two stay in step without the template knowing about the PDF.
    const isHeading = rawLine.trim().length > 0 && rawLine === rawLine.toUpperCase() && /[A-Z]/.test(rawLine);
    for (const wrapped of wrapText(rawLine)) {
      out.push({ text: wrapped, bold: isHeading });
    }
  }
  return out;
}
