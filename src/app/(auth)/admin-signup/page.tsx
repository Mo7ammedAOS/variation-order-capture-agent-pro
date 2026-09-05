import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { HardHat, ShieldCheck } from 'lucide-react';
import { isSetupAvailable } from '../setup';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Set up the company' };
export const dynamic = 'force-dynamic';

/**
 * The first account, and the only one this system ever creates for somebody
 * who was not invited.
 *
 * Reachable by anyone who types the address — and closed on any deployment
 * that has been set up, which is what makes that acceptable. The redirect
 * below is the courteous half; `createFirstAdministrator` refuses again inside
 * the transaction, which is the half that would stop somebody who skipped this
 * page and posted straight to the action.
 */
export default async function AdminSignupPage() {
  if (!(await isSetupAvailable())) redirect('/admin-signin');

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
            <h1 className="text-xl font-extrabold tracking-[-0.02em]">Set up your company</h1>
            <p className="mt-1 text-sm leading-snug text-muted-foreground">
              This creates the owner account and switches set-up off. Everybody else is added
              from Settings → Users afterwards.
            </p>
          </div>
        </div>

        <SignupForm />

        <p className="mt-6 flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Already set up?{' '}
          <Link href="/admin-signin" className="underline underline-offset-4">
            Sign in instead
          </Link>
        </p>
      </section>
    </main>
  );
}
