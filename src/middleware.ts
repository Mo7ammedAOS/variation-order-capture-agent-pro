import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Session refresh and the front door.
 *
 * Middleware is a COARSE gate: it keeps signed-out people off application
 * pages and refreshes the Supabase session cookie. It is not, and must never
 * become, the thing that decides who may see which project — that lives in
 * `project-access.service.ts`, server-side, where it can be tested. Anything
 * enforced only here is enforced only until someone calls the API directly.
 */

// Everybody who needs one of these is, by definition, not signed in yet.
// `/admin-signup` is public and gates itself instead: it is open only while
// the company has no users at all. See `(auth)/setup.ts`.
const PUBLIC_PATHS = [
  '/signin',
  '/admin-signin',
  '/admin-signup',
  '/login',
  '/auth',
  '/set-password',
];

// The sign-in screens proper. Landing on one while already signed in means
// going to the dashboard instead; `/admin-signup` is excluded because it
// redirects itself, and `/set-password` because a signed-in person changing
// their password is a legitimate thing to be doing.
const SIGN_IN_PATHS = new Set(['/signin', '/admin-signin', '/login']);

/**
 * Pages and API routes fail differently on purpose.
 *
 * A signed-out browser wants the login screen. A signed-out `fetch` wants a
 * 401 it can act on: redirecting it instead hands the caller login HTML with
 * status 200, `res.ok` is true, and `res.json()` dies on `<!DOCTYPE` — a parse
 * error where "your session expired" belonged. The body matches the shape
 * `src/lib/api.ts` returns, so a caller parses one contract either way.
 */
function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Local signature check against the cached JWKS, not a round trip to the
  // Supabase region. This runs on EVERY request including prefetches, so a
  // ~220ms network call here is the single most expensive thing in a
  // navigation. `getClaims()` still verifies the token properly; it just does
  // it in process, and falls back to the network by itself if the project ever
  // returns to symmetric signing keys.
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();

  // A rejected token and an unreachable JWKS endpoint both arrive here as
  // "not signed in", and the difference matters enormously: one is a signed-out
  // visitor, the other is every user in the deployment being bounced to the
  // login page by an infrastructure fault. Silence made that indistinguishable
  // once already, so it is logged.
  if (claimsError) {
    console.warn('[auth] getClaims failed:', claimsError.message);
  }

  const user = claims?.claims?.sub ? { id: claims.claims.sub } : null;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublic) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
        { status: 401 },
      );
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/signin';
    // Carry the intended destination so a deep link survives signing in.
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // `reason` is the loop breaker, and it is load-bearing rather than cosmetic.
  // A browser holding a token for an account the `users` table no longer
  // accepts is sent here by /auth/signed-out. If the cookie clearing did not
  // fully take, this rule would send it straight back to /dashboard, which
  // fails, which sends it here again — an unbreakable cycle that a person
  // cannot escape by refreshing or by navigating. Carrying the reason means
  // the login page always wins that argument.
  if (user && SIGN_IN_PATHS.has(pathname) && !request.nextUrl.searchParams.has('reason')) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, images, and the integration routes —
    // those authenticate with an HMAC, not a session cookie.
    '/((?!_next/static|_next/image|favicon.ico|api/integrations|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
