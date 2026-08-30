import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/auth/session';
import { listProjects } from '@/services/project.service';
import { toDateInputValue, todayUtc } from '@/lib/dates';
import { EmptyState } from '@/components/domain/empty-state';
import { FolderKanban } from 'lucide-react';
import { ReportChangeForm } from './report-form';

export const metadata: Metadata = { title: 'Report a change' };
export const dynamic = 'force-dynamic';

export default async function ReportChangePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const user = await requirePageUser();
  const { projectId } = await searchParams;

  // Only projects this person is actually on. The picker cannot offer a
  // project they could not then file against.
  const projects = await listProjects(user);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Report a change</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture it now. The notice clock starts from the date it happened, not the date
          it was written up.
        </p>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="You are not assigned to a project"
          description="Ask your project manager to add you to a project before filing a change."
        />
      ) : (
        <ReportChangeForm
          projects={projects.map((p) => ({
            id: p.id,
            label: `${p.projectCode} — ${p.projectName}`,
          }))}
          defaultProjectId={projectId ?? (projects.length === 1 ? projects[0]?.id : undefined)}
          today={toDateInputValue(todayUtc())}
        />
      )}
    </div>
  );
}
