import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getMyTasks } from '@/services/task.service';
import { formatDate } from '@/lib/dates';
import { humanise } from '@/services/dashboard.service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RiskChip } from '@/components/domain/risk-chip';
import { Money } from '@/components/domain/money';
import { EmptyState } from '@/components/domain/empty-state';

export const metadata: Metadata = { title: 'My Tasks' };
export const dynamic = 'force-dynamic';

type TaskRow = Awaited<ReturnType<typeof getMyTasks>>['all'][number];

export default async function MyTasksPage() {
  const user = await requireUser();
  const { overdue, dueToday, upcoming } = await getMyTasks(user);

  const nothing = overdue.length === 0 && dueToday.length === 0 && upcoming.length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Late first, then due today, then everything else.
        </p>
      </header>

      {nothing ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing assigned to you"
          description="Tasks appear here when a change reaches a stage you own."
        />
      ) : (
        <div className="flex flex-col gap-5">
          <TaskGroup title="Overdue" tasks={overdue} tone="red" />
          <TaskGroup title="Due today" tasks={dueToday} tone="amber" />
          <TaskGroup title="Upcoming" tasks={upcoming} tone="neutral" />
        </div>
      )}
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  tone,
}: {
  title: string;
  tasks: TaskRow[];
  tone: 'red' | 'amber' | 'neutral';
}) {
  if (tasks.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          <Badge
            variant={tone === 'red' ? 'riskRed' : tone === 'amber' ? 'riskAmber' : 'secondary'}
          >
            {tasks.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const body = (
              <Card className="p-3 transition-colors hover:bg-accent/50">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {task.project.projectCode} · {humanise(task.taskType)}
                      {task.dueDate ? ` · due ${formatDate(task.dueDate)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {task.potentialChange?.estimatedValue ? (
                      <Money value={task.potentialChange.estimatedValue.toString()} abbreviate />
                    ) : null}
                    {task.potentialChange ? (
                      <RiskChip level={task.potentialChange.riskLevel} />
                    ) : null}
                  </div>
                </div>
              </Card>
            );

            return (
              <li key={task.id}>
                {task.potentialChange ? (
                  <Link href={`/variations/${task.potentialChange.id}`} className="block">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
