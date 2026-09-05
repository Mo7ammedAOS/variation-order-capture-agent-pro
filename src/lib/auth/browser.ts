'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * The third Supabase client, and the only one that runs in a browser.
 *
 * `supabase.ts` holds the other two and explains why they differ. This one
 * exists for exactly one job: the set-password screen, which has to read a
 * recovery token out of the URL and exchange it for a session before any
 * server code can help. A set-password link puts its token in the URL
 * FRAGMENT — the part after `#` — and a fragment is never sent to the server.
 * No server component, route handler or server action can see it. So this
 * single screen has to be a client component with a client Supabase client,
 * or the link cannot work at all.
 *
 * It carries the anon key, which is public by design and safe in a browser.
 * The service role key is never imported here and never will be.
 *
 * `createBrowserClient` from `@supabase/ssr` stores the session in COOKIES
 * rather than localStorage, which is what makes the session it creates visible
 * to middleware and to the server. That is deliberate: the alternative leaves
 * the browser believing it is signed in while every server render disagrees.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
}
