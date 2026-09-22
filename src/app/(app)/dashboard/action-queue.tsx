import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import {
  ACTION_LABELS,
  QUEUE_FILTERS,
  QUEUE_SORTS,
  type ActionRow,
  type QueueFilter,
  type QueueSort,
} from '@/lib/dashboard-metrics';
import { Money } from '@/components/domain/money';
import { EmptyState } from '@/components/domain/empty-state';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * One table in place of sixteen cards.
 *
 * ── What the old cards could not do ───────────────────────────────────────
 * A card saying "Notices overdue: 4" is a count, and a count is not an
 * instruction. The PM still had to open the register, work out which four,
 * whose they were, and what to do about each. Every row here carries the thing
 * to do, the person who owes it, the money behind it and the date it turns on,
 * so the screen answers "which one first" without a second click.
 *
 * ── Why the filters are links ─────────────────────────────────────────────
 * They live in the URL, like the register's. "Look at the red ones on Office
 * Fit-out" is then a link somebody can send, and the page stays a server
 * component — no client bundle, no hydration, and the first paint is the
 * finished table.
 */

const PRIORITY_VARIANT = {
  red: 'riskRed',
  amber: 'riskAmber',
  green: 'riskGreen',
} as const;

const PRIORITY_WORD = { red: 'Now', amber: 'Soon', green: 'Queued' } as const;

export function ActionQueue({
  rows,
  total,
  filter,
  sort,
  limit,
}: {
  rows: ActionRow[];
  total: number;
  filter: QueueFilter;
  sort: QueueSort;
  limit: number;
}) {
  const href = (next: Partial<{ queue: QueueFilter; sort: QueueSort }>) => {
    const params = new URLSearchParams();
    const queue = next.queue ?? filter;
    const order = next.sort ?? sort;
    if (queue !== 'all') params.set('queue', queue);
    if (order !== 'priority') params.set('sort', order);
    const query = params.toString();
    return query ? `/dashboard?${query}` : '/dashboard';
  };

  return (
    <section aria-labelledby="h-actions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="h-actions" className="text-base font-bold tracking-[-0.01em]">
          Needs Action Today
        </h2>
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? 'Nothing waiting on anybody'
            : `${total} action${total === 1 ? '' : 's'} across every stage`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Filter actions" className="flex flex-wrap gap-1.5">
          {QUEUE_FILTERS.map((entry) => (
            <Link
              key={entry.value}
              href={href({ queue: entry.value })}
              aria-current={entry.value === filter ? 'true' : undefined}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                entry.value === filter
                  ? 'bg-foreground text-background'
                  : 'bg-secondary text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Sort actions" className="ms-auto flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Sort</span>
          {QUEUE_SORTS.map((entry) => (
            <Link
              key={entry.value}
              href={href({ sort: entry.value })}
              aria-current={entry.value === sort ? 'true' : undefined}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                entry.value === sort
                  ? 'bg-secondary font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs action"
          description="Every change is with somebody, inside its deadline."
        />
      ) : (
        <>
          {/* Desktop: one scannable table. Phone: the same rows as cards,
              because a ten-column table on a phone is a horizontal scroll
              nobody performs in a corridor. */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-start font-semibold">Priority</th>
                  <th className="p-3 text-start font-semibold">Reference</th>
                  <th className="p-3 text-start font-semibold">Project</th>
                  <th className="p-3 text-start font-semibold">Owner</th>
                  <th className="p-3 text-start font-semibold">Next action</th>
                  <th className="p-3 text-end font-semibold">Value</th>
                  <th className="p-3 text-start font-semibold">Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-border/60 last:border-0 hover:bg-secondary/40"
                  >
                    <td className="p-3 align-top">
                      <Badge variant={PRIORITY_VARIANT[row.priority]}>
                        {PRIORITY_WORD[row.priority]}
                      </Badge>
                    </td>
                    <td className="p-3 align-top">
                      <Link href={row.href} className="font-semibold tabular hover:underline">
                        {row.reference}
                      </Link>
                      <p className="mt-0.5 max-w-[22rem] truncate text-xs text-muted-foreground">
                        {row.description}
                      </p>
                      <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                        {ACTION_LABELS[row.type]} · {row.status}
                      </p>
                    </td>
                    <td className="p-3 align-top text-xs">{row.projectName}</td>
                    <td className="p-3 align-top text-xs">
                      {row.ownerName}
                      <span className="ms-1 text-muted-foreground">({row.ownerRole})</span>
                    </td>
                    {/* The whole point of the screen, so it is the only cell
                        set in the foreground colour at full weight. */}
                    <td className="p-3 align-top">
                      <Link
                        href={row.href}
                        className="inline-flex items-center gap-1 font-semibold hover:underline"
                      >
                        {row.nextAction}
                        <ArrowRight aria-hidden className="size-3.5" />
                      </Link>
                    </td>
                    <td className="p-3 align-top text-end">
                      <Money value={row.value} abbreviate />
                    </td>
                    <td className="p-3 align-top text-xs">
                      <Due row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex flex-col gap-2 lg:hidden">
            {rows.map((row) => (
              <Link key={row.key} href={row.href} className="block">
                <Card interactive className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="tabular text-sm font-bold">{row.reference}</p>
                      <p className="text-xs text-muted-foreground">{row.projectName}</p>
                    </div>
                    <Badge variant={PRIORITY_VARIANT[row.priority]}>
                      {PRIORITY_WORD[row.priority]}
                    </Badge>
                  </div>
                  <p className="text-sm font-semibold">{row.nextAction}</p>
                  <p className="text-xs text-muted-foreground">
                    {ACTION_LABELS[row.type]} · {row.ownerName} ({row.ownerRole})
                  </p>
                  <div className="flex items-center justify-between text-xs">
                    <Money value={row.value} abbreviate />
                    <Due row={row} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {total > limit ? (
        <p className="text-xs text-muted-foreground">
          Showing the {limit} most urgent of {total}.{' '}
          <Link href="/bottlenecks" className="font-semibold underline">
            View all
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Ageing, in the words a person uses about a deadline.
 *
 * "2 days overdue" and "in 2 days" are the same arithmetic and opposite
 * meanings, and a signed number in a column leaves the reader to work out
 * which. Rows with no contractual date say how long they have been sitting
 * instead, because "waiting 9 days" is still a fact worth acting on.
 */
function Due({ row }: { row: ActionRow }) {
  if (row.overdueDays === null) {
    return <span className="text-muted-foreground">Waiting {row.ageDays}d</span>;
  }
  if (row.overdueDays > 0) {
    return (
      <span className="font-semibold text-risk-red">
        {row.overdueDays} day{row.overdueDays === 1 ? '' : 's'} overdue
      </span>
    );
  }
  if (row.overdueDays === 0) return <span className="font-semibold text-risk-red">Today</span>;
  const left = -row.overdueDays;
  return (
    <span className={left <= 3 ? 'font-semibold text-risk-amber' : 'text-muted-foreground'}>
      In {left} day{left === 1 ? '' : 's'}
    </span>
  );
}
