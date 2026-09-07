import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { AuthShell } from '../sign-in-screen';
import { SetPasswordForm } from './set-password-form';

export const metadata: Metadata = { title: 'Set your password' };
export const dynamic = 'force-dynamic';

/**
 * The other half of the front door.
 *
 * `/login` is for people who already have a password. This is for everyone who
 * does not yet — which, in this system, is every person on their first day,
 * because accounts are created by an administrator and never by sign-up.
 *
 * Quieter than the login screen on purpose: no product promises beside it.
 * Somebody here is halfway through a task they did not choose to start, and
 * the only thing that matters is the field in front of them.
 */
export default async function SetPasswordPage() {
  const settings = await prisma.companySettings
    .findFirst({ select: { displayCompanyName: true } })
    .catch(() => null);

  const companyName = settings?.displayCompanyName ?? 'VO Capture & Control';

  return (
    <AuthShell companyName={companyName} subtitle="Choose the password for your account">
      <SetPasswordForm />
    </AuthShell>
  );
}
