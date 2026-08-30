import type { Metadata } from 'next';
import { Camera, Clock, HardHat, ShieldCheck } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * The mosaic language, applied where it is first seen.
 *
 * Two panels on the light ground: the sign-in card, and beside it what the
 * product actually promises. The second panel is hidden below `lg`, because a
 * site engineer signing in on a phone in a corridor needs the password field
 * above the fold and nothing else competing for it.
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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Branding comes from company settings so a deployment looks like the client
  // company rather than like our product. Failing to read it must not block
  // sign-in, which is why this is wrapped.
  const settings = await prisma.companySettings
    .findFirst({ select: { displayCompanyName: true } })
    .catch(() => null);

  const companyName = settings?.displayCompanyName ?? 'VO Capture & Control';

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
                Variation capture, notice control and approvals
              </p>
            </div>
          </div>

          <LoginForm next={next} />

          <p className="mt-6 text-xs text-muted-foreground">
            Accounts are created by your administrator. There is no self sign-up.
          </p>
        </section>
      </div>
    </main>
  );
}
