/**
 * Taking the email apart from the report inside it.
 *
 * A site engineer writes two lines and his mail client adds fifteen: a
 * signature block, a job title, a phone number, a legal disclaimer nobody has
 * read since 2004, and — on a reply — the entire conversation so far. All of
 * that was going straight into `potential_changes.description`, which is the
 * field printed verbatim under WHAT HAPPENED in a contractual notice. A notice
 * quoting somebody's email footer is not a good look in an adjudication.
 *
 * ── Why this is deterministic and not a model ──────────────────────────────
 * Three reasons, in order of weight:
 *
 *   1. It runs BEFORE project matching. A signature reading "Structural
 *      Engineer | Al Futtaim Contracting" would otherwise match a client name
 *      and have us propose the wrong job — a wrong answer delivered with a
 *      straight face. Cutting it is a correctness fix, not tidying.
 *   2. It must work when the model is off, down, or declining. Capture cannot
 *      depend on a third party having a good afternoon.
 *   3. It only ever DELETES. It never rewrites a word, so it cannot change
 *      what the engineer said — and what he said may be quoted in a notice.
 *
 * The model's job is the separate one: a standardised restatement, stored in
 * its own field, never substituted for the original.
 *
 * ── The rule that governs every regex below ────────────────────────────────
 * When in doubt, keep it. A signature that survives is untidy. A report that
 * gets eaten by an over-eager matcher is a lost variation, and nobody finds
 * out until the money is gone. If cleaning would empty the message, the
 * original is returned untouched.
 */

export interface CleanedText {
  text: string;
  /** What was cut, for the audit trail. Empty when nothing matched. */
  removed: string[];
}

interface CutRule {
  label: string;
  /** True when this line begins a block that is not part of the report. */
  matches: (line: string, index: number, lines: string[]) => boolean;
}

/** Everything from the first matching line to the end is not the report. */
const CUT_RULES: CutRule[] = [
  {
    // RFC 3676: a line of exactly "-- " is the signature delimiter, and mail
    // clients have honoured it for thirty years.
    label: 'signature',
    matches: (line) => /^--\s*$/.test(line),
  },
  {
    label: 'quoted reply',
    matches: (line) => /^-{2,}\s*original message\s*-{2,}$/i.test(line.trim()),
  },
  {
    // "On 1 Sep 2026 at 09:14, Someone <a@b.com> wrote:". Required to carry a
    // year or an address, so a sentence ending "he wrote:" is not mistaken for
    // a quote header and used to delete the rest of the report.
    label: 'quoted reply',
    matches: (line) =>
      /\bwrote:\s*$/i.test(line) && (/@/.test(line) || /\b(19|20)\d{2}\b/.test(line)),
  },
  {
    // Outlook's quoted header. Only when the lines under it look like mail
    // headers too — "From: the client, they want it moved" is a report.
    label: 'quoted reply',
    matches: (line, index, lines) =>
      /^from:\s*\S/i.test(line.trim()) &&
      lines
        .slice(index + 1, index + 5)
        .some((next) => /^(sent|to|date|subject|cc):\s*\S/i.test(next.trim())),
  },
  {
    // Outlook's horizontal rule above a quoted message.
    label: 'quoted reply',
    matches: (line) => /^_{5,}$/.test(line.trim()),
  },
  {
    label: 'mail client footer',
    matches: (line) =>
      /^(sent from my\b|sent from mail for\b|get outlook for\b|get bluemail for\b)/i.test(
        line.trim(),
      ),
  },
  {
    label: 'disclaimer',
    matches: (line) => {
      const trimmed = line.trim();
      if (/^(disclaimer|confidentiality notice)\b/i.test(trimmed)) return true;
      // Long enough to be the real paragraph and not a sentence that happens
      // to start the same way.
      return (
        trimmed.length > 60 &&
        /^(this (e-?mail|message|communication)|the information contained|the contents of this)/i.test(
          trimmed,
        )
      );
    },
  },
];

/** A line carrying no report content, safe to drop from the end. */
function isTrailingNoise(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  if (/^>/.test(trimmed)) return true;
  if (/^(https?:\/\/|www[.…])/i.test(trimmed)) return true;
  // A bare phone number, however it is punctuated.
  if (/^[+()\d][\d\s()+.\-]{6,}$/.test(trimmed)) return true;
  return false;
}

export function cleanCapturedText(raw: string): CleanedText {
  const original = raw ?? '';
  if (!original.trim()) return { text: original, removed: [] };

  const lines = original.replace(/\r\n?/g, '\n').split('\n');
  const removed = new Set<string>();

  // Find the EARLIEST cut. A reply usually carries a signature and a quoted
  // history, and only the first of them matters.
  let cut = lines.length;
  for (const rule of CUT_RULES) {
    for (let i = 0; i < cut; i++) {
      const line = lines[i];
      if (line !== undefined && rule.matches(line, i, lines)) {
        cut = i;
        removed.add(rule.label);
        break;
      }
    }
  }

  // Rules that matched only after an earlier cut are not really removed — the
  // earlier cut took them. Re-check against the surviving text.
  let kept = lines.slice(0, cut);

  // Quoted lines anywhere in what is left: an inline reply interleaves them.
  const withoutQuotes = kept.filter((line) => !/^\s*>/.test(line));
  if (withoutQuotes.length !== kept.length) {
    removed.add('quoted reply');
    kept = withoutQuotes;
  }

  // Trailing links, phone numbers and blank lines — the tail of a signature
  // that carried no "--" delimiter to cut at.
  let end = kept.length;
  while (end > 0) {
    const line = kept[end - 1];
    if (line === undefined || !isTrailingNoise(line)) break;
    if (line.trim() !== '') removed.add('contact details');
    end--;
  }
  kept = kept.slice(0, end);

  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Everything was cut. Whatever the rules thought they saw, this message is
  // now a lost report, and a lost report is far worse than a kept signature.
  if (!text) return { text: original.trim(), removed: [] };

  return { text, removed: [...removed] };
}
