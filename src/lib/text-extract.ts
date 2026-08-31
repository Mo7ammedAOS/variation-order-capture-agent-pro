import 'server-only';

/**
 * Pulls readable text out of the commercial documents.
 *
 * Only the files the system needs to REASON about: contract, BOQ, rates,
 * specification, scope. Drawings and photos are evidence — they are stored and
 * served, never read. Osman was explicit about that, and it is also the honest
 * boundary: reading a drawing well is a different product.
 *
 * Every extractor returns plain text or throws. A file that cannot be read is
 * still uploaded and still served; it simply is not searchable, and the
 * document says so rather than pretending it was indexed.
 */

export interface ExtractedText {
  text: string;
  /** What managed to read it, recorded so a bad extractor is traceable later. */
  extractor: 'pdf' | 'spreadsheet' | 'plain';
}

export const INDEXABLE_MIME_PREFIXES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml',
  'application/vnd.ms-excel',
  'text/',
] as const;

export function isIndexable(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return INDEXABLE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export async function extractText(
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractedText> {
  if (mimeType.startsWith('application/pdf')) {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await pdfText(pdf, { mergePages: true });
    return { text: normaliseWhitespace(String(text)), extractor: 'pdf' };
  }

  if (
    mimeType.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml') ||
    mimeType.startsWith('application/vnd.ms-excel') ||
    fileName.toLowerCase().endsWith('.xlsx')
  ) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

    const lines: string[] = [];
    workbook.eachSheet((sheet) => {
      lines.push(`# ${sheet.name}`);
      sheet.eachRow((row) => {
        // Row values are 1-indexed with a hole at 0, and a BOQ line means
        // nothing split across cells — the description, unit, quantity and rate
        // have to stay on one line or a search for "marble cladding" finds the
        // words and loses the rate beside them.
        const cells = (row.values as unknown[])
          .slice(1)
          .map((cell) => cellToText(cell))
          .filter((value) => value !== '');
        if (cells.length > 0) lines.push(cells.join(' | '));
      });
    });

    return { text: normaliseWhitespace(lines.join('\n')), extractor: 'spreadsheet' };
  }

  if (mimeType.startsWith('text/')) {
    return { text: normaliseWhitespace(bytes.toString('utf8')), extractor: 'plain' };
  }

  throw new Error(`No extractor for ${mimeType}`);
}

function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object') {
    const rich = cell as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (Array.isArray(rich.richText)) return rich.richText.map((r) => r.text).join('');
    // A formula cell carries its cached result. The formula itself is noise.
    if (rich.result !== undefined) return String(rich.result);
    if (typeof rich.text === 'string') return rich.text;
    return '';
  }
  return String(cell).trim();
}

function normaliseWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Splits text into overlapping windows.
 *
 * The overlap is the point. A BOQ item whose description ends one chunk and
 * whose rate begins the next would otherwise be findable by description and
 * useless for price — which is the exact question this is built to answer.
 */
export function chunkText(text: string, size = 1200, overlap = 200): string[] {
  const clean = text.trim();
  if (clean.length === 0) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    // Prefer a line break near the end, so a chunk rarely stops mid-sentence.
    if (end < clean.length) {
      const breakAt = clean.lastIndexOf('\n', end);
      if (breakAt > start + size * 0.5) end = breakAt;
    }

    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}
