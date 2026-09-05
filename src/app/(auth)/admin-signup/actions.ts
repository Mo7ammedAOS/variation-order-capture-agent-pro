'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/auth/supabase';
import { checkRateLimit, LOGIN_RATE_LIMIT } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';
import { createFirstAdministrator } from '../setup';

/**
 * Creating the first account, from a browser instead of a terminal.
 *
 * This replaces `npm run db:bootstrap` for anybody who should not have to have
 * a checkout, node, and the production database URL in order to stand a
 * company up. The script stays, because it is still the right tool when a
 * deployment is being scripted; this is the same work through the front door.
 *
 * The password is typed here and used immediately, so there is no invitation
 * email in the way — which is what made the first attempt fail. It is sent
 * once, over TLS, to be hashed by Supabase, and is never logged, never
 * audited, and never returned.
 */

const MIN_PASSWORD = 10;

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your name'),
    companyName: z.string().trim().min(2, 'Enter the company name'),
    email: z.string().trim().email('Enter a valid email address'),
    password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: 'The two passwords do not match',
    path: ['confirm'],
  });

export interface SetupState {
  error?: string;
}

export async function createCompany(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const parsed = schema.safeParse({
    fullName: formData.get('fullName'),
    companyName: formData.get('companyName'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again' };
  }

  const { fullName, companyName, email, password } = parsed.data;

  // Rate limited even though the gate below is what actually protects this.
  // An open form on a public URL is a place to hammer, and each attempt costs
  // a Supabase identity listing.
  try {
    checkRateLimit(`setup:${email.toLowerCase()}`, LOGIN_RATE_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    throw error;
  }

  const outcome = await createFirstAdministrator({ email, fullName, companyName, password });
  if (!outcome.ok) return { error: outcome.message };

  // Sign them straight in. They typed the password a moment ago; asking for it
  // again would read as the set-up not having worked.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // The account exists either way, so a failure here is an inconvenience
  // rather than a loss. Send them to the door with an explanation.
  if (error) redirect('/admin-signin?reason=setup_done');

  redirect('/dashboard');
}
