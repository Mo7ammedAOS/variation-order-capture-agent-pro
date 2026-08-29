import type { Metadata } from 'next';
import { HardHat } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

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
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <HardHat aria-hidden className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{companyName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Variation capture, notice control and approvals
            </p>
          </div>
        </div>

        <LoginForm next={next} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accounts are created by your administrator. There is no self sign-up.
        </p>
      </div>
    </main>
  );
}
