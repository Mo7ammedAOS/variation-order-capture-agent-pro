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
 *
 * The token is verified with `getClaims()`, not `getUser()`. Both are real
 * verification, but this project signs with ES256, so `getClaims()` checks the
 * signature locally against the cached JWKS in about a millisecond, while
 * `getUser()` spends a round trip to the Supabase region — measured at ~220ms
 * from here, on every request, twice per page once middleware is counted. If
 * the project ever moves back to symmetric HS256, `getClaims()` falls back to
 * that same network call on its own: slower, still correct.
 *
 * The claim we trust is `sub`, and only that. Role and active status are read
 * from our own `users` table, never from the token, so revoking someone takes
 * effect on their next request instead of when their JWT happens to expire.
 */

export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || !userId) return null;

  const record = await prisma.user.findUnique({ where: { id: userId } });

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
