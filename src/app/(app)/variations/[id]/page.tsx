import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertTriangle, ClipboardList, Copy, FileSearch, FileText, History, MapPin, Paperclip,
  ShieldAlert, User,
} from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { allowedNextStatuses, getPotentialChange } from '@/services/potential-change.service';
import { findSimilarChanges } from '@/services/search.service';
import { findScopeMatches } from '@/services/document-index.service';
import { prisma } from '@/lib/prisma';
import { daysSince, formatDate, formatDateTime, formatInstant, toDateInputValue, todayUtc } from '@/lib/dates';
import { humanise } from '@/services/dashboard.service';
import { hasCapability, listMembersWithCapability } from '@/services/permissions.service';
import { canFillSeat, getGateState, GATE_LABEL } from '@/services/approval.service';
import { getCurrentNotice } from '@/services/notice-document.service';
import { getVariationOrderForChange } from '@/services/variation-order.service';
import { retentionOn } from '@/services/invoice.service';
import { creditableGross, issuedCredits } from '@/services/credit-note.service';
import { subtractDecimals, sumDecimals } from '@/lib/money';
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
import { ApprovalPanel } from './approval-panel';
import { NoticePanel, type NoticeView } from './notice-panel';
import { MoneyPanel, type VoView } from './money-panel';
import { EditPanel } from './edit-panel';
import { CasePanel } from './case-panel';
import { PricingPanel } from './pricing-panel';
import { getPricing } from '@/services/pricing.service';
import { StatusForm, type BlockedReason } from './status-form';

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

  const [projectRoles, activity, similar, scopeMatches] = await Promise.all([
    getProjectRoles(user, change.projectId),
    prisma.activityLog.findMany({
      where: { recordType: 'potential_change', recordId: id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { user: { select: { fullName: true } } },
    }),
    // Suggestions only. Never merges, never closes, never decides.
    findSimilarChanges(user, id).catch(() => []),
    // Against the project's OWN contract, BOQ and scope. Evidence for a human,
    // never a verdict: a model that closes claims eventually closes a real one.
    findScopeMatches(change.projectId, `${change.title}\n${change.description ?? ''}`).catch(
      () => [],
    ),
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
  /*
    The gate the change is standing at, if any.

    Only ONE is ever live: notice_issue while a notice is waiting to go to the
    client, final_variation once a price exists. Both are read so that a change
    which has moved past the first still shows what was decided and by whom —
    an approval is evidence, and it stops being useful the moment it is hidden.
  */
  const activeGate =
    change.currentStatus === 'notice_required'
      ? ('notice_issue' as const)
      : change.currentStatus === 'internal_approval'
        ? ('final_variation' as const)
        : null;

  const gateState = activeGate ? await getGateState(change.id, activeGate) : null;
  const gateSeats = gateState
    ? await Promise.all(
        gateState.seats.map(async (seat) => ({
          id: seat.id,
          seatLabel: seat.seatLabel,
          decision: seat.decision,
          assignedToName: seat.assignedToName,
          decidedByName: seat.decidedByName,
          decidedAt: seat.decidedAt ? formatInstant(seat.decidedAt) : null,
          comment: seat.comment,
          mine:
            seat.decision === 'pending' &&
            (await canFillSeat(user, change.projectId, seat.seat)),
        })),
      )
    : [];

  /*
    Correcting your own report.

    `updateOwn` is a separate right from `update` because they are different
    acts: fixing what you wrote is not rewriting what a colleague wrote. Both
    are asked here, and the answer decides whether the panel appears at all —
    a form you are not allowed to submit is worse than no form.
  */
  const [mayEditAny, mayEditOwn, mayReopen, mayUpload] = await Promise.all([
    hasCapability(user.systemRole, projectRoles, 'potentialChange.update'),
    hasCapability(user.systemRole, projectRoles, 'potentialChange.updateOwn'),
    hasCapability(user.systemRole, projectRoles, 'potentialChange.reopen'),
    hasCapability(user.systemRole, projectRoles, 'document.upload'),
  ]);

  const [mayCancel, mayPrice] = await Promise.all([
    hasCapability(user.systemRole, projectRoles, 'potentialChange.cancel'),
    hasCapability(user.systemRole, projectRoles, 'pricing.submit'),
  ]);

  /*
    The notice itself.

    Read for every change that has one, at every stage — not only while it is
    a draft. Once served it is the single most important thing on this page:
    what was said, when it left, and what proves it. Hiding it after issue
    would mean the file cannot answer the question it exists to answer.
  */
  const noticeRecord = await getCurrentNotice(change.id);
  const [mayDraftNotice, mayAcknowledgeNotice] = await Promise.all([
    hasCapability(user.systemRole, projectRoles, 'notice.draft'),
    hasCapability(user.systemRole, projectRoles, 'notice.acknowledge'),
  ]);

  /*
    The money end.

    Read for every change that has a variation order, at every stage. The
    figures are assembled here, on the server, from frozen columns — the panel
    adds nothing up, so a number can only be wrong in one place.
  */
  const voRecord = await getVariationOrderForChange(change.id);
  const [mayManageVo, mayInvoice, mayRecordPayment] = await Promise.all([
    hasCapability(user.systemRole, projectRoles, 'variationOrder.manage'),
    hasCapability(user.systemRole, projectRoles, 'invoice.manage'),
    hasCapability(user.systemRole, projectRoles, 'payment.record'),
  ]);

  const today = todayUtc();

  const vo: VoView | null = voRecord
    ? (() => {
        const live = voRecord.invoices.filter((invoice) => invoice.status !== 'cancelled');
        const applied = sumDecimals(live.map((invoice) => invoice.grossThisPeriod.toString()));
        const approvedValue = voRecord.approvedValue?.toString() ?? null;
        const submittedValue = voRecord.submittedValue?.toString() ?? null;

        const shortfall =
          submittedValue && approvedValue
            ? subtractDecimals(submittedValue, approvedValue)
            : null;
        const unbilled = approvedValue ? subtractDecimals(approvedValue, applied) : null;

        // Retention held on this variation, net of anything credited back and
        // anything already released. Assembled here from the same frozen
        // columns the service uses, so the panel and the position agree.
        const retention = retentionOn(voRecord.invoices);
        const releasedStages = voRecord.invoices
          .filter(
            (invoice) =>
              invoice.status !== 'cancelled' &&
              invoice.kind === 'retention_release' &&
              invoice.retentionStage !== null,
          )
          .map((invoice) => invoice.retentionStage!);

        return {
          id: voRecord.id,
          voNumber: voRecord.voNumber,
          status: voRecord.status,
          clientResponse: voRecord.clientResponse,
          submittedValue,
          submittedAt: voRecord.submittedAt ? formatInstant(voRecord.submittedAt) : null,
          submittedByName: voRecord.submittedBy?.fullName ?? null,
          approvedValue,
          shortfall: shortfall && !shortfall.startsWith('-') ? shortfall : null,
          clientResponseAt: voRecord.clientResponseAt
            ? formatInstant(voRecord.clientResponseAt)
            : null,
          clientReference: voRecord.clientReference,
          clientResponseNotes: voRecord.clientResponseNotes,
          unbilled: unbilled && !unbilled.startsWith('-') ? unbilled : null,
          timeImpactDaysClaimed: voRecord.timeImpactDaysClaimed,
          timeImpactBasis: voRecord.timeImpactBasis,
          approvedTimeImpactDays: voRecord.approvedTimeImpactDays,
          retentionHeld: retention.held,
          releasedStages,
          invoices: voRecord.invoices.map((invoice) => {
            const paidTotal = sumDecimals(
              invoice.payments.map((payment) => payment.amount.toString()),
            );
            // Credits come off before anything else. An invoice half credited
            // is not half outstanding, it is half owed, and a chase against
            // the face value would be a demand for money already given back.
            const creditedTotal = sumDecimals(
              issuedCredits(invoice.creditNotes).map((note) => note.totalCredited.toString()),
            );
            const demand = subtractDecimals(invoice.totalDue.toString(), creditedTotal);
            const outstanding = subtractDecimals(demand, paidTotal);
            return {
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              status: invoice.status,
              kind: invoice.kind,
              retentionStage: invoice.retentionStage,
              retentionReleased: invoice.retentionReleased.toString(),
              creditedTotal,
              creditableGross: creditableGross(
                invoice.grossThisPeriod.toString(),
                invoice.creditNotes,
              ),
              creditNotes: invoice.creditNotes.map((note) => ({
                id: note.id,
                creditNoteNumber: note.creditNoteNumber,
                status: note.status,
                reason: note.reason,
                narrative: note.narrative,
                grossAmount: note.grossAmount.toString(),
                totalCredited: note.totalCredited.toString(),
                issuedAt: note.issuedAt ? formatInstant(note.issuedAt) : null,
              })),
              periodEnd: formatDate(invoice.periodEnd),
              cumulativePercent: invoice.cumulativePercent.toString(),
              grossThisPeriod: invoice.grossThisPeriod.toString(),
              retentionAmount: invoice.retentionAmount.toString(),
              netValue: invoice.netValue.toString(),
              vatAmount: invoice.vatAmount.toString(),
              totalDue: invoice.totalDue.toString(),
              issuedAt: invoice.issuedAt ? formatInstant(invoice.issuedAt) : null,
              dueAt: invoice.dueAt ? formatDate(invoice.dueAt) : null,
              // Derived here, never stored: an "overdue" column would need a
              // nightly job to stay true, and a stale one is worse than none.
              overdue:
                (invoice.status === 'issued' || invoice.status === 'part_paid') &&
                invoice.dueAt !== null &&
                invoice.dueAt.getTime() < today.getTime() &&
                !outstanding.startsWith('-') &&
                outstanding !== '0.00',
              paidTotal,
              outstanding: outstanding.startsWith('-') ? '0.00' : outstanding,
              payments: invoice.payments.map((payment) => ({
                id: payment.id,
                amount: payment.amount.toString(),
                receivedAt: formatDate(payment.receivedAt),
                reference: payment.reference,
              })),
            };
          }),
        };
      })()
    : null;

  const notice: NoticeView | null = noticeRecord
    ? {
        id: noticeRecord.id,
        reference: noticeRecord.reference,
        version: noticeRecord.version,
        status: noticeRecord.status,
        subject: noticeRecord.subject,
        body: noticeRecord.body,
        recipientName: noticeRecord.recipientName,
        recipientEmail: noticeRecord.recipientEmail,
        draftedByName: noticeRecord.draftedBy?.fullName ?? null,
        issuedByName: noticeRecord.issuedBy?.fullName ?? null,
        issuedAt: noticeRecord.issuedAt ? formatInstant(noticeRecord.issuedAt) : null,
        sentAt: noticeRecord.sentAt ? formatInstant(noticeRecord.sentAt) : null,
        externalMessageId: noticeRecord.externalMessageId,
        acknowledgedAt: noticeRecord.acknowledgedAt
          ? formatInstant(noticeRecord.acknowledgedAt)
          : null,
        acknowledgedByName: noticeRecord.acknowledgedBy?.fullName ?? null,
        documentId: noticeRecord.document?.id ?? null,
        deliveryStatus: noticeRecord.notification?.status ?? null,
        deliveryFailureReason: noticeRecord.notification?.failureReason ?? null,
        canDraft: mayDraftNotice,
        canAcknowledge: mayAcknowledgeNotice,
      }
    : null;

  /*
    The build-up is shown from the moment a change reaches pricing and never
    hidden again. An approved variation whose price is invisible is a number
    nobody can check, and "what was this £40,000 for" is the first question
    asked in every account meeting.
  */
  const pricingStages = ['qs_pricing', 'internal_approval', 'variation_approved'];
  const pricing = pricingStages.includes(change.currentStatus)
    ? await getPricing(user, change.id)
    : null;

  const isReporter = change.reportedByUserId === user.id;
  const canEdit = mayEditAny || (isReporter && mayEditOwn);
  const editableNow = ['new_potential_change', 'notice_assessment', 'needs_evidence'].includes(
    change.currentStatus,
  );

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

  /*
    When there is nothing to choose, say what is actually holding the change
    up. The panel used to answer that with "this change has reached the end of
    its lifecycle" — for a change that was alive and waiting on two approvals.
  */
  const blockedBy: BlockedReason =
    nextStatuses.length > 0
      ? null
      : change.currentStatus === 'notice_assessment'
        ? 'assessment'
        : change.currentStatus === 'notice_required'
          ? 'notice_gate'
          : change.currentStatus === 'qs_pricing'
            ? 'pricing'
            : change.currentStatus === 'internal_approval'
              ? 'final_gate'
              : 'ended';

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
              {/*
                The standardised reading first, the reporter's own words under
                it — and never the other way round, and never one instead of
                the other. The summary is quick to scan and may be wrong; the
                description is what was actually said and is quoted verbatim in
                a notice. Anyone acting on this needs to be able to check one
                against the other without leaving the page.
              */}
              {change.summary ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm leading-relaxed">{change.summary}</p>
                  <details className="group">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      As reported
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap border-s-2 ps-3 text-sm leading-relaxed text-muted-foreground">
                      {change.description}
                    </p>
                  </details>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{change.description}</p>
              )}

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
                {/* Who WANTED it, which is not who reported it. The consultant
                    asking for a different finish is a variation; the identical
                    words from our own foreman are rework we pay for. */}
                <Field label="Asked by">{change.instructedBy ?? '—'}</Field>
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

          {notice ? <NoticePanel potentialChangeId={change.id} notice={notice} /> : null}

          <MoneyPanel
            potentialChangeId={change.id}
            currency={change.project.currency ?? 'AED'}
            vo={vo}
            canManageVo={mayManageVo}
            canInvoice={mayInvoice}
            canRecordPayment={mayRecordPayment}
            changeIsApproved={change.currentStatus === 'variation_approved'}
            approvedInternalValue={change.submittedValue?.toString() ?? null}
          />

          {gateState && activeGate ? (
            <ApprovalPanel
              potentialChangeId={change.id}
              gateLabel={GATE_LABEL[activeGate]}
              round={gateState.round}
              seats={gateSeats}
            />
          ) : null}

          {canAssess ? <AssessmentForm potentialChangeId={change.id} /> : null}

          {pricing ? (
            <PricingPanel
              potentialChangeId={change.id}
              currency={change.project.currency ?? 'AED'}
              canPrice={mayPrice && change.currentStatus === 'qs_pricing'}
              pricingStatus={pricing.pricingStatus}
              submittedValue={pricing.submittedValue?.toFixed(2) ?? null}
              submittedAt={pricing.submittedAt ? formatInstant(pricing.submittedAt) : null}
              prelimsPercent={pricing.prelimsPercent?.toString() ?? ''}
              overheadProfitPercent={pricing.overheadProfitPercent?.toString() ?? ''}
              pricingNotes={pricing.pricingNotes ?? ''}
              items={pricing.items.map((item) => ({
                id: item.id,
                sequence: item.sequence,
                description: item.description,
                quantity: item.quantity.toString(),
                unit: item.unit,
                rate: item.rate.toFixed(2),
                amount: item.amount.toFixed(2),
                rateSource: item.rateSource,
                category: item.category,
                boqReference: item.boqReference,
              }))}
              totals={pricing.totals}
            />
          ) : null}

          {mayCancel && change.currentStatus !== 'included_scope' ? (
            <CasePanel
              potentialChangeId={change.id}
              cancelled={change.currentStatus === 'cancelled'}
            />
          ) : null}

          <EditPanel
            potentialChangeId={change.id}
            projectId={change.projectId}
            canEdit={canEdit}
            canReopen={mayReopen && change.currentStatus !== 'cancelled'}
            canAddEvidence={mayUpload}
            editableNow={editableNow}
            current={{
              title: change.title,
              description: change.description ?? '',
              location: change.location ?? '',
              trade: change.trade ?? '',
              eventDate: toDateInputValue(change.eventDate),
              workStatus: change.workStatus,
              instructedBy: change.instructedBy ?? '',
            }}
          />

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
              blockedBy={blockedBy}
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

          {scopeMatches.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSearch aria-hidden className="size-4" />
                  Check this against the contract
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  The closest wording in this project&rsquo;s own contract, BOQ and scope. It may
                  mean the work is already included, or that a rate for it already exists.
                  <strong> Read it before pricing.</strong> Nothing here decides anything.
                </p>
                <ul className="flex flex-col gap-3">
                  {scopeMatches.map((match) => (
                    <li
                      key={`${match.documentId}-${match.chunkIndex}`}
                      className="rounded-lg border border-border/70 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={`/api/documents/${match.documentId}/content`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          {match.documentName}
                        </a>
                        <Badge variant="secondary">{humanise(match.documentType)}</Badge>
                        <span className="ms-auto text-xs tabular text-muted-foreground">
                          {Math.round(match.similarity * 100)}% match
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {match.excerpt}
                      </p>
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
