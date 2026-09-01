import { describe, expect, it } from 'vitest';
import { formatCreditNoteNumber, formatPcNumber, isValidPcNumber, parsePcNumber } from '@/lib/pc-number';
import { ValidationError } from '@/lib/errors';

describe('PC number', () => {
  it('formats to the specified shape', () => {
    expect(formatPcNumber('DXB-001', 42)).toBe('PC-DXB-001-0042');
    expect(formatPcNumber('DXB-001', 1)).toBe('PC-DXB-001-0001');
    expect(formatPcNumber('AUH2', 1234)).toBe('PC-AUH2-1234');
  });

  it('upper-cases the project code', () => {
    expect(formatPcNumber('dxb-001', 7)).toBe('PC-DXB-001-0007');
  });

  it('pads to four digits and does not truncate beyond', () => {
    expect(formatPcNumber('DXB-001', 12345)).toBe('PC-DXB-001-12345');
  });

  it('rejects a sequence that is not a positive integer', () => {
    expect(() => formatPcNumber('DXB-001', 0)).toThrow(ValidationError);
    expect(() => formatPcNumber('DXB-001', -1)).toThrow(ValidationError);
    expect(() => formatPcNumber('DXB-001', 1.5)).toThrow(ValidationError);
  });

  it('rejects a malformed project code', () => {
    expect(() => formatPcNumber('', 1)).toThrow(ValidationError);
    expect(() => formatPcNumber('DXB 001', 1)).toThrow(ValidationError);
    expect(() => formatPcNumber('-DXB', 1)).toThrow(ValidationError);
  });

  it('round-trips through the parser, hyphenated project codes included', () => {
    const parsed = parsePcNumber('PC-DXB-001-0042');
    expect(parsed).toEqual({ projectCode: 'DXB-001', sequence: 42 });
  });

  it('rejects strings that are not PC numbers', () => {
    expect(parsePcNumber('VO-DXB-001-0042')).toBeNull();
    expect(parsePcNumber('PC-DXB-001-abcd')).toBeNull();
    expect(parsePcNumber('PC-0042')).toBeNull();
    expect(isValidPcNumber('nonsense')).toBe(false);
  });
});

describe('credit note numbers', () => {
  it('carry their own series, so a credit never shares a reference with an invoice', () => {
    expect(formatCreditNoteNumber('DXB-001', 1)).toBe('CN-DXB-001-0001');
    expect(formatCreditNoteNumber('DXB-001', 42)).toBe('CN-DXB-001-0042');
  });

  it('refuse a malformed project code, like every other series', () => {
    expect(() => formatCreditNoteNumber('dxb 001', 1)).toThrow();
  });
});
