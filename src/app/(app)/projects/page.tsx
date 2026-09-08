import type { Metadata } from 'next';
import Link from 'next/link';
import { FolderKanban, Plus } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { hasCapability } from '@/services/permissions.service';
import { listProjects } from '@/services/project.service';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/domain/empty-state';
import { ProjectCard } from './project-card';

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
          <h1 className="page-title">Projects</h1>
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
        /*
          One grid at every width — three columns on a wide screen, two on a
          tablet, one on a phone. There is no longer a separate mobile list to
          keep in step with a desktop table, which is how the phone view ended
          up showing four of the ten things the table showed.
        */
        <ul className="motion-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id} className="min-w-0">
              <ProjectCard
                project={{
                  id: project.id,
                  projectCode: project.projectCode,
                  projectName: project.projectName,
                  clientName: project.clientName,
                  consultantName: project.consultantName,
                  contractValue: project.originalContractValue?.toString() ?? null,
                  currency: project.currency,
                  projectStatus: project.projectStatus,
                  changeCount: project._count.potentialChanges,
                  projectManager: roleHolder(project.members, 'project_manager'),
                  quantitySurveyor: roleHolder(project.members, 'quantity_surveyor'),
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
