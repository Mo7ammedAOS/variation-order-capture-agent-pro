import type { Metadata } from 'next';
import Link from 'next/link';
import { FolderKanban, Plus } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { hasCapability } from '@/services/permissions.service';
import { listProjects } from '@/services/project.service';
import { PROJECT_ROLE_LABELS } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { humanise } from '@/services/dashboard.service';
import { Money } from '@/components/domain/money';
import { StatusChip } from '@/components/domain/risk-chip';
import { EmptyState } from '@/components/domain/empty-state';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requirePageUser();
  const { q } = await searchParams;
  const [projects, mayCreate] = await Promise.all([
    listProjects(user, { search: q }),
    hasCapability(user.systemRole, [], 'project.create'),
  ]);

  function roleHolder(
    members: { projectRole: string; user: { fullName: string } }[],
    role: string,
  ): string {
    return members.find((m) => m.projectRole === role)?.user.fullName ?? '—';
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'} you can see
          </p>
        </div>
        {mayCreate ? (
          <Button asChild>
            <Link href="/projects/new">
              <Plus aria-hidden className="size-4" />
              New project
            </Link>
          </Button>
        ) : null}
      </header>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects"
          description="You are not assigned to any project yet."
        />
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Consultant</TableHead>
                  <TableHead className="text-end">Contract value</TableHead>
                  <TableHead>{PROJECT_ROLE_LABELS.project_manager}</TableHead>
                  <TableHead>{PROJECT_ROLE_LABELS.quantity_surveyor}</TableHead>
                  <TableHead>{PROJECT_ROLE_LABELS.commercial_manager}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${project.id}`}
                        className="tabular font-medium text-primary hover:underline"
                      >
                        {project.projectCode}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">{project.projectName}</TableCell>
                    <TableCell className="text-muted-foreground">{project.clientName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {project.consultantName ?? '—'}
                    </TableCell>
                    <TableCell className="text-end">
                      <Money
                        value={project.originalContractValue?.toString() ?? null}
                        currency={project.currency}
                        abbreviate
                      />
                    </TableCell>
                    <TableCell>{roleHolder(project.members, 'project_manager')}</TableCell>
                    <TableCell>{roleHolder(project.members, 'quantity_surveyor')}</TableCell>
                    <TableCell>{roleHolder(project.members, 'commercial_manager')}</TableCell>
                    <TableCell>
                      <StatusChip status={project.projectStatus} />
                    </TableCell>
                    <TableCell className="tabular text-end">
                      {project._count.potentialChanges}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <ul className="flex flex-col gap-3 md:hidden">
            {projects.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="tabular text-sm font-semibold text-primary">
                          {project.projectCode}
                        </p>
                        <p className="mt-0.5 font-medium">{project.projectName}</p>
                        <p className="text-sm text-muted-foreground">{project.clientName}</p>
                      </div>
                      <StatusChip status={project.projectStatus} />
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {project._count.potentialChanges} potential{' '}
                      {project._count.potentialChanges === 1 ? 'change' : 'changes'} ·{' '}
                      {humanise(project.projectStatus)}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
