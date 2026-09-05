import type { Metadata } from 'next';
import { HardHat, KeyRound } from 'lucide-react';
import { prisma } from '@/lib/prisma';
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
    <main
      className="flex min-h-dvh items-center justify-center px-4 py-10"
      style={{ background: 'var(--mosaic-ground)' }}
    >
      <section className="panel flex w-full max-w-md flex-col justify-center bg-card p-7 sm:p-9">
        <div className="mb-7 flex flex-col gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <HardHat aria-hidden className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-[-0.02em]">{companyName}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <KeyRound aria-hidden className="size-3.5" />
              Choose the password for your account
            </p>
          </div>
        </div>

        <SetPasswordForm />
      </section>
    </main>
  );
}
