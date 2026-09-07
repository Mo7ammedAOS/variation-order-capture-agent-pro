import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { isSetupAvailable } from '../setup';
import { AuthShell } from '../sign-in-screen';
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
    <AuthShell
      companyName="Set up your company"
      subtitle="This creates the owner account and switches set-up off. Everybody else is added from Settings → Users afterwards."
    >
      <SignupForm />

      <p className="mt-6 flex flex-wrap items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Already set up?{' '}
        <Link href="/admin-signin" className="font-semibold underline underline-offset-4">
          Sign in instead
        </Link>
      </p>
    </AuthShell>
  );
}
