import 'server-only';
import type { Prisma, NotificationChannel, NotificationKind, EscalationLevel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { formatDate } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { dispatch } from '@/integrations/n8n/client';

/**
 * Telling a person a decision is waiting on them.
 *
 * ── Recording and sending are separate, deliberately ───────────────────────
 * A notification is WRITTEN inside the same transaction as the thing that
 * caused it, and SENT afterwards by a dispatcher. Nothing here makes a network
 * call while a transaction is open — that mistake already cost this project a
 * Drive folder tree and a five second timeout. The consequence that matters
 * commercially: if the container dies between recording and sending, the row
 * survives and the message goes out late. The alternative loses it silently.
 *
 * ── The database decides what is a repeat ──────────────────────────────────
 * Every row carries a `dedupeKey` under a unique index, and inserts use
 * `skipDuplicates`. So the daily sweep can run twice, or run again after a
 * restart, and nobody is chased twice for the same thing on the same day.
 * Remembering "when did I last send this" in application state would not
 * survive a redeploy, and the failure mode is messaging a director six times.
 *
 * ── An unconfigured channel is not a failure ───────────────────────────────
 * Email and WhatsApp go out through n8n, and in this deployment those lanes
 * are not built yet. Rather than manufacture a daily pile of failed rows, the
 * unconfigured channels are simply not queued, and the in-app record still
 * exists — so the intent is never lost and the log stays honest.
 */

export interface NotificationRecipient {
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
}

export interface TaskNotificationInput {
  taskId: string;
  potentialChangeId: string | null;
  kind: NotificationKind;
  escalationLevel?: EscalationLevel;
  subject: string;
  body: string;
  /** The day the message belongs to. Two sends on one day are one message. */
  on: Date;
  recipients: NotificationRecipient[];
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildDedupeKey(
  taskId: string,
  kind: NotificationKind,
  on: Date,
  channel: NotificationChannel,
  recipient: string,
): string {
  return `task:${taskId}:${kind}:${dayKey(on)}:${channel}:${recipient}`;
}

/** Which delivery routes this deployment can actually use right now. */
export function configuredChannels(): { email: boolean; whatsapp: boolean } {
  const env = getEnv();
  return {
    email: env.N8N_NOTIFY_EMAIL_URL !== '',
    whatsapp: env.N8N_NOTIFY_WHATSAPP_URL !== '',
  };
}

/**
 * Turns user ids into addressable people, dropping nulls and anyone
 * deactivated. Call it BEFORE opening a transaction — it is a read, and a
 * transaction that also creates a task is already holding locks.
 */
export async function loadRecipients(
  userIds: (string | null | undefined)[],
): Promise<NotificationRecipient[]> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, fullName: true, email: true, phone: true },
  });

  return users.map((user) => ({
    userId: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
  }));
}

/**
 * Writes the rows. Call inside the transaction that created the work, so a
 * task and the notice of it are committed together or not at all.
 */
