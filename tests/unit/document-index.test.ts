import { describe, expect, it } from 'vitest';
import { chunkText } from '@/lib/text-extract';
import { monthFolderName, dayFolderName } from '@/services/document.service';

/**
 * The library the system reasons from, and where evidence lands.
 */

describe('splitting a document for search', () => {
  it('keeps a short document whole', () => {
    expect(chunkText('Reception wall, marble cladding, 40mm.')).toHaveLength(1);
  });

  it('overlaps chunks, so a BOQ description keeps its rate', () => {
    // The failure this prevents: an item whose description ends one chunk and
    // whose rate begins the next is findable by name and useless for price —
    // which is the exact question the index exists to answer.
    //
    // Every line is distinct, otherwise "it appears in both chunks" would be
    // true whether the overlap worked or not.
    const lines = Array.from(
      { length: 60 },
      (_, i) => `Item ${i} | marble cladding zone ${i} | m2 | 120 | AED ${300 + i}.00`,
    );
    const chunks = chunkText(lines.join('\n'), 400, 150);

    expect(chunks.length).toBeGreaterThan(1);

    const tailOfFirst = chunks[0]!.trim().split('\n').at(-1)!;
    expect(chunks[1]).toContain(tailOfFirst);
  });

  it('returns nothing for an empty document rather than an empty chunk', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});

describe('where evidence lands in Drive', () => {
  const eventDate = new Date(Date.UTC(2026, 8, 1)); // 1 September 2026

  it('names the month the way people say it', () => {
    expect(monthFolderName(eventDate)).toBe('September');
  });

  it('names the day folder as Osman specified', () => {
    expect(dayFolderName('DXB-001', eventDate)).toBe('DXB-001-01092026');
  });

  it('pads single digits, so the name is always the same length', () => {
    expect(dayFolderName('AUH-003', new Date(Date.UTC(2026, 0, 5)))).toBe('AUH-003-05012026');
  });

  it('reads the date in UTC, not the runner timezone', () => {
    // A change captured at 02:00 Dubai is still the same calendar day here.
    // Local getDate() would file it under the day before on a UTC server.
    expect(dayFolderName('DXB-002', new Date('2026-09-01T22:30:00Z'))).toBe('DXB-002-01092026');
  });
});
