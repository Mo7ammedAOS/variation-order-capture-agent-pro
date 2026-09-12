import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uniqueName, zipStore } from '@/lib/zip';

/**
 * The evidence pack archive.
 *
 * The last test here is the one that matters: it hands the bytes to the
 * operating system's own unzipper. A hand-written ZIP that only this code can
 * read would pass every structural assertion and fail on the first claim
 * somebody tried to submit.
 */

const bytes = (text: string) => new TextEncoder().encode(text);

describe('structure', () => {
  it('starts with a local file header and ends with the central directory', () => {
    const zip = zipStore([{ name: 'a.txt', content: bytes('hello') }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it('counts the entries in the end record', () => {
    const zip = zipStore([
      { name: 'a.txt', content: bytes('a') },
      { name: 'b.txt', content: bytes('b') },
      { name: 'c.txt', content: bytes('c') },
    ]);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(3);
  });

  it('writes an empty archive rather than throwing', () => {
    // A change with no evidence still produces a pack, with the summary in it.
    const zip = zipStore([]);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
    expect(zip.length).toBe(22);
  });

  it('marks names as UTF-8, or Arabic filenames arrive as mojibake', () => {
    const zip = zipStore([{ name: 'صورة.jpg', content: bytes('x') }]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
  });
});

describe('path safety', () => {
  it('strips a traversal, so an entry cannot escape the folder', () => {
    const zip = zipStore([{ name: '../../etc/passwd', content: bytes('x') }]);
    expect(zip.toString('latin1')).toContain('etc/passwd');
    expect(zip.toString('latin1')).not.toContain('../');
  });

  it('normalises a Windows-style path', () => {
    const zip = zipStore([{ name: 'Evidence\\photo.jpg', content: bytes('x') }]);
    expect(zip.toString('latin1')).toContain('Evidence/photo.jpg');
  });
});

describe('unique names', () => {
  it('leaves the first one alone', () => {
    expect(uniqueName(new Set(), 'image.jpg')).toBe('image.jpg');
  });

  it('numbers a duplicate instead of letting the unzipper decide', () => {
    // Two photos from one WhatsApp thread really are both called image.jpg,
    // and some unzippers silently overwrite -- losing a piece of evidence.
    const taken = new Set<string>();
    expect(uniqueName(taken, 'image.jpg')).toBe('image.jpg');
    expect(uniqueName(taken, 'image.jpg')).toBe('image (2).jpg');
    expect(uniqueName(taken, 'image.jpg')).toBe('image (3).jpg');
  });

  it('keeps the extension where there is one, and copes without', () => {
    const taken = new Set(['notes']);
    expect(uniqueName(taken, 'notes')).toBe('notes (2)');
  });

  it('never returns an empty name', () => {
    expect(uniqueName(new Set(), '../')).toBe('file');
  });
});

describe('the archive a real unzipper sees', () => {
  it('round-trips through the system unzip, with contents intact', () => {
    const zip = zipStore([
      { name: 'summary.txt', content: bytes('PC-DXB-001-0012'), modified: new Date('2026-09-12T10:00:00Z') },
      { name: 'Evidence/photo.txt', content: bytes('not really a photo'), modified: new Date('2026-09-12T10:00:00Z') },
    ]);

    const dir = mkdtempSync(join(tmpdir(), 'vo-zip-'));
    const path = join(dir, 'pack.zip');
    writeFileSync(path, zip);

    // `unzip` is present on macOS and on the Linux image this runs in. If it
    // ever is not, this test failing loudly is the correct outcome -- the
    // whole point is to check against something we did not write.
    execFileSync('unzip', ['-q', path, '-d', join(dir, 'out')]);

    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['Evidence', 'summary.txt']);
    expect(readFileSync(join(dir, 'out', 'summary.txt'), 'utf8')).toBe('PC-DXB-001-0012');
    expect(readFileSync(join(dir, 'out', 'Evidence', 'photo.txt'), 'utf8')).toBe(
      'not really a photo',
    );
  });

  it('survives binary content unchanged', () => {
    const binary = new Uint8Array(1024);
    for (let i = 0; i < binary.length; i += 1) binary[i] = (i * 7) % 256;

    const dir = mkdtempSync(join(tmpdir(), 'vo-zip-'));
    const path = join(dir, 'pack.zip');
    writeFileSync(path, zipStore([{ name: 'blob.bin', content: binary }]));
    execFileSync('unzip', ['-q', path, '-d', join(dir, 'out')]);

    expect(new Uint8Array(readFileSync(join(dir, 'out', 'blob.bin')))).toEqual(binary);
  });
});
