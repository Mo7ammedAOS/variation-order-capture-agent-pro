import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getProject } from '@/services/project.service';
import { getProjectDashboard } from '@/services/dashboard.service';
import { listPotentialChanges } from '@/services/potential-change.service';
import { listBottlenecks } from '@/services/bottleneck.service';
import { isNoticeOverdue } from '@/services/notice.service';
import { prisma } from '@/lib/prisma';
import { isAppError } from '@/lib/errors';
import { formatDate, daysUntil, todayUtc } from '@/lib/dates';
import { humanise } from '@/services/dashboard.service';
import { formatMoney } from '@/components/domain/money';
import { BackButton } from '@/components/ui/page-actions';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await prisma.project
    .findUnique({ where: { id }, select: { projectCode: true } })
    .catch(() => null);

  return { title: project ? `${project.projectCode} variation register` : 'Variation register' };
}

/**
 * The variation register report.
 *
 * A document, not a dashboard. It is the thing somebody prints before a
 * progress meeting or sends to a consultant, so it answers the questions that
 * get asked in that room, in the order they get asked: what is at risk of
 * lapsing, what is it worth, and who is holding it.
 *
 * Two decisions worth stating.
 *
 * It is ordered by notice deadline, soonest first, NOT by PC number. A register
 * sorted by number is a filing system; sorted by deadline it is a list of what
 * to deal with. The overdue ones are at the top because they are the ones that
 * cost money.
 *
 * It shows what is in the database and nothing else. No projections, no
 * forecast of what a change "should" settle at, no totals that mix approved
 * values with estimates as though they were the same kind of number. Estimated
 * value is labelled estimated everywhere it appears, because this page will end
 * up in front of a client and an estimate presented as a figure is a
 * negotiating position nobody chose to take.
 */
