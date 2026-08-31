import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Which project did you mean?"
 *
 * Ahmed is on three live projects and writes "client wants the wall moved".
 * The system used to park that for a coordinator — who knows LESS than Ahmed
 * did. Now it asks Ahmed, on email and WhatsApp, and waits.
 *
 * The dangerous failure is not failing to understand an answer. It is reading a
 * REPORT as an answer: "moving 2 sockets on level 2" must never be taken as
 * "project 2", because doing so throws the report away silently.
 */

const state = {
  user: null as Record<string, unknown> | null,
  questions: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
  claimed: [] as { id: string; data: Record<string, unknown> }[],
  claimCount: 1,
};

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: async () => state.user },
    captureQuestion: {
      findMany: async () => state.questions,
      updateMany: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        state.claimed.push({ id: args.where.id, data: args.data });
        return { count: state.claimCount };
      },
      create: async () => ({}),
    },
    project: { findMany: async () => state.projects },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn({ captureQuestion: { create: async () => ({}) } }),
  },
}));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async (ids: string[]) => ids.map((id) => ({ userId: id, email: 'a@b.c', phone: '+9715' })),
  recordDirectNotifications: async () => 1,
}));

const { tryAnswerQuestion } = await import('@/services/capture-question.service');

function question(over: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    integrationEventId: 'evt-1',
    userId: 'ahmed',
    token: 'K4T9',
    candidateProjectIds: ['proj-a', 'proj-b', 'proj-c'],
    askedText: 'Client wants the reception wall moved 400mm',
    status: 'open',
    askedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    ...over,
  };
}

const attempt = (text: string) => ({ senderIdentifier: '+971500000005', channel: 'whatsapp' as const, text });

describe('answering "which project did you mean?"', () => {
  beforeEach(() => {
    state.user = { id: 'ahmed', fullName: 'Ahmed' };
    state.questions = [question()];
    state.projects = [
      { id: 'proj-a', projectCode: 'DXB-001' },
      { id: 'proj-b', projectCode: 'DXB-002' },
      { id: 'proj-c', projectCode: 'DXB-004' },
    ];
    state.claimed = [];
    state.claimCount = 1;
  });

  it('reads a bare number as the answer, in the order it was asked', async () => {
    const answered = await tryAnswerQuestion(attempt('2'));
    expect(answered?.projectId).toBe('proj-b');
  });

  it('reads a project code, which beats a number', async () => {
    const answered = await tryAnswerQuestion(attempt('K4T9 DXB-004'));
    expect(answered?.projectId).toBe('proj-c');
  });

  it('carries the ORIGINAL report forward, not the word "2"', async () => {
    const answered = await tryAnswerQuestion(attempt('2'));
    expect(answered?.originalText).toContain('reception wall');
  });

  it('does NOT read a real report as an answer', async () => {
    // The failure that would silently destroy a change.
    expect(await tryAnswerQuestion(attempt('moving 2 sockets on level 2'))).toBeNull();
    expect(await tryAnswerQuestion(attempt('Client wants 3 more downlights'))).toBeNull();
    expect(state.claimed).toHaveLength(0);
  });

  it('refuses a number outside the list', async () => {
    expect(await tryAnswerQuestion(attempt('9'))).toBeNull();
  });

  it('will not guess between TWO outstanding questions without a token', async () => {
    state.questions = [question(), question({ id: 'q2', token: 'M7PQ' })];
    expect(await tryAnswerQuestion(attempt('2'))).toBeNull();
  });

  it('uses the token to pick between two outstanding questions', async () => {
    state.questions = [question(), question({ id: 'q2', token: 'M7PQ', candidateProjectIds: ['proj-c', 'proj-a'] })];
    const answered = await tryAnswerQuestion(attempt('M7PQ 1'));
    expect(answered?.projectId).toBe('proj-c');
    expect(state.claimed[0]?.id).toBe('q2');
  });

  it('ignores a stranger', async () => {
    state.user = null;
    expect(await tryAnswerQuestion(attempt('2'))).toBeNull();
  });

  it('files nothing twice when the email and the WhatsApp are both answered', async () => {
    // The claim is atomic: the second reply loses the race and returns null,
    // rather than creating a second Potential Change for the same message.
    state.claimCount = 0;
    expect(await tryAnswerQuestion(attempt('2'))).toBeNull();
  });

  it('marks the question answered, with the project chosen', async () => {
    await tryAnswerQuestion(attempt('3'));
    expect(state.claimed[0]?.data.status).toBe('answered');
    expect(state.claimed[0]?.data.chosenProjectId).toBe('proj-c');
  });
});
