'use server';

import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/auth/supabase';
import { checkRateLimit, LOGIN_RATE_LIMIT } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';

/**
 * "Send me another link."
 *
 * Set-password links expire, and they are consumed on first use — including by
 * a mail client that helpfully prefetches every URL in a message before the
 * person has read it. So an expired link is a normal event rather than a
 * fault, and the screen that reports it has to offer the way out. Without this
 * the only remedy is an administrator, and the very first account in a
 * deployment has no administrator above it.
 */

const schema = z.object({ email: z.string().email('Enter a valid email address') });

export interface ResendState {
  error?: string;
  sent?: boolean;
}

// One message whether or not the address is real. Saying "no such account"
// turns this form into a way to test which addresses exist in the company.
const SAME_ANSWER = true;

export async function requestNewLink(
  _prev: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const parsed = schema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid email address' };
  }

  const email = parsed.data.email.toLowerCase();

  try {
    checkRateLimit(`set-password:${email}`, LOGIN_RATE_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    throw error;
  }

  const env = getEnv();
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.APP_URL}/set-password`,
  });

  // A transport failure is ours and worth saying. An unknown address is not an
  // error at all, and Supabase does not report it as one.
  if (error) {
    console.warn('[auth] set-password link could not be sent:', error.message);
    return { error: 'The link could not be sent just now. Try again in a moment.' };
  }

  return { sent: SAME_ANSWER };
}
