import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/auth/session';
import { hasCapability } from '@/services/permissions.service';
import { Card, CardContent } from '@/components/ui/card';
import { BackButton } from '@/components/ui/page-actions';
import { ProjectForm } from './project-form';

export const metadata: Metadata = { title: 'New project' };
export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const user = await requirePageUser();

  // Asked of the same source the service consults, so this page can never
  // offer a form the server would then refuse.
  const mayCreate = await hasCapability(user.systemRole, [], 'project.create');

  if (!mayCreate) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Creating projects is restricted</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask your administrator to create the project, or to give your
              role permission in Settings, then Permissions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <BackButton href="/projects" label="All projects" />
      <header>
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">New project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A code, a name and a client are enough to start. You add the contract
          details, the team and the notice rules afterwards, on the project
          itself.
        </p>
      </header>
      <ProjectForm />
    </div>
  );
}
