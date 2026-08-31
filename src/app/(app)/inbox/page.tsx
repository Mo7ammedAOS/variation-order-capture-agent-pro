import type { Metadata } from 'next';
import { Inbox } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { listTriageQueue } from '@/services/capture.service';
import { listProjects } from '@/services/project.service';
import { assertCapability } from '@/services/project-access.service';
import { formatDateTime } from '@/lib/dates';
import { EmptyState } from '@/components/domain/empty-state';
import { TriageCard } from './triage-card';

export const metadata: Metadata = { title: 'Capture inbox' };
export const dynamic = 'force-dynamic';

/**
 * Where messages go when the system will not guess.
 *
 * This page is the other half of the capture rule. Refusing to file a change
 * against a project we are not sure about is only the right call if somebody
 * then sees it — otherwise "we never guess" just means "we lose it quietly",
 * which is worse than guessing, because at least a wrong guess is visible.
 */
export default async function InboxPage() {
  const user = await requirePageUser();
  await assertCapability(user, 'potentialChange.create');

  const [items, projects] = await Promise.all([listTriageQueue(), listProjects(user)]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Capture inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Messages that arrived by WhatsApp or email and could not be placed on a project by
          themselves. Each one needs a person to say where it belongs.
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting"
          description="Every captured message has been filed against a project."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <TriageCard
              key={item.eventId}
              item={{
                eventId: item.eventId,
                source: item.source,
                reason: item.reason,
                senderName: item.senderName,
                senderIdentifier: item.senderIdentifier,
                text: item.text,
                receivedAt: formatDateTime(item.receivedAt),
                candidateProjectIds: item.candidateProjectIds,
              }}
              projects={projects.map((p) => ({
                id: p.id,
                projectCode: p.projectCode,
                projectName: p.projectName,
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
