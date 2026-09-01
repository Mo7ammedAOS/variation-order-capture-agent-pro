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
  senders: null as Record<string, unknown>[] | null,
};

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: async () => state.user,
      findMany: async () => state.senders ?? (state.user ? [state.user] : []),
    },
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
    kind: 'choose',
    token: 'K4T9',
    sourceMessageId: null,
    sourceSubject: null,
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
    state.senders = null;
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

  it('ignores a reply from a number several people share', async () => {
    // We cannot know whose question a "2" settles, and settling the wrong one
    // files a change against a project nobody chose.
    state.senders = [
      { id: 'ahmed', fullName: 'Ahmed' },
      { id: 'hassan', fullName: 'Hassan' },
    ];
    expect(await tryAnswerQuestion(attempt('2'))).toBeNull();
    expect(state.claimed).toHaveLength(0);
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

/**
 * "This is DXB-001, correct?"
 *
 * When the message itself names a project, the reporter should not be made to
 * read a list he already answered. He is shown what we read and why, and one
 * word settles it.
 *
 * `candidateProjectIds[0]` is the proposal, by construction. Everything below
 * depends on that, which is why it is stated in the service header too.
 */
describe('confirming a project we read out of the message', () => {
  beforeEach(() => {
    state.user = { id: 'ahmed', fullName: 'Ahmed' };
    state.questions = [question({ kind: 'confirm', candidateProjectIds: ['proj-b', 'proj-a', 'proj-c'] })];
    state.projects = [
      { id: 'proj-a', projectCode: 'DXB-001' },
      { id: 'proj-b', projectCode: 'DXB-002' },
      { id: 'proj-c', projectCode: 'DXB-004' },
    ];
    state.claimed = [];
    state.claimCount = 1;
    state.senders = null;
  });

  it('takes a yes as the proposal', async () => {
    const reply = await tryAnswerQuestion(attempt('yes'));
    expect(reply?.outcome).toBe('answered');
    expect(reply?.projectId).toBe('proj-b');
  });

  it('takes agreement written the way people actually write it', async () => {
    for (const yes of ['YES', 'Yes please', 'confirmed', 'thats right', 'K4T9 yes']) {
      state.claimed = [];
      const reply = await tryAnswerQuestion(attempt(yes));
      expect(reply?.projectId, yes).toBe('proj-b');
    }
  });

  it('takes a no as a rejection, and settles nothing', async () => {
    const reply = await tryAnswerQuestion(attempt('no'));
    expect(reply?.outcome).toBe('rejected');
    expect(reply?.projectId).toBeNull();
    // Cancelled, not answered — the caller re-asks on this same row, so a
    // second "no" from the other channel finds nothing open.
    expect(state.claimed[0]?.data.status).toBe('cancelled');
  });

  it('takes the right code directly, skipping a round trip', async () => {
    const reply = await tryAnswerQuestion(attempt('no, DXB-004'));
    expect(reply?.outcome).toBe('answered');
    expect(reply?.projectId).toBe('proj-c');
  });

  it('ignores a bare number, because no numbered list was ever sent', async () => {
    expect(await tryAnswerQuestion(attempt('2'))).toBeNull();
  });

  it('does NOT read a real report as agreement', async () => {
    expect(await tryAnswerQuestion(attempt('yes the client also wants 3 more sockets'))).toBeNull();
    expect(state.claimed).toHaveLength(0);
  });

  it('does not answer itself out of the quoted text of its own question', async () => {
    // The failure this prevents: a one word reply on an email client that
    // quotes the original. Our question lists DXB-004 as an alternative, so
    // reading past the quote marker would file it against DXB-004 — the exact
    // wrong-project outcome the confirmation exists to stop.
    const quoted = [
      'Yes',
      '',
      'On 1 Sep 2026 at 09:14, VO Capture wrote:',
      '> This looks like DXB-002. If not, reply with the right code:',
      '>   K4T9 DXB-004 - Corniche Retail',
    ].join('\n');

    const reply = await tryAnswerQuestion(attempt(quoted));
    expect(reply?.projectId).toBe('proj-b');
  });
});