export default async function ProjectReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  let project;
  try {
    project = await getProject(user, id);
  } catch (error) {
    if (isAppError(error) && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }

  const [dashboard, changes, bottlenecks, settings] = await Promise.all([
    getProjectDashboard(user, id),
    listPotentialChanges(user, { projectId: id }),
    listBottlenecks(user, { projectId: id }),
    prisma.companySettings
      .findFirst({ select: { displayCompanyName: true, defaultCurrency: true } })
      .catch(() => null),
  ]);

  const currency = settings?.defaultCurrency ?? 'AED';
  const today = todayUtc();

  const open = changes.filter(
    (change) => !['included_scope', 'cancelled'].includes(change.currentStatus),
  );
  // Same predicate the dashboard uses, so the two cannot disagree.
  const overdue = open.filter((change) =>
    isNoticeOverdue(change.noticeDueDate, change.noticeStatus, today),
  );
  const dueSoon = open.filter((change) => {
    const days = daysUntil(change.noticeDueDate);
    return days !== null && days >= 0 && days <= 7;
  });
  const openValue = open.reduce((total, change) => total + Number(change.estimatedValue ?? 0), 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 print:max-w-none print:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackButton href={`/projects/${id}`} label="Back to project" />
        <PrintButton />
      </div>

      <header className="border-b border-border pb-4">
        <p className="text-sm font-medium">{settings?.displayCompanyName ?? 'Variation control'}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Variation register</h1>
        <p className="mt-2 text-sm">
          <span className="tabular font-semibold">{project.projectCode}</span>
          {' — '}
          {project.projectName}
        </p>
        <p className="text-sm text-muted-foreground">
          {project.clientName}
          {project.consultantName ? ` · ${project.consultantName}` : ''}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          As at {formatDate(today)} · {changes.length} changes recorded ·{' '}
          {open.length} still open
        </p>
      </header>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Open changes" value={String(open.length)} />
        <Figure
          label={`Estimated value at stake (${currency})`}
          value={formatMoney(openValue, currency, { abbreviate: false })}
          note="Estimates, not agreed values"
        />
        <Figure
          label="Notices overdue"
          value={String(overdue.length)}
          tone={overdue.length > 0 ? 'red' : undefined}
        />
        <Figure
          label="Notices due within 7 days"
          value={String(dueSoon.length)}
          tone={dueSoon.length > 0 ? 'amber' : undefined}
        />
      </section>

      <section aria-label="Register" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">
          Changes, by notice deadline
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            soonest first; those without a deadline last
          </span>
        </h2>

        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded on this project.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-start">
                  <Th>PC number</Th>
                  <Th>Change</Th>
                  <Th>Status</Th>
                  <Th>Owner</Th>
                  <Th>Event</Th>
                  <Th>Notice due</Th>
                  <Th className="text-end">Estimated {currency}</Th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => {
                  const days = daysUntil(change.noticeDueDate);
                  const isOverdue = isNoticeOverdue(
                    change.noticeDueDate,
                    change.noticeStatus,
                    today,
                  );
                  const isSoon = days !== null && days >= 0 && days <= 7;

                  return (
                    <tr
                      key={change.id}
                      className="break-inside-avoid border-b border-border align-top"
                    >
                      <Td className="tabular whitespace-nowrap font-medium">{change.pcNumber}</Td>
                      <Td>
                        {change.title}
                        {change.location ? (
                          <span className="block text-xs text-muted-foreground">
                            {change.location}
                          </span>
                        ) : null}
                      </Td>
                      <Td>{humanise(change.currentStatus)}</Td>
                      <Td>{change.currentOwner?.fullName ?? 'Unassigned'}</Td>
                      <Td className="whitespace-nowrap">{formatDate(change.eventDate)}</Td>
                      <Td className="whitespace-nowrap">
                        {change.noticeDueDate ? formatDate(change.noticeDueDate) : '—'}
                        {isOverdue && days !== null ? (
                          <span className="block text-xs font-semibold text-risk-red">
                            {Math.abs(days)} days overdue
                          </span>
                        ) : isSoon ? (
                          <span className="block text-xs font-semibold text-risk-amber">
                            {days === 0 ? 'due today' : `${days} days left`}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="tabular whitespace-nowrap text-end">
                        {change.estimatedValue
                          ? formatMoney(change.estimatedValue.toString(), currency, {
                              abbreviate: false,
                            })
                          : '—'}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <Td colSpan={6}>Total, open changes only</Td>
                  <Td className="tabular whitespace-nowrap text-end">
                    {formatMoney(openValue, currency, { abbreviate: false })}
                  </Td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Bottlenecks" className="flex flex-col gap-2 break-inside-avoid">
        <h2 className="text-base font-semibold">
          What is holding things up
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            {bottlenecks.length} open
          </span>
        </h2>

        {bottlenecks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is currently flagged as blocked.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bottlenecks.map((bottleneck) => (
              <li key={bottleneck.id} className="break-inside-avoid border-b border-border pb-2">
                {/*
                  `capitalize` belongs on the type alone. Applied to the whole
                  line it also title-cased the duration, giving "11 Days".
                */}
                <p className="text-sm font-medium">
                  <span className="capitalize">{humanise(bottleneck.bottleneckType)}</span>
                  {bottleneck.overdueDays ? (
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {bottleneck.overdueDays} {bottleneck.overdueDays === 1 ? 'day' : 'days'}
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  {bottleneck.potentialChange ? (
                    <span className="tabular">{bottleneck.potentialChange.pcNumber} — </span>
                  ) : null}
                  {bottleneck.potentialChange?.title ?? 'Project level'}
                </p>
                {bottleneck.blockedByUser || bottleneck.blockedByContact ? (
                  <p className="text-xs text-muted-foreground">
                    Waiting on{' '}
                    {bottleneck.blockedByUser?.fullName ??
                      `${bottleneck.blockedByContact?.fullName}${
                        bottleneck.blockedByContact?.companyName
                          ? `, ${bottleneck.blockedByContact.companyName}`
                          : ''
                      }`}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
        <p>
          Produced from the variation register on {formatDate(today)} by {user.fullName}. Values
          shown are estimates recorded at capture and are not agreed amounts. Open tasks:{' '}
          {dashboard.openTasks}.
        </p>
      </footer>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'red' | 'amber';
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular ${
          tone === 'red' ? 'text-risk-red' : tone === 'amber' ? 'text-risk-amber' : ''
        }`}
      >
        {value}
      </p>
      {note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-2 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-2 py-2 ${className}`}>
      {children}
    </td>
  );
}
