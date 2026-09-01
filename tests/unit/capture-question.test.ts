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
  changes: [] as Record<string, unknown>[],
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
    potentialChange: { findMany: async () => state.changes },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn({ captureQuestion: { create: async () => ({}) } }),
  },
}));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async (ids: string[]) => ids.map((id) => ({ userId: id, email: 'a@b.c', phone: '+9715' })),
  recordDirectNotifications: async () => 1,
  dispatchNow: async () => undefined,
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
    candidateChangeIds: [],
    projectId: null,
    potentialChangeId: null,
    detailFields: [],
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
    state.changes = [];
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

  it('answers the MOST RECENT question when no token is given', async () => {
    // How a conversation works: you answer the last thing you were asked.
    // Refusing here was safe and useless — somebody with three parked reports
    // could not answer any of them without copying a code out of an old
    // message, which is exactly the friction that makes people give up and
    // WhatsApp their PM directly instead.
    //
    // What makes it safe is downstream: the acknowledgement quotes the report
    // it filed, so answering the wrong one is visible within seconds.
    state.questions = [
      question({ id: 'q2', token: 'M7PQ', candidateProjectIds: ['proj-c', 'proj-a'] }),
      question(),
    ];
    const reply = await tryAnswerQuestion(attempt('2'));
    expect(reply?.projectId).toBe('proj-a');
    expect(state.claimed[0]?.id).toBe('q2');
  });

  it('ignores a bare number long after the conversation ended', async () => {
    // A "2" arriving a day later is not a reply. It is far likelier to be a
    // new report that happens to start with a number, and reading it as an
    // answer would throw that report away.
    state.questions = [question({ askedAt: new Date(Date.now() - 20 * 3600 * 1000) })];
    expect(await tryAnswerQuestion(attempt('2'))).toBeNull();
  });

  it('still answers an old question when the token names it', async () => {
    state.questions = [question({ askedAt: new Date(Date.now() - 20 * 3600 * 1000) })];
    expect((await tryAnswerQuestion(attempt('K4T9 2')))?.projectId).toBe('proj-b');
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
    state.changes = [];
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

/**
 * Answering it the way a person on a phone actually types.
 *
 * The strictness here is asymmetric on purpose. Missing an answer parks a
 * conversation the reporter thought he had finished — annoying, and he will
 * tell you. Reading a REPORT as an answer files it against a project nobody
 * chose and throws the report away — silent, and nobody ever tells you.
 */
describe('reading a loosely typed answer', () => {
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
    state.changes = [];
  });

  it('takes a project code however it was typed', async () => {
    for (const written of ['DXB-004', 'dxb004', 'dxb 004', 'DXB - 004', 'K4T9 dxb004']) {
      state.claimed = [];
      const reply = await tryAnswerQuestion(attempt(written));
      expect(reply?.projectId, written).toBe('proj-c');
    }
  });

  it('takes a number with the small words people put in front of it', async () => {
    for (const written of ['2', '#2', 'no 2', 'project 2', 'its 2', 'number 2']) {
      state.claimed = [];
      const reply = await tryAnswerQuestion(attempt(written));
      expect(reply?.projectId, written).toBe('proj-b');
    }
  });

  it('still refuses a real report that happens to contain a number', async () => {
    for (const report of [
      'moving 2 sockets on level 2',
      'client wants 3 more downlights',
      'the grid on 2 needs changing before Thursday',
    ]) {
      expect(await tryAnswerQuestion(attempt(report)), report).toBeNull();
    }
    expect(state.claimed).toHaveLength(0);
  });

  it('refuses two numbers, which is a sentence and not an answer', async () => {
    expect(await tryAnswerQuestion(attempt('2 3'))).toBeNull();
  });

  it('lets the reporter cancel, and files nothing', async () => {
    const reply = await tryAnswerQuestion(attempt('cancel'));
    expect(reply?.outcome).toBe('cancelled');
    expect(reply?.projectId).toBeNull();
    expect(state.claimed[0]?.data.status).toBe('cancelled');
  });

  it('understands the other ways people withdraw something', async () => {
    for (const written of ['ignore', 'forget it', 'nevermind', 'disregard', 'my mistake']) {
      state.claimed = [];
      const reply = await tryAnswerQuestion(attempt(written));
      expect(reply?.outcome, written).toBe('cancelled');
    }
  });

  it('does not read a code as a cancellation', async () => {
    // "cancel DXB-004" names a project. Naming one is not withdrawing it.
    const reply = await tryAnswerQuestion(attempt('cancel DXB-004'));
    expect(reply?.outcome).toBe('answered');
    expect(reply?.projectId).toBe('proj-c');
  });
});

