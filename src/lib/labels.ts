/**
 * Turning a database enum into something a person reads.
 *
 * This lives in `lib` rather than in a service because the same label has to
 * appear in server components, in client components and on the printed report.
 * It had grown three separate implementations — dashboard.service, StatusChip
 * and the register peek drawer — and they disagreed: two of them rendered
 * `qs_pricing` as "Qs Pricing" on a document that goes to a consultant.
 */

/** Trade acronyms, which are not words and must not be title-cased into them. */
const ACRONYMS = new Set(['qs', 'pm', 'cm', 'md', 'mep', 'eot', 'vo', 'rfi', 'si', 'boq', 'hse']);

/** Proper nouns that own their own capitalisation. */
const PROPER_NOUNS: Record<string, string> = {
  whatsapp: 'WhatsApp',
};

/**
 * `qs_pricing` → "QS pricing". Sentence case, not title case: only the first
 * word is capitalised, because a status is a phrase rather than a heading.
 *
 * Do NOT add a `capitalize` CSS class on top of this. That was how "QS pricing"
 * became "QS Pricing" and "11 days" became "11 Days" — the class title-cases
 * every word, including the ones this function deliberately left alone.
 */
export function humanise(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      if (PROPER_NOUNS[lower]) return PROPER_NOUNS[lower];
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(' ');
}
