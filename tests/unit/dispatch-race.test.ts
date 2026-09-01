import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The courier's receipt must not overwrite the recipient's signature.
 *
 * Lane D's webhook responds with its LAST node, so n8n holds the app's request
 * open until the whole lane finishes — and the lane's final act is calling the
 * app back to say the message was delivered. That callback therefore lands
 * BEFORE the dispatcher gets its own 200 back.
 *
 * The dispatcher then wrote `queued` unconditionally, over a row that already
 * said `sent` and carried the provider's message id. Both of the first two
 * messages this system ever delivered ended up looking undelivered: a `sent_at`
 * of 15:20:51, an `external_message_id`, and a status of `queued`.
 *
 * That is not cosmetic. For a notice, `sent` is the proof of service, and the
 * bottleneck sweep chases `notice_drafted_not_sent` — so a delivered notice
 * would be chased for ever, and eventually served twice.
 */

const state = {
  pending: [] as Record<string, unknown>[],
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  dispatchThrows: false,
};

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ N8N_NOTIFY_EMAIL_URL: 'https://n8n.example/x', N8N_NOTIFY_WHATSAPP_URL: '' }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationLog: {
      findMany: async () => state.pending,
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push({ where: args.where, data: args.data });
        return {};
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push({ where: args.where, data: args.data });
        return { count: 1 };
      },
    },
  },
}));
vi.mock('@/integrations/n8n/client', () => ({
  dispatch: async () => {
    if (state.dispatchThrows) throw new Error('n8n lane notify-email returned 500');
    return { dispatched: true, status: 200 };
  },
}));

const { dispatchPendingNotifications } = await import('@/services/notification.service');

const row = () => ({
  id: 'n1',
  channel: 'email',
  kind: 'capture_question',
  escalationLevel: 'none',
  recipient: 'ahmed@abc.ae',
  subject: 'Which project?',
  body: 'You reported…',
  dedupeKey: 'question:BS6R:email:ahmed@abc.ae',
  replyToMessageId: 'gmail:1a05d5ce4f00e5c5',
  task: null,
  potentialChange: null,
});

describe('handing a queued message to the courier', () => {
  beforeEach(() => {
    state.pending = [row()];
    state.updates = [];
    state.dispatchThrows = false;
  });

  it('only moves a row that is STILL pending', async () => {
    await dispatchPendingNotifications();
    const write = state.updates.find((u) => u.data.status === 'queued');
    expect(write).toBeDefined();
    // The guard. Without it the callback's `sent` is silently overwritten.
    expect(write?.where.status).toBe('pending');
    expect(write?.where.id).toBe('n1');
  });

  it('will not record a failure over a delivery it already knows about', async () => {
    // The lane can send, report delivered, and then fail afterwards. Marking
    // that failed denies a delivery we hold the provider's id for — and the
    // next sweep sends the same message a second time.
    state.dispatchThrows = true;
    await dispatchPendingNotifications();
    const write = state.updates.find((u) => u.data.status === 'failed');
    expect(write?.where.status).toBe('pending');
  });

  it('passes the message being answered through to the lane', async () => {
    // Lane D replies on that thread instead of sending a fresh mail.
    const result = await dispatchPendingNotifications();
    expect(result.queued).toBe(1);
    expect(result.failed).toBe(0);
  });
});
