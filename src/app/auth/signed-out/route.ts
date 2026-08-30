import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Tear down a session that verifies but cannot be used, then go to the login
 * page with a reason.
 *
 * This exists because of an asymmetry that is easy to miss. Middleware trusts
 * the token: signature valid, subject present, wave it through. The render
 * trusts our `users` table. When those two disagree — the account was removed,
 * or deactivated, while a browser still holds a live token — the browser is in
 * a state it cannot leave. /dashboard fails. /login bounces it back to
 * /dashboard, because middleware still sees a valid token. Refreshing changes
 * nothing. On 2026-08-30 that took the whole deployment down for one person.
 *
 * A Route Handler is the only place that can fix it: pages and layouts cannot
 * write cookies, so the redirect has to pass through here.
 *
 * Cookies are cleared unconditionally, before and regardless of whether the
 * network call to Supabase succeeds. Revoking the refresh token upstream is
 * good hygiene; clearing the cookie is what actually unblocks the person, and
 * it must not depend on a request that can time out.
 */

const REASONS: Record<string, string> = {
  account_missing: 'account_missing',
  account_deactivated: 'account_deactivated',
  signed_out: 'signed_out',
};

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('reason') ?? 'signed_out';
  const reason = REASONS[requested] ?? 'signed_out';

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?reason=${reason}`;

  const response = NextResponse.redirect(loginUrl);

  // Every Supabase auth cookie, including the numbered chunks a large ES256
  // token is split across. Missing a chunk leaves a token that still parses.
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-')) {
      response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  try {
    await supabase.auth.signOut();
  } catch (error) {
    // Already logged out locally by the loop above; the person is unblocked
    // either way. Worth recording, because a refresh token that could not be
    // revoked upstream is still live until it expires.
    console.warn(
      '[auth] signOut call failed while clearing a stale session:',
      error instanceof Error ? error.message : error,
    );
  }

  return response;
}
