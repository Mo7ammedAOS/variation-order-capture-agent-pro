import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv } from '@/lib/csv';

/**
 * The register export.
 *
 * Three of these guard against silent corruption rather than a crash, which is
 * the dangerous kind: the file opens, the QS reads it, and one column has
 * slipped sideways.
 */

describe('escaping', () => {
  it('quotes a field containing a comma, so the columns do not shift', () => {
    const csv = toCsv(['a', 'b'], [['Reception, Level 2', 'ok']]);
    expect(csv).toContain('"Reception, Level 2",ok');
  });

  it('doubles an embedded quote rather than ending the field', () => {
    const csv = toCsv(['a'], [['He said "do it now"']]);
    expect(csv).toContain('"He said ""do it now"""');
  });

  it('keeps a line break inside one cell', () => {
    // A site engineer typing on a phone hits return. Without quoting, this
    // becomes two rows and every column after it belongs to the wrong change.
    const csv = toCsv(['a', 'b'], [['first\nsecond', 'x']]);
    expect(csv).toContain('"first\nsecond",x');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('leaves an ordinary field unquoted', () => {
    expect(toCsv(['a'], [['plain']])).toContain('\r\nplain\r\n');
  });
});

describe('the things Excel does that nobody asked for', () => {
  it('starts with a byte-order mark, or Arabic arrives as mojibake', () => {
    expect(toCsv(['اسم'], [['مشروع']]).startsWith('﻿')).toBe(true);
  });

  it('defuses a field that would otherwise be read as a formula', () => {
    // CSV injection: this is a description somebody typed, not a calculation.
    const csv = toCsv(['a'], [['=HYPERLINK("http://evil","click")']]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
  });

  it('defuses +, - and @ the same way', () => {
    expect(toCsv(['a'], [['+1']])).toContain("'+1");
    expect(toCsv(['a'], [['-1']])).toContain("'-1");
    expect(toCsv(['a'], [['@SUM']])).toContain("'@SUM");
  });

  it('does not mangle a negative number that is genuinely a number', () => {
    // It still gets the guard, and that is the right trade: a leading quote is
    // invisible in Excel, a live formula in a claim register is not.
    expect(toCsv(['a'], [[-1500]])).toContain("'-1500");
  });
});

describe('values', () => {
  it('writes a date as an ISO day, not a locale string', () => {
    const csv = toCsv(['when'], [[new Date('2026-09-12T11:00:00Z')]]);
    expect(csv).toContain('2026-09-12');
  });

  it('writes null and undefined as empty, never as the words', () => {
    const csv = toCsv(['a', 'b'], [[null, undefined]]);
    expect(csv).toContain('\r\n,\r\n');
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
  });

  it('keeps a zero, which is a real answer', () => {
    expect(toCsv(['a'], [[0]])).toContain('\r\n0\r\n');
  });
});

describe('the filename', () => {
  it('carries the date so repeated exports do not collide', () => {
    expect(csvFilename('variation-register', new Date('2026-09-12T11:00:00Z'))).toBe(
      'variation-register-2026-09-12.csv',
    );
  });

  it('strips anything a filesystem would object to', () => {
    expect(csvFilename('DXB-001 / Office Fit-Out', new Date('2026-01-02T00:00:00Z'))).toBe(
      'DXB-001-Office-Fit-Out-2026-01-02.csv',
    );
  });
});
