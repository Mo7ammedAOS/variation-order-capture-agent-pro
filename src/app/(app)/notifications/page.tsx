import type { Metadata } from 'next';
import Link from 'next/link';
import { BellOff, Check, Clock, ShieldAlert } from 'lucide-react';
import { requirePageUser } from '@/lib/auth/session';
import { listMyNotifications, countMyUnread } from '@/services/notification.service';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/domain/empty-state';
import { markAllReadAction, markReadAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  task_assigned: 'Assigned to you',
  task_reminder: 'Reminder',
  task_escalation: 'Overdue',
  capture_question: 'Needs your answer',
};

export default async function NotificationsPage() {
  const user = await requirePageUser();
  const [items, unread] = await Promise.all([listMyNotifications(user), countMyUnread(user)]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unread === 0
              ? 'Everything here has been read.'
              : `${unread} you have not read yet.`}
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline" size="sm">
              <Check aria-hidden className="size-4" />
              Mark all as read
            </Button>
          </form>
        ) : null}
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="Nothing yet"
          description="When a decision is waiting on you, it lands here — and keeps reminding you until it is made."
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
                        <Link
                          href={`/variations/${item.potentialChange.id}`}
                          className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          Open {item.potentialChange.pcNumber}
                        </Link>
                      ) : null}
                      {unreadItem ? (
                        <form action={markReadAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            type="submit"
                            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                          >
                            Mark as read
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
