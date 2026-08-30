import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listPermissions } from '@/services/permissions.service';
import { isAppError } from '@/lib/errors';
import { PROJECT_ROLE_LABELS, SYSTEM_ROLE_LABELS, type Capability } from '@/lib/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PermissionMatrixTable, ResetDefaultsButton, type PermissionCell } from './matrix';

export const metadata: Metadata = { title: 'Permissions' };
export const dynamic = 'force-dynamic';

/** People outside the company. Never grantable, whatever the request says. */
const LOCKED_PROJECT_ROLES = new Set(['client_viewer', 'consultant_viewer']);

export default async function PermissionsPage() {
  const user = await requireUser();

  let rows;
  try {
    rows = await listPermissions(user);
  } catch (error) {
    if (isAppError(error) && error.status === 403) {
      return (
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="font-medium">Permissions are restricted</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Only a company administrator can change who may do what.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }
    throw error;
  }

  const granted = new Map<string, Capability[]>();
  for (const row of rows) {
    if (!row.granted) continue;
    const key = `${row.scope}:${row.role}`;
    granted.set(key, [...(granted.get(key) ?? []), row.capability as Capability]);
  }

  const systemRows: PermissionCell[] = Object.entries(SYSTEM_ROLE_LABELS).map(
    ([role, label]) => ({ role, label, granted: granted.get(`system:${role}`) ?? [] }),
  );

  const projectRows: PermissionCell[] = Object.entries(PROJECT_ROLE_LABELS).map(
    ([role, label]) => ({
      role,
      label,
      locked: LOCKED_PROJECT_ROLES.has(role),
      granted: granted.get(`project:${role}`) ?? [],
    }),
  );

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Permissions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Who may do what, on your director&apos;s authority rather than ours. Changes take
            effect within seconds and every one is recorded against your name. A cell that is
            not ticked is a refusal, not a gap.
          </p>
        </div>
        <ResetDefaultsButton />
      </header>

      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Company roles</CardTitle>
          <p className="text-sm text-muted-foreground">
            What someone can do anywhere in the company, without being on a project.{' '}
            <strong className="font-medium">See every project</strong> is the one that grants
            reach into projects nobody has added them to.
          </p>
        </CardHeader>
        <CardContent className="min-w-0">
          <PermissionMatrixTable scope="system" rows={systemRows} />
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Project roles</CardTitle>
          <p className="text-sm text-muted-foreground">
            What someone can do on a project they have been added to, set on the project&apos;s
            Team tab. Where a person holds two roles they get the union of both, never the
            narrower one.
          </p>
        </CardHeader>
        <CardContent className="min-w-0">
          <PermissionMatrixTable scope="project" rows={projectRows} />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Administration itself is not on this page. It is a flag on the person, granted from{' '}
        <Link href="/settings/users" className="font-medium text-primary hover:underline">
          Users
        </Link>
        , because whoever runs the app is chosen by the company and their job is usually
        something else.
      </p>
    </div>
  );
}
