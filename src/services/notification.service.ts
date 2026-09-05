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
  // Tasks, reminders and escalations go by EMAIL, never WhatsApp.
  //
  // Osman's rule, 2026-09-05: a person hears from the system on WhatsApp only
  // while they are talking to it. Being assigned work, and being chased for a
  // decision, is email — it arrives where the rest of the working day already
  // is, it can be forwarded, and it does not turn a personal handset into a
  // task list that pings at eleven at night.
  const allowed = new Set<'email' | 'whatsapp'>(['email']);
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

    if (allowed.has('email') && available.email && recipient.email) {
      rows.push({
        ...common,
        channel: 'email',
        recipient: recipient.email,
        status: 'pending',
        dedupeKey: buildDedupeKey(input.taskId, input.kind, input.on, 'email', recipient.email),
      });
    }

    if (allowed.has('whatsapp') && available.whatsapp && recipient.phone) {
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
    /**
     * Which outside channels this message may use. In-app is always written.
     *
     * ── Why this is an argument and not "everything configured" ────────────
     * It used to fan out to every channel that had a URL, so a reporter who
     * asked a question on WhatsApp got the answer on WhatsApp AND by email —
     * the same words, twice, from a system that was supposed to be replacing
     * his paperwork. Osman's call, 2026-09-05.
     *
     * The rule now: a CONVERSATION stays on the channel it started on, and
     * everything else — being told a colleague reported something, being
     * chased for a decision — is email. Nobody wants a WhatsApp about somebody
     * else's paperwork, and nobody reads an email thread as a conversation.
     */
    channels?: ('email' | 'whatsapp')[];
  },
): Promise<number> {
  const available = configuredChannels();
  // Email, unless the caller says otherwise. The default is the quiet one:
  // a new channel should have to be asked for, never inherited.
  const allowed = new Set(input.channels ?? ['email']);
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

    if (allowed.has('email') && available.email && recipient.email) {
      rows.push({
        ...common,
        channel: 'email' as const,
        recipient: recipient.email,
        status: 'pending' as const,
        dedupeKey: `${input.dedupeSeed}:email:${recipient.email}`,
      });
    }

    if (allowed.has('whatsapp') && available.whatsapp && recipient.phone) {
      rows.push({
        ...common,
        // NO SUBJECT on WhatsApp.
        //
        // The outbound lane sends `subject + "\n\n" + body`, which is right
        // for an email and wrong for a chat: WhatsApp has no subject line, so
        // the header arrived as the first line of every message. Live on
        // 2026-09-04 each reply opened with "Which project? [QNS7]" —
        // including the ones not asking which project — so the exchange
        // looked like it was repeating itself, and the reporter was shown an
        // internal token he had no use for and no way to read as anything but
        // noise. `payloadSummary` keeps the subject for the operator's view.
        subject: null,
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
export async function dispatchPendingNotifications(
  limit = 100,
  /**
   * Restricts the sweep to one logical message, by dedupe-key prefix.
   *
   * Used by `dispatchNow` so answering somebody takes their message and only
   * theirs. A conversational reply that flushed the whole outbound queue would
   * make one person's WhatsApp the trigger for everybody else's overdue chase.
   */
  dedupeSeed?: string,
): Promise<{
  attempted: number;
  queued: number;
  failed: number;
}> {
  const pending = await prisma.notificationLog.findMany({
    where: {
      status: 'pending',
      channel: { in: ['email', 'whatsapp'] },
      ...(dedupeSeed ? { dedupeKey: { startsWith: dedupeSeed } } : {}),
    },
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

      // Only from `pending`, and this condition is load bearing.
      //
      // Lane D's webhook uses `responseMode: lastNode`, so n8n holds this HTTP
      // response open until the whole lane finishes — including the delivery
      // callback, which has already come back through the front door and
      // marked the row `sent` with a real provider message id. An
      // unconditional update then stamps `queued` back over the truth, and the
      // row sits there for ever with a `sent_at`, an `external_message_id`,
      // and a status saying it never went. Observed on the first two messages
      // this system ever delivered.
      //
      // A courier's receipt must never overwrite the recipient's signature.
      await prisma.notificationLog.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'queued', lastAttemptAt: new Date(), failureReason: null },
      });
      queued++;
    } catch (error) {
      failed++;
      // Guarded for the same reason, and a sharper one: the lane can send the
      // message, report it delivered, and THEN fail on something afterwards.
      // Recording that as failed would deny a delivery we hold the provider's
      // id for, and the next sweep would send it a second time.
      await prisma.notificationLog.updateMany({
        where: { id: row.id, status: 'pending' },
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

/**
 * Sends one message NOW, without waiting for the sweep.
 *
 * ── Why a conversation cannot run on a cron ────────────────────────────────
 * "Which project did you mean?" is a question a person is standing there
 * waiting for. Recording it and leaving it to a scheduled dispatcher put a
 * two to thirty minute pause in the middle of an exchange that takes fifteen
 * seconds on either side, and a site engineer who gets no reply assumes the
 * thing is broken and goes back to WhatsApping his PM directly. The system
 * loses by being slow long before it loses by being wrong.
 *
 * So the question goes out on the same request that created it. The sweep
 * stays, and stays unchanged, as the safety net for anything this call could
 * not deliver — a lane that was down, a container that died mid-send. Belt and
 * braces, not belt instead of braces.
 *
 * ── Why it cannot throw ────────────────────────────────────────────────────
 * The caller is a capture route. A message that could not be sent this second
 * is still recorded, still owed, and will go on the next sweep; letting a
 * courier's bad minute bubble up would fail the whole capture and lose the
 * report that provoked the question. So failures are swallowed here and
 * recorded on the row, where they are inspectable.
 */
export async function dispatchNow(dedupeSeed: string): Promise<void> {
  try {
    await dispatchPendingNotifications(10, dedupeSeed);
  } catch {
    // Deliberately silent. The row carries the failure; the sweep retries.
  }
}

/* ─── Reading, for the bell ──────────────────────────────────────────────── */

/** Scoped to the caller by user id. A notification is addressed, never shared. */
/**
 * The bell's contents.
 *
 * Unread only by default. Osman's call, 2026-09-04: a notification that has
 * been read has done its job, and leaving it on the list turns the one place
 * that is supposed to say "these need you" into an archive that says nothing.
 * Read ones are still here — `includeRead` shows them — but they are history,
 * not a list of things owed.
 */
export async function listMyNotifications(
  user: AuthenticatedUser,
  limit = 30,
  includeRead = false,
) {
  return prisma.notificationLog.findMany({
    where: {
      userId: user.id,
      channel: 'in_app',
      ...(includeRead ? {} : { readAt: null }),
    },
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
