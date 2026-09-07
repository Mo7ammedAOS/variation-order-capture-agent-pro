import { HardHat, Info, Lock, UserPlus } from 'lucide-react';
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
 *
 * ── What was removed ──────────────────────────────────────────────────────
 * The three-promise marketing panel. Nobody signing in for the ninth morning
 * running needs to be told that evidence is filed against the change; it was a
 * second panel, a second scroll on a phone, and a slower path to the only
 * control on the page that does anything. The door is now just a door.
 */

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
    <AuthShell
      companyName={companyName}
      subtitle={
        variant === 'admin'
          ? 'Administrator sign in'
          : 'Variation capture, notice control and approvals'
      }
      notice={notice}
    >
      <LoginForm next={next} />

      {variant === 'admin' && setupOpen ? (
        <div className="mt-7 border-t border-border pt-6">
          <p className="text-sm font-semibold">Nobody has set this company up yet.</p>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            Create the first administrator account. It can add everybody else, and this
            button disappears the moment it exists.
          </p>
          <Button asChild variant="outline" size="lg" className="mt-4 w-full">
            <Link href="/admin-signup">
              <UserPlus aria-hidden className="size-4" />
              Set up the company
            </Link>
          </Button>
        </div>
      ) : null}

      <p className="mt-6 flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
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
    </AuthShell>
  );
}

/**
 * The frame every unauthenticated screen uses.
 *
 * One pane, centred, on the same photograph of a finished fit-out that the
 * application itself sits on — so signing in reads as opening a door into a
 * room rather than as crossing between two pieces of software.
 *
 * The theme toggle floats above the card. This is the screen people meet in
 * the worst lighting they ever use the product in — a phone in direct sun on a
 * site, a laptop in a dark portacabin at six in the morning — and making
 * somebody sign in first, at whatever brightness their operating system chose,
 * before they may turn the lights down is a small daily cruelty. It stores
 * against the device rather than the account, which is right: the device is
 * the thing with a screen.
 */
export function AuthShell({
  companyName,
  subtitle,
  notice,
  children,
}: {
  companyName: string;
  subtitle: string;
  notice?: string;
  children: React.ReactNode;
}) {
  return (
    <main data-auth-screen className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-[26rem] flex-col gap-3">
        <div className="flex justify-end">
          <ThemeToggle variant="labelled" />
        </div>

        <section className="panel rounded-[1.75rem] p-7 sm:p-9">
          <span className="brand-fill flex size-12 items-center justify-center rounded-2xl shadow-[var(--brand-glow)]">
            <HardHat aria-hidden className="size-6" />
          </span>

          <h1 className="mt-5 text-[1.5rem] font-extrabold leading-tight tracking-[-0.03em]">
            {companyName}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>

          {notice ? (
            <p
              role="status"
              className="mt-5 flex items-start gap-2 rounded-xl bg-risk-amber-bg px-3.5 py-2.5 text-sm leading-snug text-risk-amber"
            >
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {notice}
            </p>
          ) : null}

          <div className="mt-7">{children}</div>
        </section>
      </div>
    </main>
  );
}
