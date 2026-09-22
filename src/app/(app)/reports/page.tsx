import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BadgeCheck, CalendarClock, CalendarX2, FolderKanban, Hourglass, Landmark,
  PiggyBank, ReceiptText, RotateCcw, Wallet,
} from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { getOverview } from '@/services/dashboard.service';
import { resolvePersona } from '@/services/dashboard-queue.service';
import { ForbiddenError } from '@/lib/errors';
import { getCommercialPosition } from '@/services/invoice.service';
import { StatCard } from '@/components/domain/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FunnelRail, GaugeRing } from '@/components/domain/readings';
import { formatMoney } from '@/components/domain/money';
import { CountBarChart } from './charts';

export const metadata: Metadata = { title: 'Commercial Reports' };
export const dynamic = 'force-dynamic';

/**
 * Commercial Reports — where the reading, as opposed to the doing, lives.
 *
 * ── Why this page exists ──────────────────────────────────────────────────
 * Everything here was on the primary dashboard until 23 September 2026 and was
 * moved, not deleted. The test is simple and worth restating whenever
 * something is proposed for the overview: does a person DO anything
 * differently on seeing this number today?
 *
 * Retention held, days conceded, the ageing funnel and the four breakdown
 * charts all fail that test. They are how a commercial manager understands the
 * shape of the business on a Monday morning, which is a different activity
 * from clearing a queue, and mixing the two made the queue unreadable.
 *
 * Every figure is computed by the same services as before — `getOverview` and
 * `getCommercialPosition`, untouched. Nothing was recalculated for this page,
 * which is the only way the two screens can be guaranteed to agree.
 */
