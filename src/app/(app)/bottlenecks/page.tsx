import type { Metadata } from 'next';
import Link from 'next/link';
import { PartyPopper } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { listBottlenecks } from '@/services/bottleneck.service';
import { humanise } from '@/services/dashboard.service';
import { formatDate } from '@/lib/dates';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RiskChip } from '@/components/domain/risk-chip';
import { Money } from '@/components/domain/money';
import { EmptyState } from '@/components/domain/empty-state';

export const metadata: Metadata = { title: 'Bottlenecks' };
export const dynamic = 'force-dynamic';

export default async function BottlenecksPage() {
  const user = await requireUser();
  const bottlenecks = await listBottlenecks(user);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bottlenecks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What is blocked, who owns it, and how much is waiting on it.
        </p>
      </header>

      {bottlenecks.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="Nothing is blocked"
          description="No open bottlenecks across the projects you can see."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Blockage</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Blocked by</TableHead>
                <TableHead className="text-end">Waiting</TableHead>
                <TableHead className="text-end">Value at risk</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bottlenecks.map((bottleneck) => (
                <TableRow key={bottleneck.id}>
                  <TableCell>
                    <p className="font-medium">{humanise(bottleneck.bottleneckType)}</p>
                    {bottleneck.blockerReason ? (
                      <p className="text-xs text-muted-foreground">{bottleneck.blockerReason}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">
                    {bottleneck.project.projectCode}
                  </TableCell>
                  <TableCell>
                    {bottleneck.potentialChange ? (
                      <Link
                        href={`/variations/${bottleneck.potentialChange.id}`}
                        className="tabular text-primary hover:underline"
                      >
                        {bottleneck.potentialChange.pcNumber}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {bottleneck.blockedByUser?.fullName ??
                      bottleneck.blockedByContact?.fullName ??
                      (bottleneck.blockedByRole ? humanise(bottleneck.blockedByRole) : '—')}
                  </TableCell>
                  <TableCell className="tabular text-end">{bottleneck.overdueDays}d</TableCell>
                  <TableCell className="text-end">
                    <Money value={bottleneck.valueAtRisk?.toString() ?? null} />
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">
                    {formatDate(bottleneck.firstDetectedAt)}
                  </TableCell>
                  <TableCell>
                    <RiskChip level={bottleneck.riskLevel} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
