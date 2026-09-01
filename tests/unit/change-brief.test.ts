import { describe, expect, it } from 'vitest';
import { briefOf, matchChangeInText } from '@/lib/change-brief';

const CHANGES = [
  { id: 'pc-1', pcNumber: 'PC-DXB-001-0001' },
  { id: 'pc-2', pcNumber: 'PC-DXB-001-0002' },
  { id: 'pc-3', pcNumber: 'PC-DXB-001-0014' },
];

describe('describing a change in a few words', () => {
  it('uses the title, which is already short', () => {
    expect(briefOf({ title: 'Reception ceiling grid lowered 300mm' })).toBe(
      'Reception ceiling grid lowered 300mm',
    );
  });

  it('trims anything a phone would wrap', () => {
    const brief = briefOf({
      title: 'one two three four five six seven eight nine ten eleven twelve',
    });
    expect(brief).toBe('one two three four five six seven eight nine…');
    expect(brief.split(' ')).toHaveLength(9);
  });

  it('falls back through summary to description rather than showing a blank line', () => {
    expect(briefOf({ title: '   ', summary: 'Marble swapped for porcelain' })).toBe(
      'Marble swapped for porcelain',
    );
    expect(briefOf({ title: '', summary: null, description: 'Extra sockets on level 2' })).toBe(
      'Extra sockets on level 2',
    );
    expect(briefOf({ title: '', summary: null, description: '' })).toBe('No description');
  });
});

describe('naming a change, however it is written', () => {
  it('reads the full reference', () => {
    expect(matchChangeInText('PC-DXB-001-0002', CHANGES)?.id).toBe('pc-2');
  });

  it('does not care about the punctuation', () => {
    expect(matchChangeInText('pc dxb001 0002 please', CHANGES)?.id).toBe('pc-2');
    expect(matchChangeInText('PCDXB0010002', CHANGES)?.id).toBe('pc-2');
  });

  it('reads the bare sequence', () => {
    expect(matchChangeInText('0014', CHANGES)?.id).toBe('pc-3');
  });

  it('leaves a small number alone, because that is the list position', () => {
    // "2" means the second line of the message they are looking at. Reading it
    // as PC-...-0002 as well would make one reply mean two different things.
    expect(matchChangeInText('2', CHANGES)).toBeNull();
  });

  it('refuses when the reply names two of them', () => {
    expect(matchChangeInText('0001 and 0002', CHANGES)).toBeNull();
  });

  it('says nothing when nothing is named', () => {
    expect(matchChangeInText('the ceiling one', CHANGES)).toBeNull();
    expect(matchChangeInText('', CHANGES)).toBeNull();
  });
});
