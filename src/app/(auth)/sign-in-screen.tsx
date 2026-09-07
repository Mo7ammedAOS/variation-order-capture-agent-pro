import { Camera, Clock, HardHat, Info, Lock, ShieldCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
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
    /*
      No background on this element. The photographic ground is painted by
      `body::before` for the whole application, sign-in included — which is the
      point: the first thing anyone sees of this product is the same room the
      dashboard sits in, so signing in feels like opening a door rather than
      crossing between two different pieces of software.

      The theme toggle IS here, above the card.

      It was left off at first on the reasoning that sign-in should just follow
      the device — but that reasoning was wrong in practice. This is the screen
      people see in the worst lighting they ever use the product in: a phone in
      direct sun on a site, or a laptop in a dark portacabin at six in the
      morning. Making somebody sign in first, at whatever brightness their OS
      decided, before they may turn the lights down is a small daily cruelty.

      It stores a preference in localStorage against a device rather than an
      account, which is exactly right: the device is the thing with a screen.
    */
    <main data-auth-screen className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      {/*
        One column, the form first.

        This was two panels side by side, which meant the promises panel was
        the first thing the eye landed on and the password box was off to one
        side — wrong priority for a screen whose entire job is to let somebody
        in. Stacked, the form is the page and the promises are the note
        underneath it, which is also why they can now be shown on a phone
        instead of being hidden below `lg` as they were.
      */}
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>

        <section className="panel flex flex-col justify-center p-7 sm:p-9">
          <div className="mb-7 flex flex-col gap-3">
            <span className="brand-fill flex size-11 items-center justify-center rounded-xl shadow-[var(--brand-glow)]">
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
            <div className="mt-7 border-t border-border pt-6">
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

        {/*
          What the product promises, under the door rather than beside it.
          Three lines somebody reads once, on their first morning, and never
          again — which is exactly why it does not belong above the form.
        */}
        <section className="panel panel-work p-6 sm:p-7">
          <span className="panel-chip h-9 text-sm font-semibold">
            <HardHat aria-hidden className="size-4 text-[var(--brand)]" />
            Variation control
          </span>
          <h2 className="mt-5 text-[1.4rem] font-extrabold leading-[1.15] tracking-[-0.028em] sm:text-[1.6rem]">
            Capture the change.
            <br />
            <span className="brand-text">Keep the entitlement.</span>
          </h2>

          <ul className="mt-6 flex flex-col gap-4">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-[var(--glass-soft)] text-[var(--brand)]">
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-[-0.01em]">{title}</p>
                  <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
