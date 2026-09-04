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

/* ─────────────────────────── the designed document ───────────────────────
 *
 * `renderTextPdf` below puts a typed letter on a page and nothing else. It is
 * still here, still used, and still correct for anything internal.
 *
 * A NOTICE is not internal. It goes to the main contractor, it is read by
 * their commercial team, and it is the document produced when entitlement is
 * argued about a year later. A page of undifferentiated 10pt Helvetica reads
 * as something a system spat out; the same words with a letterhead, a
 * reference block and a hierarchy read as something a company sent. That
 * difference is not decoration — it is whether the recipient treats the
 * notice as correspondence or as noise.
 *
 * So: a block model. Sizes, weights, a colour, horizontal rules, right
 * alignment, and a footer on every page. Still no library, for the reason at
 * the top of this file: the one document here that may end up in front of a
 * tribunal has nothing between its text and its bytes.
 */

export type Rgb = readonly [number, number, number];

const INK: Rgb = [0.07, 0.09, 0.15];
const MUTED: Rgb = [0.42, 0.45, 0.52];
const RULE: Rgb = [0.82, 0.84, 0.88];

export type PdfBlock =
  | {
      kind: 'text';
      text: string;
      size?: number;
      bold?: boolean;
      color?: Rgb;
      /** Extra leading under this line, on top of the line height. */
      after?: number;
      align?: 'left' | 'right';
      /** Letter-spaced, for a small-caps style heading. */
      tracked?: boolean;
    }
  | { kind: 'space'; height: number }
  | { kind: 'rule'; color?: Rgb; thickness?: number; after?: number }
  /** A label and its value on one line: the reference block of a letter. */
  | { kind: 'field'; label: string; value: string }
  /** Never split across a page: a heading must not end one. */
  | { kind: 'keepWithNext' };

export interface PdfDocument {
  blocks: PdfBlock[];
  /** Repeated at the foot of every page, with the page number. */
  footer?: string;
}

function blockHeight(block: PdfBlock): number {
  switch (block.kind) {
    case 'text':
      return (block.size ?? FONT_SIZE) * 1.35 + (block.after ?? 0);
    case 'field':
      return FONT_SIZE * 1.35;
    case 'space':
      return block.height;
    case 'rule':
      return (block.thickness ?? 0.6) + (block.after ?? 0);
    case 'keepWithNext':
      return 0;
  }
}

const FOOTER_SPACE = 34;
const LABEL_WIDTH = 132;

/**
 * Lays blocks onto pages and writes the PDF.
 *
 * Pagination is a running cursor rather than a fixed lines-per-page count,
 * because the blocks are different heights. `keepWithNext` is what stops a
 * heading being orphaned at the foot of a page — it looks at the block after
 * it and breaks early if the pair will not fit together.
 */
export function renderDocumentPdf(doc: PdfDocument): Buffer {
  const usableBottom = MARGIN + (doc.footer ? FOOTER_SPACE : 0);
  const pages: PdfBlock[][] = [];
  let current: PdfBlock[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  doc.blocks.forEach((block, index) => {
    if (block.kind === 'keepWithNext') {
      const next = doc.blocks[index + 1];
      const pairHeight = blockHeight(block) + (next ? blockHeight(next) : 0);
      if (y - pairHeight < usableBottom && current.length > 0) {
        pages.push(current);
        current = [];
        y = PAGE_HEIGHT - MARGIN;
      }
      return;
    }

    const height = blockHeight(block);
    if (y - height < usableBottom && current.length > 0) {
      pages.push(current);
      current = [];
      y = PAGE_HEIGHT - MARGIN;
      // A blank line at the top of a new page is the previous page's spacing,
      // and it reads as a mistake.
      if (block.kind === 'space') return;
    }
    current.push(block);
    y -= height;
  });

  pages.push(current);

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  const FIRST_PAGE_OBJ = 5;
  pages.forEach((_, index) => pageObjectNumbers.push(FIRST_PAGE_OBJ + index * 2));

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  const rgb = (color: Rgb) => `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)}`;

  pages.forEach((pageBlocks, index) => {
    const pageObj = pageObjectNumbers[index]!;
    const contentObj = pageObj + 1;
    const parts: string[] = [];
    let cursor = PAGE_HEIGHT - MARGIN;

    const write = (
      text: string,
      x: number,
      baseline: number,
      size: number,
      bold: boolean,
      color: Rgb,
      tracked = false,
    ) => {
      parts.push('BT');
      parts.push(`${rgb(color)} rg`);
      parts.push(`/${bold ? 'F2' : 'F1'} ${size} Tf`);
      if (tracked) parts.push(`${(size * 0.09).toFixed(2)} Tc`);
      parts.push(`1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm`);
      parts.push(`(${escapePdfText(text)}) Tj`);
      if (tracked) parts.push('0 Tc');
      parts.push('ET');
    };

    for (const block of pageBlocks) {
      if (block.kind === 'space') {
        cursor -= block.height;
        continue;
      }

      if (block.kind === 'rule') {
        const thickness = block.thickness ?? 0.6;
        parts.push(`${rgb(block.color ?? RULE)} rg`);
        parts.push(
          `${MARGIN.toFixed(2)} ${(cursor - thickness).toFixed(2)} ` +
            `${USABLE_WIDTH.toFixed(2)} ${thickness.toFixed(2)} re f`,
        );
        cursor -= thickness + (block.after ?? 0);
        continue;
      }

      if (block.kind === 'field') {
        const baseline = cursor - FONT_SIZE;
        write(block.label, MARGIN, baseline, FONT_SIZE - 0.5, false, MUTED);
        write(block.value, MARGIN + LABEL_WIDTH, baseline, FONT_SIZE, true, INK);
        cursor -= FONT_SIZE * 1.35;
        continue;
      }

      // Never reaches a page — pagination consumes it — but the narrowing has
      // to be written down for the compiler and for the next reader.
      if (block.kind !== 'text') continue;

      const size = block.size ?? FONT_SIZE;
      const baseline = cursor - size;
      const x =
        block.align === 'right'
          ? MARGIN + USABLE_WIDTH - textWidth(block.text, size)
          : MARGIN;
      write(block.text, x, baseline, size, block.bold ?? false, block.color ?? INK, block.tracked);
      cursor -= size * 1.35 + (block.after ?? 0);
    }

    if (doc.footer) {
      const label = `${doc.footer}   |   Page ${index + 1} of ${pages.length}`;
      parts.push(`${rgb(RULE)} rg`);
      parts.push(`${MARGIN.toFixed(2)} ${(MARGIN + 20).toFixed(2)} ${USABLE_WIDTH.toFixed(2)} 0.5 re f`);
      write(label, MARGIN, MARGIN + 8, 7.5, false, MUTED);
    }

    const stream = parts.join('\n');
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  return assemblePdf(objects);
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

  return assemblePdf(objects);
}

/**
 * Objects in, file out: header, bodies, the xref table, the trailer.
 *
 * Shared by both renderers. The xref offsets have to be the exact byte
 * position of each object, which is why everything is written as latin1 and
 * measured as it goes — a multi-byte character counted as one byte shifts
 * every offset after it and the file opens as corrupt.
 */
function assemblePdf(objects: string[]): Buffer {
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
