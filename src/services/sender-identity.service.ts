import 'server-only';
import type { SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Working out who sent a captured message.
 *
 * ── Why this is not a one line `findFirst` ─────────────────────────────────
 * It was, and on this deployment every active user shares one phone number.
 * `findFirst` on that returns whichever row the database felt like returning,
 * so a WhatsApp from the site would have been filed under an arbitrary
 * colleague — the reporter's name on the record, in the audit trail, and in
 * the answer to "who told us about this" six months later when it matters.
 *
 * No error. No warning. A confident wrong answer, which is the only kind of
 * wrong answer this system must never give.
 *
 * So an identifier that matches more than one person resolves to AMBIGUOUS,
 * the message is parked, and the reason says exactly what is wrong and how to
 * fix it. A message in a queue gets dealt with. A message filed under the
 * wrong name looks handled and is never opened again.
 *
 * Email is unique by database constraint and cannot be ambiguous. Phone is
 * not, and deliberately so: two people genuinely can share a site handset, and
 * forbidding it at the schema level would push the problem into somebody
 * creating a fake second number.
 */

export type SenderIdentity =
  | { kind: 'one'; userId: string; fullName: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number; names: string[] };

export async function resolveSender(
  channel: Extract<SourceType, 'whatsapp' | 'email'>,
  identifier: string,
): Promise<SenderIdentity> {
  const trimmed = identifier.trim();
  if (!trimmed) return { kind: 'none' };

  const matches = await prisma.user.findMany({
    where: {
      active: true,
      ...(channel === 'whatsapp'
        ? { phone: trimmed }
        : { email: trimmed.toLowerCase() }),
    },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
    // Three is enough to say "several" and to name a couple of them. Reading
    // the whole table to count a fault is work nobody benefits from.
    take: 3,
  });

  const first = matches[0];
  if (!first) return { kind: 'none' };

  if (matches.length > 1) {
    return {
      kind: 'ambiguous',
      count: matches.length,
      names: matches.map((user) => user.fullName),
    };
  }

  return { kind: 'one', userId: first.id, fullName: first.fullName };
}

/** The sentence put in front of a human when we cannot tell who sent it. */
export function ambiguousSenderReason(
  identity: Extract<SenderIdentity, { kind: 'ambiguous' }>,
  channel: Extract<SourceType, 'whatsapp' | 'email'>,
  identifier: string,
): string {
  const names = identity.names.join(', ');
  const more = identity.count >= 3 ? ' and others' : '';
  return (
    `${identifier} belongs to more than one active user (${names}${more}), so there is ` +
    `no way to tell who sent this. File it by hand, and give each person their own ` +
    `${channel === 'whatsapp' ? 'number' : 'address'} so the next one attributes itself.`
  );
}
