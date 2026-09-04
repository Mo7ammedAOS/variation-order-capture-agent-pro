import type { Metadata } from 'next';
import Link from 'next/link';
import { BellOff, Check, Clock, ShieldAlert } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { listMyNotifications, countMyUnread } from '@/services/notification.service';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/domain/empty-state';
import { markAllReadAction, markReadAction, openNotificationAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  task_assigned: 'Assigned to you',
  task_reminder: 'Reminder',
  task_escalation: 'Overdue',
  capture_question: 'Needs your answer',
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await requirePageUser();
  const showAll = (await searchParams).show === 'all';
  const [items, unread] = await Promise.all([
    listMyNotifications(user, 30, showAll),
    countMyUnread(user),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {showAll
              ? 'Everything, read and unread.'
              : unread === 0
                ? 'Nothing is waiting on you.'
                : `${unread} waiting on you.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={showAll ? '/notifications' : '/notifications?show=all'}>
              {showAll ? 'Show unread only' : 'Show read ones too'}
            </Link>
          </Button>
          {unread > 0 ? (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline" size="sm">
                <Check aria-hidden className="size-4" />
                Mark all as read
              </Button>
            </form>
          ) : null}
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={showAll ? 'Nothing yet' : 'All clear'}
          description={
            showAll
              ? 'When a decision is waiting on you, it lands here — and keeps reminding you until it is made.'
              : 'Nothing is waiting on you. Read ones are kept — use "Show read ones too".'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => {
            const unreadItem = item.readAt === null;
            const escalated = item.kind === 'task_escalation';

            return (
              <li key={item.id}>
                <Card tone={escalated && unreadItem ? 'notice' : 'plain'}>
                  <CardContent className="flex flex-col gap-2 pt-5 sm:pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          escalated
                            ? 'inline-flex items-center gap-1.5 rounded-full bg-risk-red-bg px-2.5 py-0.5 text-xs font-semibold text-risk-red'
                            : 'inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold'
                        }
                      >
                        {escalated ? <ShieldAlert aria-hidden className="size-3" /> : null}
                        {KIND_LABEL[item.kind] ?? 'Notification'}
                      </span>
                      {unreadItem ? (
                        <span className="size-2 rounded-full bg-primary" aria-label="Unread" />
                      ) : null}
                      <span className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock aria-hidden className="size-3" />
                        {formatDateTime(item.requestedAt)}
                      </span>
                    </div>

                    <p className="font-semibold leading-snug">{item.subject}</p>
                    {item.body ? (
                      <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                    ) : null}

                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      {item.potentialChange ? (
                        // Opening it is what reads it. One click, not two —
                        // asking somebody to open a thing and then separately
                        // declare that he opened it is the system making him
                        // do its bookkeeping.
                        <form action={openNotificationAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <input
                            type="hidden"
                            name="href"
                            value={`/variations/${item.potentialChange.id}`}
                          />
                          <button
                            type="submit"
                            className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                          >
                            Open {item.potentialChange.pcNumber}
                          </button>
                        </form>
                      ) : null}
                      {unreadItem ? (
                        <form action={markReadAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            type="submit"
                            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                          >
                            {item.potentialChange ? 'Dismiss' : 'Mark as read'}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