export async function recordTaskNotifications(
  db: Prisma.TransactionClient,
  input: TaskNotificationInput,
): Promise<number> {
  const available = configuredChannels();
  const rows: Prisma.NotificationLogCreateManyInput[] = [];

  for (const recipient of input.recipients) {
    const common = {
      taskId: input.taskId,
      potentialChangeId: input.potentialChangeId,
      userId: recipient.userId,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      escalationLevel: input.escalationLevel ?? 'none',
      payloadSummary: input.subject,
    };

    // In-app is delivered by the act of existing: there is nothing to send and
    // nothing that can fail, so it is `sent` from the outset. Marking it
    // pending would make the dispatcher responsible for a delivery it does not
    // perform.
    rows.push({
      ...common,
      channel: 'in_app',
      recipient: recipient.userId,
      status: 'sent',
      sentAt: new Date(),
      dedupeKey: buildDedupeKey(input.taskId, input.kind, input.on, 'in_app', recipient.userId),
    });

    if (available.email && recipient.email) {
      rows.push({
        ...common,
        channel: 'email',
        recipient: recipient.email,
        status: 'pending',
        dedupeKey: buildDedupeKey(input.taskId, input.kind, input.on, 'email', recipient.email),
      });
    }

    if (available.whatsapp && recipient.phone) {
      rows.push({
        ...common,
        channel: 'whatsapp',
        recipient: recipient.phone,
        status: 'pending',
        dedupeKey: buildDedupeKey(
          input.taskId,
          input.kind,
          input.on,
          'whatsapp',
          recipient.phone,
        ),
      });
    }
  }

  if (rows.length === 0) return 0;

  const result = await db.notificationLog.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/**
 * Records a message that belongs to no task.
 *
 * "Which project did you mean?" is the first of these: it is not a task, it
 * cannot be opened in the app, and it is answered by replying. Recording it as
 * a task notification would put it in front of the daily chase, which would
 * then hound someone about a question that is not on any list.
 */
export async function recordDirectNotifications(
  db: Prisma.TransactionClient,
  input: {
    kind: NotificationKind;
    subject: string;
    body: string;
    recipients: NotificationRecipient[];
    /** Makes the row unique. Stable per logical message, so a retry writes nothing. */
    dedupeSeed: string;
    on: Date;
    potentialChangeId?: string | null;
    /**
     * The inbound message this answers, so n8n can send it as a REPLY on the
     * existing thread. A question about an email that arrives as a fresh email
     * gets read as noise from the system, and noise is what people stop
     * opening.
     */
    replyToMessageId?: string | null;
  },
): Promise<number> {
  const available = configuredChannels();
  const rows: Prisma.NotificationLogCreateManyInput[] = [];

  for (const recipient of input.recipients) {
    const common = {
      potentialChangeId: input.potentialChangeId ?? null,
      userId: recipient.userId,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      payloadSummary: input.subject,
      replyToMessageId: input.replyToMessageId ?? null,
    };

    rows.push({
      ...common,
      channel: 'in_app' as const,
      recipient: recipient.userId,
      status: 'sent' as const,
      sentAt: new Date(),
      dedupeKey: `${input.dedupeSeed}:in_app:${recipient.userId}`,
    });

    if (available.email && recipient.email) {
      rows.push({
        ...common,
        channel: 'email' as const,
        recipient: recipient.email,
        status: 'pending' as const,
        dedupeKey: `${input.dedupeSeed}:email:${recipient.email}`,
      });
    }

    if (available.whatsapp && recipient.phone) {
      rows.push({
        ...common,
        channel: 'whatsapp' as const,
        recipient: recipient.phone,
        status: 'pending' as const,
        dedupeKey: `${input.dedupeSeed}:whatsapp:${recipient.phone}`,
      });
    }
  }

  if (rows.length === 0) return 0;
  const result = await db.notificationLog.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/**
 * Hands queued messages to n8n.
 *
 * `queued` and not `sent`: all a 200 from n8n means is that a courier accepted
 * the parcel. The row becomes `delivered` only when n8n calls
 * /api/integrations/notifications/delivery-status back. Marking it sent here
 * would let the app claim a notice was delivered on the strength of its own
 * outbound request, which is exactly the claim that loses an argument later.
 */
export async function dispatchPendingNotifications(limit = 100): Promise<{
  attempted: number;
  queued: number;
  failed: number;
}> {
  const pending = await prisma.notificationLog.findMany({
    where: { status: 'pending', channel: { in: ['email', 'whatsapp'] } },
    orderBy: { requestedAt: 'asc' },
    take: limit,
    include: {
      task: { select: { id: true, title: true, dueDate: true, taskType: true } },
      potentialChange: { select: { pcNumber: true, title: true, noticeDueDate: true } },
    },
  });

  let queued = 0;
  let failed = 0;

  for (const row of pending) {
    const lane = row.channel === 'email' ? 'notify-email' : 'notify-whatsapp';

    try {
      const result = await dispatch(
        lane,
        {
          notification_id: row.id,
          kind: row.kind,
          escalation_level: row.escalationLevel,
          to: row.recipient,
          subject: row.subject,
          body: row.body,
          pc_number: row.potentialChange?.pcNumber ?? null,
          task_title: row.task?.title ?? null,
          // Lane D sets In-Reply-To / References from this when it is present,
          // so the answer lands in the thread the person already has open.
          reply_to_message_id: row.replyToMessageId,
          due_date: row.task?.dueDate ? formatDate(row.task.dueDate) : null,
        },
        { idempotencyKey: row.dedupeKey },
      );

      if (!result.dispatched) {
        // The lane has no URL. Leave it pending rather than failing it: the
        // message is still owed, and it will go the moment the lane is wired.
        await prisma.notificationLog.update({
          where: { id: row.id },
          data: { lastAttemptAt: new Date(), failureReason: 'Channel not configured' },
        });
        continue;
      }

      await prisma.notificationLog.update({
        where: { id: row.id },
        data: { status: 'queued', lastAttemptAt: new Date(), failureReason: null },
      });
      queued++;
    } catch (error) {
      failed++;
      await prisma.notificationLog.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          lastAttemptAt: new Date(),
          failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        },
      });
    }
  }

  return { attempted: pending.length, queued, failed };
}

/* ─── Reading, for the bell ──────────────────────────────────────────────── */

/** Scoped to the caller by user id. A notification is addressed, never shared. */
export async function listMyNotifications(user: AuthenticatedUser, limit = 30) {
  return prisma.notificationLog.findMany({
    where: { userId: user.id, channel: 'in_app' },
    orderBy: { requestedAt: 'desc' },
    take: limit,
    include: {
      potentialChange: { select: { id: true, pcNumber: true, title: true, riskLevel: true } },
      task: { select: { id: true, taskType: true, dueDate: true, status: true } },
    },
  });
}

export async function countMyUnread(user: AuthenticatedUser): Promise<number> {
  return prisma.notificationLog.count({
    where: { userId: user.id, channel: 'in_app', readAt: null },
  });
}

export async function markAllRead(user: AuthenticatedUser): Promise<number> {
  const result = await prisma.notificationLog.updateMany({
    where: { userId: user.id, channel: 'in_app', readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/** The `userId` clause is the access check: you can only read your own. */
export async function markRead(user: AuthenticatedUser, notificationId: string): Promise<void> {
  await prisma.notificationLog.updateMany({
    where: { id: notificationId, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}