/**
 * The three questions that are not about a project.
 *
 * ATTACH and DESCRIBE happen when files arrive with no words. DETAIL happens
 * after a change is already filed, and is by far the most dangerous of the
 * five: it is open while the reporter is still working, so every real report
 * he sends in the next few hours is offered to it first. It has to give those
 * back.
 */
describe('"are these files a new change, or one of these?"', () => {
  const attachQuestion = (over: Record<string, unknown> = {}) =>
    question({
      kind: 'attach',
      projectId: 'proj-a',
      candidateProjectIds: ['proj-a'],
      candidateChangeIds: ['pc-1', 'pc-2'],
      askedText: '[media only]',
      ...over,
    });

  beforeEach(() => {
    state.user = { id: 'ahmed', fullName: 'Ahmed' };
    state.questions = [attachQuestion()];
    state.projects = [{ id: 'proj-a', projectCode: 'DXB-001' }];
    state.changes = [
      { id: 'pc-1', pcNumber: 'PC-DXB-001-0001' },
      { id: 'pc-2', pcNumber: 'PC-DXB-001-0002' },
    ];
    state.claimed = [];
    state.claimCount = 1;
    state.senders = null;
  });

  it('reads the list position', async () => {
    const answered = await tryAnswerQuestion(attempt('2'));
    expect(answered?.outcome).toBe('attach_existing');
    expect(answered?.potentialChangeId).toBe('pc-2');
  });

  it('reads the reference however it is written', async () => {
    const answered = await tryAnswerQuestion(attempt('pc dxb001 0002'));
    expect(answered?.potentialChangeId).toBe('pc-2');
  });

  it('reads "new one"', async () => {
    const answered = await tryAnswerQuestion(attempt('new one'));
    expect(answered?.outcome).toBe('attach_new');
    expect(answered?.projectId).toBe('proj-a');
  });

  it('takes prose as the description of what the files show', async () => {
    // Sending the photos and then saying what they are of is what a person
    // does. Reading that as a separate report would file a change with no
    // evidence and leave the evidence attached to nothing.
    const answered = await tryAnswerQuestion(attempt('the ceiling grid at reception is 300mm low'));
    expect(answered?.outcome).toBe('described');
    expect(answered?.replyText).toContain('300mm low');
  });

  it('still lets them withdraw it', async () => {
    const answered = await tryAnswerQuestion(attempt('forget it'));
    expect(answered?.outcome).toBe('cancelled');
  });
});

describe('the follow-up after a change is filed', () => {
  const detailQuestion = (over: Record<string, unknown> = {}) =>
    question({
      kind: 'detail',
      projectId: 'proj-a',
      candidateProjectIds: ['proj-a'],
      potentialChangeId: 'pc-7',
      detailFields: ['event_date'],
      askedText: 'Reception ceiling grid lowered',
      ...over,
    });

  beforeEach(() => {
    state.user = { id: 'ahmed', fullName: 'Ahmed' };
    state.questions = [detailQuestion()];
    state.projects = [{ id: 'proj-a', projectCode: 'DXB-001' }];
    state.changes = [];
    state.claimed = [];
    state.claimCount = 1;
    state.senders = null;
  });

  it('reads a short answer that carries a fact', async () => {
    const answered = await tryAnswerQuestion(attempt('yesterday'));
    expect(answered?.outcome).toBe('detailed');
    expect(answered?.potentialChangeId).toBe('pc-7');
  });

  it('reads a decline', async () => {
    expect((await tryAnswerQuestion(attempt('skip')))?.outcome).toBe('declined');
    expect((await tryAnswerQuestion(attempt('thanks')))?.outcome).toBe('declined');
  });

  it('HANDS BACK a real report rather than swallowing it as an answer', async () => {
    // The one failure worth being pedantic about. This question is open while
    // the reporter is still on site, so the next thing he sends is far more
    // likely to be the next change than a late answer about the last one.
    const answered = await tryAnswerQuestion(
      attempt('client has now asked for the marble in the lift lobby to be swapped for porcelain, they want a price'),
    );
    expect(answered).toBeNull();
  });

  it('hands back a short reply that carries no fact at all', async () => {
    expect(await tryAnswerQuestion(attempt('wall moved again'))).toBeNull();
  });

  it('falls through to an older question the reply actually fits', async () => {
    // A follow-up is open AND a project question is open. "2" means nothing to
    // the follow-up and everything to the list, so it belongs to the list.
    state.questions = [detailQuestion({ id: 'q-new' }), question({ id: 'q-old' })];
    const answered = await tryAnswerQuestion(attempt('2'));
    expect(answered?.questionId).toBe('q-old');
    expect(answered?.projectId).toBe('proj-b');
  });
});
