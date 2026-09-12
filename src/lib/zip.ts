/**
 * A ZIP writer, stored (uncompressed), in about a hundred lines.
 *
 * ── Why not a library ──────────────────────────────────────────────────────
 * The pack this builds is site photographs and PDFs. Both are already
 * compressed, and DEFLATE over a JPEG typically saves under one percent while
 * costing CPU on a container that also serves the app. So the only thing a zip
 * dependency would buy here is the thing we do not want.
 *
 * Store-only ZIP is a format worth owning rather than importing: it is a local
 * header, the bytes, and a central directory, all of it fixed-width and
 * documented in APPNOTE.TXT. Every unzipper on earth reads it, including the
 * ones built into Windows and macOS.
 *
 * ── The limits, stated ─────────────────────────────────────────────────────
 * No ZIP64, so this tops out at 4 GB and at 65,535 entries. Both are far above
 * an evidence pack for one change, and the caller caps the pack well below
 * either. If that ever stops being true the failure must be loud, so `zipStore`
 * throws rather than writing an archive that silently truncates.
 */

/** CRC-32, the table built once on first use. */
let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date and time, which is what ZIP stores.
 *
 * Two-second resolution and no timezone, because the format was designed in
 * 1989 and every unzipper still expects exactly this. Dates before 1980 cannot
 * be represented and are clamped rather than wrapping into nonsense.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes, no leading slash. */
  name: string;
  content: Uint8Array;
  /** Defaults to now. Set it so a rebuilt pack is byte-identical. */
  modified?: Date;
}

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/**
 * Sanitises a path so an entry cannot escape the archive root.
 *
 * The names here come from filenames people typed, and `../../etc/passwd` in a
 * zip is a real and old attack — some unzippers still honour it. Backslashes
 * are normalised too, because a Windows-typed name would otherwise arrive as
 * one long filename on Unix.
 */
function safeName(name: string): string {
  return name
    .split('\\')
    .join('/')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/');
}

export function zipStore(entries: readonly ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Too many files for a ZIP without ZIP64: ${entries.length}`);
  }

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(safeName(entry.name), 'utf8');
    const { content } = entry;
    const crc = crc32(content);
    const { time, date } = dosDateTime(entry.modified ?? new Date());

    if (offset + content.length > MAX_BYTES) {
      throw new Error('Archive would exceed 4 GB, which needs ZIP64');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed: 2.0
    // Bit 11 says the name is UTF-8. Without it, an Arabic or accented
    // filename is decoded as the unzipper's codepage and arrives as mojibake.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); // method 0: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18); // compressed size
    local.writeUInt32LE(content.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    locals.push(local, name, Buffer.from(content));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // offset of the local header

    centrals.push(central, name);

    offset += local.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centrals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDirectory, end]);
}

/**
 * Makes a filename unique within a pack.
 *
 * Two photographs from one WhatsApp thread are routinely both called
 * `image.jpg`. A zip permits duplicate names and unzippers resolve them
 * differently -- some overwrite, some append (1), one asks -- so the archive
 * decides rather than leaving it to chance and losing a piece of evidence.
 */
export function uniqueName(taken: Set<string>, name: string): string {
  const safe = safeName(name) || 'file';
  if (!taken.has(safe)) {
    taken.add(safe);
    return safe;
  }

  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';

  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
