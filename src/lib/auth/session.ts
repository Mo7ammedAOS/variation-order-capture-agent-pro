import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { UnauthenticatedError } from '@/lib/errors';
import { createSupabaseServerClient } from '@/lib/auth/supabase';
import { toAuthenticatedUser, type AuthenticatedUser } from '@/lib/auth/provider';

/**
 * Session resolution, per request.
 *
 * Supabase says WHO the caller is. Our `users` table says what they ARE — the
 * system role, and whether they are still active. Both are required: a valid
 * Supabase session for a deactivated person is not a session, and that check
 * has to happen here rather than being remembered at each call site.
 *
 * `cache` dedupes this within a single request, so a page that renders six
 * components does one lookup.
 */

export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const record = await prisma.user.findUnique({ where: { id: user.id } });

  // An identity with no profile row, or a deactivated one, is not signed in.
  // A leaver keeps their Supabase identity so the audit trail still resolves
  // to a real person; `active: false` is what actually revokes access.
  if (!record || !record.active) return null;

  return toAuthenticatedUser(record);
});

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}
