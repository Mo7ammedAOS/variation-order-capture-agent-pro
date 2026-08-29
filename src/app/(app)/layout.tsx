import Link from 'next/link';
import { HardHat, LogOut } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { SYSTEM_ROLE_LABELS } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { signOut } from '@/app/(auth)/login/actions';
import { MobileNav, ReportChangeFab, SidebarNav } from './nav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await prisma.companySettings
    .findFirst({ select: { displayCompanyName: true } })
    .catch(() => null);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="hidden w-64 shrink-0 border-e border-sidebar-border bg-sidebar md:flex md:flex-col print:hidden">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HardHat aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              {settings?.displayCompanyName ?? 'VO Capture'}
            </p>
            <p className="truncate text-xs text-muted-foreground">Variation control</p>
          </div>
        </div>

        <div className="flex-1 px-3">
          <SidebarNav />
        </div>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium">{user.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {SYSTEM_ROLE_LABELS[user.systemRole]}
            </p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
              <LogOut aria-hidden className="size-4" />
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <header className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 md:hidden print:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HardHat aria-hidden className="size-4" />
          </span>
          <span className="truncate text-sm font-semibold">
            {settings?.displayCompanyName ?? 'VO Capture'}
          </span>
        </Link>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
            <LogOut aria-hidden className="size-4" />
          </Button>
        </form>
      </header>

      {/* Bottom padding clears the mobile nav bar and the capture button. */}
      {/* Printing drops the padding and the bottom clearance: the nav is hidden on
          paper, so the space it reserved is a blank strip at the foot of a page. */}
      <main className="flex-1 px-4 py-6 pb-36 md:px-8 md:py-8 md:pb-12 print:p-0">{children}</main>

      <MobileNav />
      <ReportChangeFab />
    </div>
  );
}
