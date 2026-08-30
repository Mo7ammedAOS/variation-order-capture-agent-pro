import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
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

/**
 * Why this is a status rather than a user-or-null.
 *
 * "Signed out" and "holding a valid token for an account that no longer works"
 * are the same thing to an access check and completely different things to a
 * browser. The first needs the login page. The second needs the session
 * DESTROYED first — middleware trusts the token, so sending that browser to
 * /login just bounces it back to /dashboard, forever, and the person cannot
 * reach the application at all.
 *
 * That is not hypothetical: it is what took the deployment down on 2026-08-30,
 * after five seed identities were removed from `users` while their Supabase
 * identities stayed. A browser holding one of those sessions got the generic
 * server-error page on every route, and a refresh could never clear it.
 */
export type SessionState =
  | { status: 'authenticated'; user: AuthenticatedUser }
  /** No token, or one that failed verification. An ordinary signed-out visitor. */
  | { status: 'anonymous' }
  /** Token verifies, but no `users` row answers to its subject. */
  | { status: 'orphaned' }
  /** Token verifies, the person exists, and their access has been withdrawn. */
  | { status: 'deactivated' };

export const resolveSession = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error) console.warn('[auth] getClaims failed in session:', error.message);
  if (error || !userId) return { status: 'anonymous' };

  const record = await prisma.user.findUnique({ where: { id: userId } });

  // A leaver keeps their Supabase identity so the audit trail still resolves to
  // a real person; `active: false` is what actually revokes access.
  if (!record) return { status: 'orphaned' };
  if (!record.active) return { status: 'deactivated' };

  return { status: 'authenticated', user: toAuthenticatedUser(record) };
});

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await resolveSession();
  return session.status === 'authenticated' ? session.user : null;
}

/**
 * For API routes, where the caller is code and wants a status line it can act
 * on. Never use this in a page or a Server Action — a thrown 401 there renders
 * Next's bare "a server-side exception has occurred" page with a digest and no
 * way forward.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

/**
 * For pages and Server Actions, where the caller is a person in a browser.
 *
 * Every outcome is a navigation, never an exception. `destination` carries the
 * deep link through the login round trip so a shared link still lands where it
 * pointed.
 */
export async function requirePageUser(destination?: string): Promise<AuthenticatedUser> {
  const session = await resolveSession();

  switch (session.status) {
    case 'authenticated':
      return session.user;

    case 'anonymous': {
      const next = destination && destination.startsWith('/') ? destination : undefined;
      redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
      break;
    }

    // Both of these hold a token middleware will happily wave through, so the
    // session has to be torn down before the browser can be sent to /login.
    case 'orphaned':
      redirect('/auth/signed-out?reason=account_missing');
      break;

    case 'deactivated':
      redirect('/auth/signed-out?reason=account_deactivated');
      break;
  }

  // `redirect` throws, so this is unreachable. It exists so the function is
  // typed as returning a user rather than `user | undefined`.
  throw new UnauthenticatedError();
}
