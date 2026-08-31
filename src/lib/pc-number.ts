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
