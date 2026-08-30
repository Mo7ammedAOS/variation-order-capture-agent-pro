import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/auth/session';
import { listUsers } from '@/services/user.service';
import { isAppError } from '@/lib/errors';
import { SYSTEM_ROLE_LABELS, PROJECT_ROLE_LABELS } from '@/lib/rbac';
import { formatDate } from '@/lib/dates';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InviteForm } from './invite-form';
import { toggleCompanyAdminAction, toggleUserActiveAction } from './actions';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const user = await requirePageUser();

  let users;
  try {
    users = await listUsers(user);
  } catch (error) {
    if (isAppError(error) && error.status === 403) {
      return (
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="font-medium">User administration is restricted</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Only a company owner or administrator can manage accounts.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? 'account' : 'accounts'}. There is no public
          sign-up — every account exists because someone here created it. Administration is
          its own column because whoever runs the app is chosen by the company, and their job
          is usually something else.
        </p>
      </header>

      {user.canAdministerCompany ? <InviteForm /> : null}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Company role</TableHead>
              <TableHead>Administers</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead>Last signed in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-end">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <p className="font-medium">{row.fullName}</p>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </TableCell>
                <TableCell>{SYSTEM_ROLE_LABELS[row.systemRole]}</TableCell>
                <TableCell>
                  {user.canAdministerCompany ? (
                    <form action={toggleCompanyAdminAction}>
                      <input type="hidden" name="userId" value={row.id} />
                      <input
                        type="hidden"
                        name="canAdminister"
                        value={String(!row.canAdministerCompany)}
                      />
                      <Button
                        type="submit"
                        variant={row.canAdministerCompany ? 'secondary' : 'ghost'}
                        size="sm"
                      >
                        {row.canAdministerCompany ? 'Administrator' : 'Grant'}
                      </Button>
                    </form>
                  ) : row.canAdministerCompany ? (
                    <Badge variant="secondary">Administrator</Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.memberships.length === 0 ? (
                    <span className="text-sm text-muted-foreground">None</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.memberships.slice(0, 3).map((membership) => (
                        <Badge key={`${membership.project.id}-${membership.projectRole}`} variant="outline">
                          {membership.project.projectCode} ·{' '}
                          {PROJECT_ROLE_LABELS[membership.projectRole]}
                        </Badge>
                      ))}
                      {row.memberships.length > 3 ? (
                        <Badge variant="secondary">+{row.memberships.length - 3}</Badge>
                      ) : null}
                    </div>
                  )}
                </TableCell>
                <TableCell className="tabular text-muted-foreground">
                  {row.lastLoginAt ? formatDate(row.lastLoginAt) : 'Never'}
                </TableCell>
                <TableCell>
                  <Badge variant={row.active ? 'riskGreen' : 'riskNeutral'}>
                    {row.active ? 'Active' : 'Deactivated'}
                  </Badge>
                </TableCell>
                <TableCell className="text-end">
                  {user.canAdministerCompany && row.id !== user.id ? (
                    <form action={toggleUserActiveAction}>
                      <input type="hidden" name="userId" value={row.id} />
                      <input type="hidden" name="active" value={String(!row.active)} />
                      <Button type="submit" variant="ghost" size="sm">
                        {row.active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </form>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
