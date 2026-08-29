import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The front door fails two different ways on purpose, and the difference is
 * easy to lose in a refactor: a browser gets the login page, a `fetch` gets a
 * 401 it can act on. Redirecting an API call hands the caller login HTML with
 * status 200 — `res.ok` true, `res.json()` throwing on `<!DOCTYPE` — so the
 * 401 that API_SPEC.md promises would never arrive.
 */

let currentUser: { id: string } | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: currentUser }, error: null }),
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

  it('sends a signed-out page request to login, carrying the destination', async () => {
    const response = await middleware(request('/variations/abc'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/variations/abc');
  });

  it('does not mistake a page path that merely starts with "api" for an API route', async () => {
    const response = await middleware(request('/apiary'));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
  });

  it('leaves the login page reachable while signed out', async () => {
    const response = await middleware(request('/login'));

    expect(response.status).toBe(200);
  });

  it('bounces a signed-in user off the login page', async () => {
    currentUser = { id: 'user-1' };

    const response = await middleware(request('/login'));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/dashboard');
  });

  it('lets a signed-in API call through to the route handler', async () => {
    currentUser = { id: 'user-1' };

    const response = await middleware(request('/api/projects'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
