import { Camera, Clock, HardHat, Info, Lock, ShieldCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/prisma';
import { LoginForm } from './login-form';
import { isSetupAvailable } from './setup';

/**
 * One screen, two doors.
 *
 *   /signin         everybody. A password box and nothing else.
 *   /admin-signin   the same box, plus the way to create the first account.
 *
 * They are separate URLs rather than one page with a toggle because the two
 * audiences arrive with different questions. A site engineer arrives holding a
 * password somebody gave them; anything else on the screen is noise. Whoever
 * stands the company up arrives holding nothing at all, and needs to be told
 * plainly that the button they want is here.
 *
 * Splitting them is presentation, not security. `/admin-signin` grants nothing
 * that `/signin` does not — the same form, the same checks, the same server.
 * What actually gates the setup button is the count of users in the company,
 * checked on the server on every render and again inside the transaction that
 * would create the account. See `setup.ts`.
 */

const PROMISES = [
  {
    icon: Clock,
    title: 'The notice clock starts on capture',
    body: 'Counted from the date it happened, not the date someone wrote it up.',
  },
  {
    icon: Camera,
    title: 'Evidence, filed where it belongs',
    body: 'Photographs land against the change, in the project folder, dated.',
  },
  {
    icon: ShieldCheck,
    title: 'Only your projects',
    body: 'Enforced on the server, not merely hidden in the interface.',
  },
];

/**
 * Why a session ended, said in words rather than left as a mystery.
 *
 * Someone arriving here involuntarily has just had a page taken away from
 * them. If the screen simply asks for a password again they will assume they
 * mistyped it, try the same one, and be no wiser. The two account states are
 * worth distinguishing because the remedy differs: one is "use your other
 * account", the other is "your administrator has to act".
 */
const SIGN_OUT_REASONS: Record<string, string> = {
  account_missing:
    'That account is no longer set up in this company, so you have been signed out. Sign in with a current account, or ask your administrator to add you.',
  account_deactivated:
    'Your access has been switched off, so you have been signed out. Your administrator can switch it back on.',
  signed_out: 'You have been signed out.',
  // Not a sign-out at all — the arrival from /set-password. It shares this
  // map because it needs the same thing: a line of explanation above the
  // form, and a `reason` in the URL so middleware does not bounce a
  // still-warm session straight back to the dashboard.
  password_set: 'Your password is set. Sign in with it.',
  setup_done: 'The company is set up and your account is ready. Sign in.',
};

export async function SignInScreen({
  variant,
  next,
  reason,
}: {
  variant: 'staff' | 'admin';
  next?: string;
  reason?: string;
}) {
  const notice = reason ? SIGN_OUT_REASONS[reason] : undefined;

  // Branding comes from company settings so a deployment looks like the client
  // company rather than like our product. Failing to read it must not block
  // sign-in, which is why this is wrapped.
  const settings = await prisma.companySettings
    .findFirst({ select: { displayCompanyName: true } })
    .catch(() => null);

  const companyName = settings?.displayCompanyName ?? 'VO Capture & Control';

  // Only ever asked on the admin door. The staff door has no setup button to
  // decide about, and this is a database round trip on an unauthenticated page.
  const setupOpen = variant === 'admin' ? await isSetupAvailable() : false;

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-4 py-10"
      style={{ background: 'var(--mosaic-ground)' }}
    >
      <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-[1fr_1.1fr]">
        <section className="panel panel-search hidden flex-col justify-between p-8 lg:flex">
          <div>
            <span className="panel-chip h-9 text-sm font-medium text-[#131313]">
              <HardHat aria-hidden className="size-4" />
              Variation control
            </span>
            <h2 className="mt-7 text-[1.75rem] font-extrabold leading-[1.15] tracking-[-0.028em] text-[#0d0d10]">
              Capture the change.
              <br />
              Keep the entitlement.
            </h2>
          </div>

          <ul className="mt-8 flex flex-col gap-5">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white/70 text-[#3d3a63]">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#191826]">{title}</p>
                  <p className="mt-0.5 text-sm leading-snug text-[#4a4763]">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel flex flex-col justify-center bg-card p-7 sm:p-9">
          <div className="mb-7 flex flex-col gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <HardHat aria-hidden className="size-5" />
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-[-0.02em]">{companyName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {variant === 'admin'
                  ? 'Administrator sign in'
                  : 'Variation capture, notice control and approvals'}
              </p>
            </div>
          </div>

          {notice ? (
            <p
              role="status"
              className="mb-5 flex items-start gap-2 rounded-xl bg-risk-amber-bg px-3.5 py-2.5 text-sm leading-snug text-risk-amber"
            >
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {notice}
            </p>
          ) : null}

          <LoginForm next={next} />

          {variant === 'admin' && setupOpen ? (
            <div className="mt-7 border-t border-input pt-6">
              <p className="text-sm font-semibold">Nobody has set this company up yet.</p>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                Create the first administrator account. It can add everybody else, and this
                button disappears the moment it exists.
              </p>
              <Button asChild variant="secondary" size="lg" className="mt-4 w-full">
                <Link href="/admin-signup">
                  <UserPlus aria-hidden className="size-4" />
                  Set up the company
                </Link>
              </Button>
            </div>
          ) : null}

          <p className="mt-6 flex items-start gap-1.5 text-xs text-muted-foreground">
            {variant === 'admin' && !setupOpen ? (
              <>
                <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Set-up is closed — this company already has an administrator. Further accounts
                are created from Settings → Users.
              </>
            ) : variant === 'admin' ? null : (
              <>Accounts are created by your administrator. There is no self sign-up.</>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
