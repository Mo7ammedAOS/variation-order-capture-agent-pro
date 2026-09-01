/**
 * Naming a Potential Change in a WhatsApp message.
 *
 * Two problems, both about the same thing: a person on site cannot pick from a
 * list they have to squint at, and cannot be expected to type a reference
 * exactly as the database holds it.
 */

export interface BriefableChange {
  title: string;
  summary?: string | null;
  description?: string | null;
}

export interface SelectableChange {
  id: string;
  pcNumber: string;
}

/**
 * A few words that say which change this is.
 *
 * Long enough to recognise, short enough to read five of on a phone in a
 * corridor. A list where every line wraps is a list nobody reads, and a
 * reporter who cannot tell the options apart picks one at random, which is
 * worse than not asking.
 */
export function briefOf(change: BriefableChange, maxWords = 9): string {
  const source =
    firstUseful(change.title) ??
    firstUseful(change.summary) ??
    firstUseful(change.description) ??
    'No description';

  const words = source.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function firstUseful(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The change somebody named, however they wrote it.
 *
 * `PC-DXB-001-0002`, `pc dxb001 0002`, and the bare sequence `0002` are one
 * answer. The bare sequence is accepted at three digits or more so it cannot
 * collide with the list positions printed beside the options: "2" means the
 * second line, "0002" means that reference, and no reply can mean both.
 *
 * Returns null when more than one change is named, because a reply that names
 * two is not a choice.
 */
export function matchChangeInText<T extends SelectableChange>(
  text: string,
  changes: T[],
): T | null {
  const squashed = text.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (squashed === '') return null;

  const hits: T[] = [];

  for (const change of changes) {
    const full = change.pcNumber.toUpperCase().replace(/[^A-Z0-9]+/g, '');
    if (full !== '' && squashed.includes(full)) {
      hits.push(change);
      continue;
    }

    const sequence = change.pcNumber.match(/(\d{3,})\s*$/)?.[1];
    if (sequence && new RegExp(`(?<!\\d)${sequence}(?!\\d)`).test(squashed)) {
      hits.push(change);
    }
  }

  const unique = [...new Set(hits)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}