export default async function ReportsPage() {
  const user = await requirePageUser();

  /*
    Refused on the SERVER, not merely hidden from the menu.

    A site engineer has no business with retention, invoicing or payment — the
    spec is explicit — and a navigation link that is absent is not a
    permission. Asked the same way the dashboard asks it, so there is one
    definition of who this page is for.
  */
  if ((await resolvePersona(user)) === 'site_engineer') {
    throw new ForbiddenError('Commercial reports are not part of your role');
  }

  const [{ stats, charts }, money] = await Promise.all([
    getOverview(user),
    getCommercialPosition(user),
  ]);

  const riskCounts = Object.fromEntries(charts.byRisk.map((row) => [row.label, row.count]));
  const changesTracked = charts.byRisk.reduce((sum, row) => sum + row.count, 0);
  const noticesSafe = riskCounts.green ?? 0;

  const approved = Number(money.approvedValue);
  const invoiced = Number(money.invoicedTotal);
  const paid = Number(money.paidTotal);
  const unbilled = Number(money.unbilledValue);
  const outstanding = Number(money.outstandingTotal);
  const overdue = Number(money.overdueTotal);

  const abbreviated = (amount: number) => formatMoney(amount, 'AED', { abbreviate: true });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header>
        <h1 className="page-title">Commercial Reports</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The position, rather than the queue. What needs doing today is on the{' '}
          <Link href="/dashboard" className="font-semibold underline">
            Overview
          </Link>
          .
        </p>
      </header>

      <section aria-label="Position" className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Where the money is</CardTitle>
            <p className="text-xs text-muted-foreground">
              What the client has agreed, then what you have actually invoiced and been paid.
            </p>
          </CardHeader>
          <CardContent>
            <FunnelRail
              stages={[
                { label: 'Agreed by the client', display: abbreviated(approved), amount: approved },
                {
                  label: 'Invoiced',
                  display: abbreviated(invoiced),
                  amount: invoiced,
                  gapNote:
                    unbilled > 0 ? `${abbreviated(unbilled)} agreed and not yet applied for` : undefined,
                  gapTone: 'amber',
                },
                {
                  label: 'Received',
                  display: abbreviated(paid),
                  amount: paid,
                  gapNote:
                    overdue > 0
                      ? `${abbreviated(overdue)} is past its payment terms`
                      : outstanding > 0
                        ? `${abbreviated(outstanding)} outstanding, none of it overdue`
                        : undefined,
                  gapTone: overdue > 0 ? 'red' : 'amber',
                },
              ]}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Card>
            <CardContent className="p-5 sm:p-5">
              <GaugeRing
                value={noticesSafe}
                total={changesTracked}
                label="Notice clock still safe"
                caption="Open changes where the notice period has not started to run out."
                tone={
                  changesTracked === 0
                    ? 'brand'
                    : noticesSafe === changesTracked
                      ? 'green'
                      : (riskCounts.red ?? 0) > 0
                        ? 'red'
                        : 'amber'
                }
                size={96}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 sm:p-5">
              <GaugeRing
                value={money.time.daysApproved}
                total={money.time.daysClaimed}
                label="Days agreed of days claimed"
                caption={
                  money.time.daysConceded > 0
                    ? `${money.time.daysConceded} days conceded so far.`
                    : 'Nothing conceded on the programme.'
                }
                tone={money.time.daysConceded > 0 ? 'amber' : 'brand'}
                size={96}
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="h-invoicing" className="flex flex-col gap-3">
        <h2 id="h-invoicing" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          Invoicing and payment
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Submitted, awaiting client"
            value={abbreviated(stats.pendingVoValue)}
            icon={Hourglass}
            hint="Put to the client, no answer yet"
            href="/variations?status=with_client"
          />
          <StatCard
            label="Approved by the client"
            value={abbreviated(stats.approvedVoValue)}
            icon={BadgeCheck}
            tone="green"
            hint="What they agreed, not what we asked"
          />
          <StatCard
            label="Approved, not invoiced"
            value={abbreviated(unbilled)}
            icon={ReceiptText}
            tone={unbilled > 0 ? 'amber' : 'green'}
            hint={
              money.unbilledCount > 0
                ? `${money.unbilledCount} variation${money.unbilledCount === 1 ? '' : 's'} agreed and unbilled`
                : 'Everything agreed has been applied for'
            }
          />
          <StatCard
            label="Invoiced, unpaid"
            value={abbreviated(outstanding)}
            icon={ReceiptText}
            hint="Applied for and not yet received"
          />
          <StatCard
            label="Overdue payment"
            value={abbreviated(overdue)}
            icon={Landmark}
            tone={overdue > 0 ? 'red' : 'green'}
            hint={
              money.overdueCount > 0
                ? `${money.overdueCount} invoice${money.overdueCount === 1 ? '' : 's'} past terms`
                : 'Nothing past its terms'
            }
          />
          <StatCard
            label="Conceded on variations"
            value={abbreviated(Number(money.shortfallValue))}
            icon={Wallet}
            hint="Submitted, minus what the client agreed"
          />
        </div>
      </section>

      {/*
        Retention and time — the two things a fit-out contractor loses without
        ever deciding to. Retention is money already earned that somebody else
        is holding, and it comes back only if a person remembers to ask.
      */}
      <section aria-labelledby="h-retention" className="flex flex-col gap-3">
        <h2 id="h-retention" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          Retention and time
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Retention held"
            value={abbreviated(Number(money.retentionHeld))}
            icon={PiggyBank}
            tone={Number(money.retentionHeld) > 0 ? 'amber' : 'green'}
            hint={
              Number(money.retentionReleasedTotal) > 0
                ? `${abbreviated(Number(money.retentionReleasedTotal))} already released`
                : 'Earned, withheld, not yet asked back'
            }
          />
          <StatCard
            label="Credited back"
            value={abbreviated(Number(money.creditedTotal))}
            icon={RotateCcw}
            hint="Credit notes you have issued against invoices"
          />
          <StatCard
            label="Days claimed"
            value={String(money.time.daysClaimed)}
            icon={CalendarClock}
            hint={
              money.time.awaitingCount > 0
                ? `${money.time.awaitingCount} time claim${money.time.awaitingCount === 1 ? '' : 's'} unanswered`
                : `${money.time.daysApproved} agreed by the client`
            }
          />
          <StatCard
            label="Days conceded"
            value={String(money.time.daysConceded)}
            icon={CalendarX2}
            tone={money.time.daysConceded > 0 ? 'red' : 'green'}
            hint="Claimed, minus what the client agreed"
          />
        </div>
      </section>

      <section aria-labelledby="h-portfolio" className="flex flex-col gap-3">
        <h2 id="h-portfolio" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          Portfolio
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Active projects"
            value={stats.activeProjects}
            icon={FolderKanban}
            href="/projects"
          />
          <StatCard
            label="Estimated value at stake"
            value={abbreviated(stats.potentialChangeEstimatedValue)}
            icon={Wallet}
            hint="Every open change, at its best known value"
          />
        </div>
      </section>

      <section aria-labelledby="h-breakdowns" className="flex flex-col gap-3">
        <h2 id="h-breakdowns" className="text-sm font-bold tracking-[-0.01em] text-muted-foreground">
          Breakdowns
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <CountBarChart title="Potential changes by project" data={charts.byProject} />
          <CountBarChart title="Potential changes by status" data={charts.byStatus} />
          <CountBarChart title="Potential changes by risk" data={charts.byRisk} colourByRisk />
          <CountBarChart title="Overdue tasks by type" data={charts.overdueTasksByRole} />
        </div>
      </section>
    </div>
  );
}
