import type { Metadata } from 'next';
import Link from 'next/link';
import { FileWarning } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { listPotentialChanges } from '@/services/potential-change.service';
import { listProjects } from '@/services/project.service';
import { formatDate, daysSince } from '@/lib/dates';
import { humanise } from '@/services/dashboard.service';
import { Money } from '@/components/domain/money';
import { RiskChip, StatusChip } from '@/components/domain/risk-chip';
import { NoticeCountdown } from '@/components/domain/notice-countdown';
import { EmptyState } from '@/components/domain/empty-state';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RegisterFilters } from './filters';

export const metadata: Metadata = { title: 'Potential Changes' };
export const dynamic = 'force-dynamic';

export default async function VariationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [changes, projects] = await Promise.all([
    listPotentialChanges(user, {
      projectId: params.projectId,
      status: params.status,
      riskLevel: params.risk as 'green' | 'amber' | 'red' | undefined,
      trade: params.trade,
      search: params.q,
      noticeDueWithinDays: params.dueWithin ? Number(params.dueWithin) : undefined,
    }),
    listProjects(user),
  ]);

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Potential Changes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {changes.length} {changes.length === 1 ? 'change' : 'changes'} in your projects
          </p>
        </div>
      </header>

      <RegisterFilters
        projects={projects.map((p) => ({ id: p.id, label: `${p.projectCode} — ${p.projectName}` }))}
      />

      {changes.length === 0 ? (
        <EmptyState
          icon={FileWarning}
          title="No potential changes match"
          description="Adjust the filters, or use Report Change to capture one now."
        />
      ) : (
        <>
          {/* Desktop: the full register. */}
          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PC Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Authority</TableHead>
                  <TableHead>Event date</TableHead>
                  <TableHead>Notice</TableHead>
                  <TableHead>Notice due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Next action</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-end">Estimated</TableHead>
                  <TableHead className="text-end">Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((change) => (
                  <TableRow key={change.id}>
                    <TableCell>
                      <Link
                        href={`/variations/${change.id}`}
                        className="tabular font-medium text-primary hover:underline"
                      >
                        {change.pcNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {change.project.projectCode}
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{change.title}</TableCell>
                    <TableCell className="text-muted-foreground">{humanise(change.sourceType)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {change.requestedByContact?.fullName ?? change.sourceSenderName ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={change.sourceSenderAuthorityStatus} />
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap">{formatDate(change.eventDate)}</TableCell>
                    <TableCell>
                      <StatusChip status={change.noticeStatus} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <NoticeCountdown noticeDueDate={change.noticeDueDate} compact />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={change.currentStatus} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {change.currentOwner?.fullName ?? (
                        <span className="text-risk-red">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {change.nextAction ?? '—'}
                    </TableCell>
                    <TableCell>
                      <RiskChip level={change.riskLevel} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money value={change.estimatedValue?.toString() ?? null} />
                    </TableCell>
                    <TableCell className="tabular text-end text-muted-foreground">
                      {daysSince(change.createdAt) ?? 0}d
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Phone: cards. A fifteen-column table is unusable on a handset. */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {changes.map((change) => (
              <li key={change.id}>
                <Link href={`/variations/${change.id}`} className="block">
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="tabular text-sm font-semibold text-primary">{change.pcNumber}</p>
                        <p className="mt-0.5 line-clamp-2 font-medium">{change.title}</p>
                      </div>
                      <RiskChip level={change.riskLevel} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <StatusChip status={change.currentStatus} />
                      <NoticeCountdown noticeDueDate={change.noticeDueDate} compact />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Project</dt>
                        <dd>{change.project.projectCode}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Owner</dt>
                        <dd className="truncate">{change.currentOwner?.fullName ?? 'Unassigned'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Event date</dt>
                        <dd className="tabular">{formatDate(change.eventDate)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Estimated</dt>
                        <dd>
                          <Money value={change.estimatedValue?.toString() ?? null} />
                        </dd>
                      </div>
                    </dl>
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
