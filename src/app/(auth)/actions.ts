'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/auth/supabase';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, LOGIN_RATE_LIMIT, resetRateLimit } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  next: z.string().optional(),
});

export interface LoginState {
  error?: string;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again' };
  }

  const { email, password, next } = parsed.data;

  try {
    checkRateLimit(`login:${email.toLowerCase()}`, LOGIN_RATE_LIMIT);
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    throw error;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  // One message for a wrong password and for an unknown address. Distinguishing
  // them tells an attacker which addresses are real.
  if (error || !data.user) return { error: 'Those details do not match an account' };

  const profile = await prisma.user.findUnique({ where: { id: data.user.id } });

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return { error: 'This account is not active. Contact your administrator.' };
  }

  resetRateLimit(`login:${email.toLowerCase()}`);
  await prisma.user.update({ where: { id: profile.id }, data: { lastLoginAt: new Date() } });

  redirect(next && next.startsWith('/') ? next : '/dashboard');
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/signin');
}
