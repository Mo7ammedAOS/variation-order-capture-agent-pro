import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The front door fails two different ways on purpose, and the difference is
 * easy to lose in a refactor: a browser gets the login page, a `fetch` gets a
 * 401 it can act on. Redirecting an API call hands the caller login HTML with
 * status 200 — `res.ok` true, `res.json()` throwing on `<!DOCTYPE` — so the
 * 401 that API_SPEC.md promises would never arrive.
 */

let currentUser: { id: string } | null = null;

// `getClaims()` verifies the JWT locally rather than spending a round trip on
// `getUser()`. The mock mirrors its shape — claims, with the user id in `sub`.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: currentUser ? { claims: { sub: currentUser.id } } : null,
        error: null,
      }),
    },
  }),
}));

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

function request(pathname: string) {
  return new NextRequest(new URL(pathname, 'https://vo.example.com'));
}

describe('middleware', () => {
  beforeEach(() => {
    currentUser = null;
  });

  it('answers a signed-out API call with 401 JSON, not a redirect', async () => {
    const response = await middleware(request('/api/projects'));

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required' },
    });
  });

  it('sends a signed-out page request to sign-in, carrying the destination', async () => {
    const response = await middleware(request('/variations/abc'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/signin');
    expect(location.searchParams.get('next')).toBe('/variations/abc');
  });

  it('does not mistake a page path that merely starts with "api" for an API route', async () => {
    const response = await middleware(request('/apiary'));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/signin');
  });

  it.each(['/signin', '/admin-signin', '/admin-signup'])(
    'leaves %s reachable while signed out',
    async (path) => {
      const response = await middleware(request(path));

      expect(response.status).toBe(200);
    },
  );

  it.each(['/signin', '/admin-signin', '/login'])(
    'bounces a signed-in user off %s',
    async (path) => {
      currentUser = { id: 'user-1' };

      const response = await middleware(request(path));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/dashboard');
    },
  );

  /**
   * The regression this exists for took the deployment down on 2026-08-30.
   *
   * Middleware trusts the token; the render trusts the `users` table. When a
   * live token belongs to an account the table no longer accepts, the render
   * sends the browser to /auth/signed-out, which clears the cookies and lands
   * on /signin. If the rule above still fired there — signed in, so go to
   * /dashboard — a browser whose cookies had not fully cleared would cycle
   * between the two forever, with no page it could reach and no way out by
   * refreshing. The reason parameter is what breaks that cycle.
   */
  it('leaves the sign-in page alone when it carries a sign-out reason', async () => {
    currentUser = { id: 'user-1' };

    const response = await middleware(request('/signin?reason=account_missing'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets the sign-out route run while still holding a valid token', async () => {
    currentUser = { id: 'user-1' };

    const response = await middleware(request('/auth/signed-out?reason=account_missing'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets a signed-in API call through to the route handler', async () => {
    currentUser = { id: 'user-1' };

    const response = await middleware(request('/api/projects'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
