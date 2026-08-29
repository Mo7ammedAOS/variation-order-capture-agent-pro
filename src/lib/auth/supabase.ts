import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

/**
 * Two Supabase clients, and the difference matters.
 *
 *   server client   carries the signed-in person's session. Subject to RLS.
 *   admin client    carries the service role key. BYPASSES RLS entirely.
 *
 * The admin client exists only to create and manage identities for invited
 * people. It must never be used to read project data — that is what the
 * service layer and its access checks are for. The key never reaches the
 * browser: this module is server-only.
 */

export async function createSupabaseServerClient() {
  const env = getEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

let adminClient: ReturnType<typeof createClient> | undefined;

export function createSupabaseAdminClient() {
  const env = getEnv();
  adminClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}
