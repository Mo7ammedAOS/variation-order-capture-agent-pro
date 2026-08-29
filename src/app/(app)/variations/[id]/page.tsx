import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft, ClipboardList, Copy, FileText, History, MapPin, Paperclip, User,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getPotentialChange } from '@/services/potential-change.service';
import { findSimilarChanges } from '@/services/search.service';
import { prisma } from '@/lib/prisma';
import { formatDate, formatDateTime, daysSince } from '@/lib/dates';
import { humanise } from '@/services/dashboard.service';
import { hasCapability } from '@/lib/rbac';
import { getProjectRoles } from '@/services/project-access.service';
import { isAppError } from '@/lib/errors';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RiskChip, StatusChip } from '@/components/domain/risk-chip';
import { NoticeCountdown } from '@/components/domain/notice-countdown';
import { Money } from '@/components/domain/money';
import { AssessmentForm } from './assessment-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const change = await prisma.potentialChange
    .findUnique({ where: { id }, select: { pcNumber: true } })
    .catch(() => null);
  return { title: change?.pcNumber ?? 'Potential Change' };
}

export default async function PotentialChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  let change;
  try {
    change = await getPotentialChange(user, id);
  } catch (error) {
    // A 403 and a 404 both render as "not found" HERE, in the UI only. The API
    // still answers 403, because a caller needs to tell a denial from a typo.
    if (isAppError(error) && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }

  const [projectRoles, activity, similar] = await Promise.all([
    getProjectRoles(user, change.projectId),
    prisma.activityLog.findMany({
      where: { recordType: 'potential_change', recordId: id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { user: { select: { fullName: true } } },
    }),
    // Suggestions only. Never merges, never closes, never decides.
    findSimilarChanges(user, id).catch(() => []),
  ]);

  const canAssess =
    hasCapability(user.systemRole, projectRoles, 'potentialChange.assessNotice') &&
    change.noticeStatus === 'not_assessed';

  const amberThreshold = 7;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <Link
        href="/variations"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to register
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="tabular text-sm font-semibold text-primary">{change.pcNumber}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{change.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/projects/${change.projectId}`} className="hover:underline">
              {change.project.projectCode} — {change.project.projectName}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={change.currentStatus} />
          <RiskChip level={change.riskLevel} />
        </div>
      </header>

      {/* The four questions the whole product exists to answer, first. */}
      <Card className="border-s-4 border-s-primary">
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Current owner
            </p>
            <p className="mt-1 font-medium">
              {change.currentOwner?.fullName ?? (
                <span className="text-risk-red">Unassigned</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Next action
            </p>
            <p className="mt-1 font-medium">{change.nextAction ?? '—'}</p>
            {change.nextActionDueDate ? (
              <p className="tabular mt-0.5 text-sm text-muted-foreground">
                Due {formatDate(change.nextActionDueDate)}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notice deadline
            </p>
            <div className="mt-1">
              <NoticeCountdown
                noticeDueDate={change.noticeDueDate}
                amberThresholdDays={amberThreshold}
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Waiting
            </p>
            <p className="mt-1 font-medium">{change.waitingFor ?? '—'}</p>
            <p className="tabular mt-0.5 text-sm text-muted-foreground">
              {daysSince(change.createdAt) ?? 0} days since capture
            </p>
          </div>
        </CardContent>
      </Card>

      {change.blockerReason ? (
        <Card className="border-risk-amber bg-risk-amber-bg/40">
          <CardContent className="pt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-risk-amber">Blocked</p>
            <p className="mt-1 text-sm">{change.blockerReason}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What changed</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{change.description}</p>

              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Requested by" icon={User}>
                  {change.requestedByContact?.fullName ?? change.sourceSenderName ?? '—'}
                  {change.requestedByContact ? (
                    <Badge
                      variant={change.requestedByContact.canRequestChange ? 'riskGreen' : 'riskAmber'}
                      className="ms-2"
                    >
                      {change.requestedByContact.canRequestChange
                        ? 'Authorised to request'
                        : 'Authority not confirmed'}
                    </Badge>
                  ) : null}
                </Field>
                <Field label="Authority status">
                  <StatusChip status={change.sourceSenderAuthorityStatus} />
                </Field>
                <Field label="Source">{humanise(change.sourceType)}</Field>
                <Field label="Reported by">{change.reportedBy?.fullName ?? '—'}</Field>
                <Field label="Location" icon={MapPin}>{change.location ?? '—'}</Field>
                <Field label="Trade">{change.trade ?? '—'}</Field>
                <Field label="Event date">{formatDate(change.eventDate)}</Field>
                <Field label="Captured">{formatDateTime(change.captureDate)}</Field>
                <Field label="Work status">{humanise(change.workStatus)}</Field>
                <Field label="Estimated value">
                  <Money value={change.estimatedValue?.toString() ?? null} />
                </Field>
                <Field label="Time impact">
                  {change.potentialTimeImpact
                    ? `Possible${change.timeImpactDays ? ` — ${change.timeImpactDays} days` : ''}`
                    : 'None identified'}
                </Field>
                <Field label="Notice status">
                  <StatusChip status={change.noticeStatus} />
                </Field>
              </dl>
            </CardContent>
          </Card>

          {canAssess ? <AssessmentForm potentialChangeId={change.id} /> : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList aria-hidden className="size-4" />
                Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {change.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks raised.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {change.tasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.assignedTo?.fullName ?? 'Unassigned'}
                          {task.dueDate ? ` · due ${formatDate(task.dueDate)}` : ''}
                        </p>
                      </div>
                      <StatusChip status={task.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip aria-hidden className="size-4" />
                Evidence
              </CardTitle>
            </CardHeader>
            <CardContent>
              {change.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No evidence attached. No instruction means weak proof.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {change.documents.map((document) => (
                    <li key={document.id}>
                      <a
                        href={`/api/documents/${document.id}/content`}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                      >
                        <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{document.documentName}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {similar.length > 0 ? (
            <Card className="border-dashed">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Copy aria-hidden className="size-4" />
                  Possible duplicates
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Suggested by similarity. Nothing has been merged or closed — judge for
                  yourself.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {similar.map((match) => (
                    <li key={match.id}>
                      <Link
                        href={`/variations/${match.id}`}
                        className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2 hover:bg-accent"
                      >
                        <span className="min-w-0">
                          <span className="tabular block text-xs font-medium text-primary">
                            {match.pcNumber}
                          </span>
                          <span className="line-clamp-2 text-sm">{match.title}</span>
                        </span>
                        <Badge variant="secondary" className="tabular shrink-0">
                          {Math.round(match.similarity * 100)}%
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History aria-hidden className="size-4" />
                Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {activity.map((entry) => (
                    <li key={entry.id} className="border-s-2 border-border ps-3">
                      <p className="text-sm font-medium capitalize">
                        {entry.actionType.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.user?.fullName ?? humanise(entry.source)} ·{' '}
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
        {label}
      </dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}
