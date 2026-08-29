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

const PUBLIC_PATHS = ['/login', '/auth'];

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    redirectUrl.pathname = '/login';
    // Carry the intended destination so a deep link survives signing in.
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === '/login') {
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
