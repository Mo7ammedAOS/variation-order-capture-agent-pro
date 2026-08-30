import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertTriangle, ClipboardList, Copy, FileText, History, MapPin, Paperclip, ShieldAlert, User,
} from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { allowedNextStatuses, getPotentialChange } from '@/services/potential-change.service';
import { findSimilarChanges } from '@/services/search.service';
import { prisma } from '@/lib/prisma';
import { formatDate, formatDateTime, daysSince } from '@/lib/dates';
import { humanise } from '@/services/dashboard.service';
import { hasCapability, listMembersWithCapability } from '@/services/permissions.service';
import { PROJECT_ROLE_LABELS } from '@/lib/rbac';
import { getProjectRoles } from '@/services/project-access.service';
import { isAppError } from '@/lib/errors';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BackButton } from '@/components/ui/page-actions';
import { Badge } from '@/components/ui/badge';
import { RiskChip, StatusChip } from '@/components/domain/risk-chip';
import { NoticeCountdown } from '@/components/domain/notice-countdown';
import { Money } from '@/components/domain/money';
import { AssessmentForm } from './assessment-form';
import { StatusForm } from './status-form';

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ evidenceFailed?: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  // Set by the capture action when a photo failed to reach storage. Someone who
  // watched an upload and got no warning would believe the evidence exists.
  const { evidenceFailed } = await searchParams;

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

  // Asked of the same source the service consults, so the page can never offer
  // a button the admin has revoked, nor hide one they have granted.
  const [mayAssess, canChangeStatus] = await Promise.all([
    hasCapability(user.systemRole, projectRoles, 'potentialChange.assessNotice'),
    hasCapability(user.systemRole, projectRoles, 'potentialChange.changeStatus'),
  ]);

  const canAssess = mayAssess && change.noticeStatus === 'not_assessed';

  /*
    When the entitlement question is still open and the person looking at it
    cannot answer it, the page has to SAY so.

    Showing nothing was the original behaviour, and it produced the worst
    version of this: a task assigned to a project manager, sitting on his own
    My Tasks page, with no control anywhere on the change and no reason given.
    He can only conclude the app is broken. It was in fact refusing him, on
    purpose, in silence.
  */
  const awaitingAssessment = change.noticeStatus === 'not_assessed' && !mayAssess;
  const assessors = awaitingAssessment
    ? await listMembersWithCapability(change.projectId, 'potentialChange.assessNotice')
    : [];
  const assessorNames = assessors.length
    ? await prisma.user.findMany({
        where: { id: { in: assessors.map((a) => a.userId) } },
        select: { id: true, fullName: true },
      })
    : [];
  const assignedToViewer = change.tasks.some(
    (task) =>
      task.taskType === 'notice_assessment' &&
      task.assignedToUserId === user.id &&
      (task.status === 'open' || task.status === 'in_progress'),
  );
  const nextStatuses = allowedNextStatuses(change.currentStatus);

  // How long the change sat before anyone said so. Evidence in its own right:
  // a change raised three weeks after it happened tells you something about the
  // notice risk before anyone assesses it, so it is stated rather than left to
  // be worked out from two dates in different corners of the page.
  const reportingLagDays = daysSince(change.eventDate, change.sourceOccurredAt ?? undefined);

  const amberThreshold = 7;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <BackButton href="/variations" label="Back to register" />

      {evidenceFailed ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            The change was filed, but {evidenceFailed}{' '}
            {evidenceFailed === '1' ? 'photo' : 'photos'} did not upload. The record and its
            notice clock are safe — attach the evidence again when you can.
          </span>
        </p>
      ) : null}

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
                <Field label="Raised via">
                  {humanise(change.sourceType)}
                  {change.sourceLocation ? (
                    <span className="block text-xs text-muted-foreground">
                      {change.sourceLocation}
                    </span>
                  ) : null}
                </Field>
                <Field label="Raised on">
                  {change.sourceOccurredAt ? (
                    <>
                      {formatDateTime(change.sourceOccurredAt)}
                      {reportingLagDays !== null && reportingLagDays > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          {reportingLagDays} {reportingLagDays === 1 ? 'day' : 'days'} after the
                          event
                        </span>
                      ) : null}
                    </>
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label="Reported by">{change.reportedBy?.fullName ?? '—'}</Field>
                <Field label="Where on site" icon={MapPin}>{change.location ?? '—'}</Field>
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

          {awaitingAssessment ? (
            <Card tone={assessors.length === 0 || assignedToViewer ? 'notice' : 'plain'}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert aria-hidden className="size-4" />
                  {assessors.length === 0
                    ? 'Nobody can assess this notice'
                    : assignedToViewer
                      ? 'This is assigned to you, but the decision is not yours'
                      : 'Waiting on the notice assessment'}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed">
                {assessors.length === 0 ? (
                  <p>
                    No active member of this project holds the authority to decide whether a
                    contractual notice is required, so this change cannot move on. The notice
                    clock is still running. Ask your administrator to grant{' '}
                    <span className="font-semibold">Assess notice</span> to a role on this
                    project, in Settings → Permissions.
                  </p>
                ) : (
                  <>
                    <p>
                      {assignedToViewer
                        ? 'The task is on your list, but your project role does not carry this authority. Either it should be reassigned, or your administrator should grant it to your role in Settings → Permissions.'
                        : 'This change is waiting on whether a contractual notice is required. That decision belongs to:'}
                    </p>
                    <ul className="mt-2.5 flex flex-col gap-1">
                      {assessors.map((assessor) => (
                        <li key={assessor.userId} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-semibold">
                            {assessorNames.find((n) => n.id === assessor.userId)?.fullName ??
                              'Unknown'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {PROJECT_ROLE_LABELS[assessor.projectRole]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {canChangeStatus ? (
            <StatusForm
              potentialChangeId={change.id}
              currentStatus={change.currentStatus}
              options={nextStatuses}
            />
          ) : null}

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
