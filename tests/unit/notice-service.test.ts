import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NOTICE SENT IS NOT NOTICE ASKED FOR.
 *
 * Every test here defends one sentence: the app may not claim a notice was
 * served on the strength of its own outbound request. Only the courier's
 * report back, carrying a message id, may do that. Get this wrong and the
 * system produces confident, false evidence, which is worse than producing
 * none.
 */

const state = {
  notice: null as Record<string, unknown> | null,
  noticeUpdates: [] as Record<string, unknown>[],
  pcUpdates: [] as Record<string, unknown>[],
  access: true,
};

vi.mock('server-only', () => ({}));
vi.mock('@/services/audit-log.service', () => ({ recordAudit: async () => ({}) }));
vi.mock('@/services/project-access.service', () => ({
  assertProjectAccess: async () => {
    if (!state.access) throw new Error('Forbidden');
  },
}));
vi.mock('@/services/document.service', () => ({
  storeNoticeDocument: async () => ({ id: 'doc-1' }),
}));

const prismaMock = {
  notice: {
    findUnique: async () => state.notice,
    findFirst: async () => state.notice,
    update: async (args: Record<string, unknown>) => {
      state.noticeUpdates.push(args);
      return { ...(state.notice ?? {}), ...(args.data as Record<string, unknown>) };
    },
    updateMany: async () => ({ count: 1 }),
    findMany: async () => [],
  },
  potentialChange: {
    update: async (args: Record<string, unknown>) => {
      state.pcUpdates.push(args);
      return args;
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const { markNoticeDelivered, acknowledgeNotice, updateNoticeDraft } = await import(
  '@/services/notice-document.service'
);

const USER = { id: 'ca-1', fullName: 'Aryia', systemRole: 'company_admin' } as never;
const NOTICE_ID = '22222222-2222-4222-8222-222222222222';

function issuedNotice(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTICE_ID,
    projectId: 'proj-1',
    potentialChangeId: 'pc-1',
    status: 'issued',
    version: 1,
    subject: 'Notice of a potential variation',
    body: 'x'.repeat(80),
    ...overrides,
  };
}

describe('what makes a notice served', () => {
  beforeEach(() => {
    state.notice = issuedNotice();
    state.noticeUpdates = [];
    state.pcUpdates = [];
    state.access = true;
  });

  it('marks it served, with the message id as the proof, when the courier reports success', async () => {
    await markNoticeDelivered({
      notificationId: 'msg-1',
      externalMessageId: 'gmail-abc-123',
      succeeded: true,
    });

    const update = state.noticeUpdates.at(0)?.data as Record<string, unknown>;
    expect(update.status).toBe('sent');
    expect(update.externalMessageId).toBe('gmail-abc-123');
    expect(update.sentAt).toBeInstanceOf(Date);

    // And the change agrees, so the register and the dashboard cannot disagree.
    expect((state.pcUpdates.at(0)?.data as Record<string, unknown>).noticeStatus).toBe('sent');
  });

  it('leaves it issued when the send FAILED', async () => {
    await markNoticeDelivered({
      notificationId: 'msg-1',
      externalMessageId: null,
      succeeded: false,
    });

    expect(state.noticeUpdates).toHaveLength(0);
    expect(state.pcUpdates).toHaveLength(0);
  });

  it('does nothing when the callback belongs to an ordinary reminder', async () => {
    state.notice = null;

    await markNoticeDelivered({
      notificationId: 'msg-for-a-task',
      externalMessageId: 'gmail-xyz',
      succeeded: true,
    });

    expect(state.noticeUpdates).toHaveLength(0);
  });

  it('will not re-serve a notice that is already served', async () => {
    state.notice = issuedNotice({ status: 'sent' });

    await markNoticeDelivered({
      notificationId: 'msg-1',
      externalMessageId: 'gmail-second-callback',
      succeeded: true,
    });

    expect(state.noticeUpdates).toHaveLength(0);
  });
});

describe('the wording is fixed at approval', () => {
  beforeEach(() => {
    state.notice = issuedNotice({ status: 'draft' });
    state.noticeUpdates = [];
    state.pcUpdates = [];
    state.access = true;
  });

  it('lets an authorised person edit a draft', async () => {
    await updateNoticeDraft(USER, {
      noticeId: NOTICE_ID,
      subject: 'Notice of a potential variation - reception wall',
      body: 'y'.repeat(80),
    });

    expect((state.noticeUpdates.at(0)?.data as Record<string, unknown>).body).toBe('y'.repeat(80));
  });

  it('refuses an edit once both seats have approved it', async () => {
    state.notice = issuedNotice({ status: 'issued' });

    await expect(
      updateNoticeDraft(USER, {
        noticeId: NOTICE_ID,
        subject: 'Quietly reworded after approval',
        body: 'z'.repeat(80),
      }),
    ).rejects.toThrow(/already been approved/);

    expect(state.noticeUpdates).toHaveLength(0);
  });

  it('refuses anyone without the authority, before reading the wording', async () => {
    state.access = false;

    await expect(
      updateNoticeDraft(USER, {
        noticeId: NOTICE_ID,
        subject: 'A subject long enough to pass',
        body: 'q'.repeat(80),
      }),
    ).rejects.toThrow();
  });
});

describe('acknowledgement is a recorded human act', () => {
  beforeEach(() => {
    state.notice = issuedNotice({ status: 'sent' });
    state.noticeUpdates = [];
    state.pcUpdates = [];
    state.access = true;
  });

  it('records the date and the reference the client used', async () => {
    await acknowledgeNotice(USER, {
      noticeId: NOTICE_ID,
      acknowledgedOn: new Date('2026-08-20T00:00:00Z'),
      reference: 'EMR-LTR-0112',
    });

    const update = state.noticeUpdates.at(0)?.data as Record<string, unknown>;
    expect(update.status).toBe('acknowledged');
    expect(update.acknowledgementReference).toBe('EMR-LTR-0112');
    expect(update.acknowledgedByUserId).toBe('ca-1');
  });

  it('refuses to acknowledge a notice that was never issued', async () => {
    state.notice = issuedNotice({ status: 'draft' });

    await expect(
      acknowledgeNotice(USER, {
        noticeId: NOTICE_ID,
        acknowledgedOn: new Date('2026-08-20T00:00:00Z'),
      }),
    ).rejects.toThrow(/not been issued/);
  });

  it('refuses a date in the future', async () => {
    await expect(
      acknowledgeNotice(USER, {
        noticeId: NOTICE_ID,
        acknowledgedOn: new Date(Date.now() + 3 * 86_400_000),
      }),
    ).rejects.toThrow(/future/);
  });

  it('accepts today, recorded from a UAE morning', async () => {
    // A date input sends midnight UTC. At 09:00 in Dubai that instant is two
    // hours AHEAD of the container clock, and comparing against `now` refused
    // every acknowledgement recorded before lunch.
    const todayMidnightUtc = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ),
    );

    await expect(
      acknowledgeNotice(USER, { noticeId: NOTICE_ID, acknowledgedOn: todayMidnightUtc }),
    ).resolves.toBeTruthy();
  });
});
