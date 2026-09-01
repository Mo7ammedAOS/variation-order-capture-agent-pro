import { ValidationError } from '@/lib/errors';

/**
 * PC-{PROJECT_CODE}-{SEQUENCE}, e.g. PC-DXB-001-0042.
 *
 * The sequence is zero-padded to four digits, which reads correctly in a sorted
 * column and leaves room for 9,999 changes on a project. The project code may
 * itself contain hyphens (DXB-001), so parsing splits from the right.
 */

export const PC_SEQUENCE_PAD = 4;
const PROJECT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/;

export function formatPcNumber(projectCode: string, sequence: number): string {
  const code = projectCode.trim().toUpperCase();

  if (!PROJECT_CODE_PATTERN.test(code)) {
    throw new ValidationError(
      `Project code "${projectCode}" must be upper-case alphanumerics and hyphens, e.g. DXB-001`,
    );
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new ValidationError('PC sequence must be a positive integer');
  }

  return `PC-${code}-${String(sequence).padStart(PC_SEQUENCE_PAD, '0')}`;
}

export function parsePcNumber(
  pcNumber: string,
): { projectCode: string; sequence: number } | null {
  const trimmed = pcNumber.trim().toUpperCase();
  if (!trimmed.startsWith('PC-')) return null;

  const body = trimmed.slice(3);
  const lastDash = body.lastIndexOf('-');
  if (lastDash <= 0) return null;

  const projectCode = body.slice(0, lastDash);
  const sequencePart = body.slice(lastDash + 1);

  if (!/^\d+$/.test(sequencePart)) return null;
  if (!PROJECT_CODE_PATTERN.test(projectCode)) return null;

  const sequence = Number.parseInt(sequencePart, 10);
  if (sequence < 1) return null;

  return { projectCode, sequence };
}

export function isValidPcNumber(pcNumber: string): boolean {
  return parsePcNumber(pcNumber) !== null;
}

/**
 * NOT-{PROJECT_CODE}-{SEQUENCE}, e.g. NOT-DXB-001-0007.
 *
 * Same shape and the same rules as a PC number, on its own counter. Sharing
 * one counter would make the two series interleave, and a gap in a notice
 * register is the first thing a claim consultant asks about.
 */
export function formatNoticeReference(projectCode: string, sequence: number): string {
  const code = projectCode.trim().toUpperCase();

  if (!PROJECT_CODE_PATTERN.test(code)) {
    throw new ValidationError(
      `Project code "${projectCode}" must be upper-case alphanumerics and hyphens, e.g. DXB-001`,
    );
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new ValidationError('Notice sequence must be a positive integer');
  }

  return `NOT-${code}-${String(sequence).padStart(PC_SEQUENCE_PAD, '0')}`;
}

/**
 * VO-{PROJECT_CODE}-{SEQUENCE} and INV-{PROJECT_CODE}-{SEQUENCE}.
 *
 * Three series on a project, all separate: a VO number is quoted on a payment
 * certificate and an invoice number on a bank transfer, so neither may move
 * because something upstream was renumbered. Per project rather than
 * company-wide, because a company-wide invoice series tells every client how
 * much work the contractor has on from the size of the gaps.
 */
export function formatVoNumber(projectCode: string, sequence: number): string {
  return formatSeries('VO', projectCode, sequence, 'VO');
}

export function formatInvoiceNumber(projectCode: string, sequence: number): string {
  return formatSeries('INV', projectCode, sequence, 'Invoice');
}

/**
 * Its own series, not a suffix on the invoice it credits.
 *
 * A credit note is quoted in correspondence and reconciled against a client's
 * own ledger. Sharing a number with the invoice would mean two documents with
 * the same reference and opposite signs, which is exactly the confusion the
 * document exists to remove.
 */
export function formatCreditNoteNumber(projectCode: string, sequence: number): string {
  return formatSeries('CN', projectCode, sequence, 'Credit note');
}

function formatSeries(
  prefix: string,
  projectCode: string,
  sequence: number,
  label: string,
): string {
  const code = projectCode.trim().toUpperCase();

  if (!PROJECT_CODE_PATTERN.test(code)) {
    throw new ValidationError(
      `Project code "${projectCode}" must be upper-case alphanumerics and hyphens, e.g. DXB-001`,
    );
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new ValidationError(`${label} sequence must be a positive integer`);
  }

  return `${prefix}-${code}-${String(sequence).padStart(PC_SEQUENCE_PAD, '0')}`;
}
