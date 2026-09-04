import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which project did this message land on, and why.
 *
 * The whole system turns on this one decision. Getting it wrong is not a bug
 * that shows up in a log — a Potential Change on the wrong job looks handled,
 * so nobody opens it again, and the entitlement dies of neglect. So the tests
 * below are mostly about what the system REFUSES to do.
 *
 * The one thing that changed: the system now reads the message. When the text
 * names a project code or the client, it proposes that job and asks for one
 * word back, instead of showing the reporter a list he has already answered.
 * It still writes nothing until he replies.
 */

const state = {
  user: null as Record<string, unknown> | null,
  memberships: [] as Record<string, unknown>[],
  allProjects: [] as Record<string, unknown>[],
  asked: [] as Record<string, unknown>[],
  confirmed: [] as Record<string, unknown>[],
  created: [] as Record<string, unknown>[],
  evidence: [] as Record<string, unknown>[],
  answer: null as Record<string, unknown> | null,
  eventPayload: null as unknown,
  senders: null as Record<string, unknown>[] | null,
  acknowledged: [] as Record<string, unknown>[],
  askedWhichChange: [] as Record<string, unknown>[],
  askedToDescribe: [] as Record<string, unknown>[],
  askedForDetail: [] as Record<string, unknown>[],
  readBack: [] as Record<string, unknown>[],
  /** Off by default: most tests are about routing, not the confirmation step. */
  confirmationEnabled: false,
  detailFields: [] as string[],
  recentExchange: false,
  updated: [] as Record<string, unknown>[],
  change: null as Record<string, unknown> | null,
};

vi.mock('server-only', () => ({}));

const tx = {
  project: {
    findUnique: async () => ({
      id: 'proj-a',
      projectCode: 'DXB-001',
      contractRules: { noticePeriodDays: 28, pmScopeReviewDueDays: 3 },
    }),
  },
  $queryRaw: async () => [{ pc_sequence: 7 }],
  potentialChange: {
    create: async (args: { data: Record<string, unknown> }) => {
      state.created.push(args.data);
      return { id: 'pc-1', ...args.data };
    },
  },
  task: { create: async () => ({ id: 'task-1' }) },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: async () => state.user,
      // `resolveSender` reads MANY and refuses to pick when several people
      // share the identifier. `state.senders` overrides for that case.
      findMany: async () =>
        state.senders ?? (state.user ? [state.user] : []),
    },
    projectMember: { findMany: async () => state.memberships },
    project: {
      findMany: async (args: { where?: { id?: { notIn?: string[] } } }) => {
        const excluded = args?.where?.id?.notIn ?? [];
        return state.allProjects.filter((p) => !excluded.includes(p.id as string));
      },
      // Read when the capture is summarised back to the reporter.
      findUnique: async () => ({
        projectCode: 'DXB-001',
        projectName: 'Marina Heights Lobby',
      }),
    },
    integrationEvent: { findUnique: async () => ({ payloadJson: state.eventPayload }) },
    potentialChange: {
      findUnique: async () => state.change,
      update: async (args: { data: Record<string, unknown> }) => {
        state.updated.push(args.data);
        return { id: 'pc-1', ...args.data };
      },
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock('@/services/capture-question.service', () => ({
  askWhichProject: async (input: Record<string, unknown>) => {
    state.asked.push(input);
    return { token: 'ASK1' };
  },
  confirmProject: async (input: Record<string, unknown>) => {
    state.confirmed.push(input);
    return { token: 'CNF1' };
  },
  tryAnswerQuestion: async () => state.answer,
  acknowledgeCapture: async (input: Record<string, unknown>) => {
    state.acknowledged.push(input);
  },
  askWhichChange: async (input: Record<string, unknown>) => {
    state.askedWhichChange.push(input);
    return { token: 'ATT1', offered: 2 };
  },
  askForDescription: async (input: Record<string, unknown>) => {
    state.askedToDescribe.push(input);
    return { token: 'DSC1' };
  },
  askForDetail: async (input: Record<string, unknown>) => {
    state.askedForDetail.push(input);
    return { token: 'DTL1' };
  },
  // Returning null is "the read-back was not sent", which the service reads as
  // permission to file. Most tests here predate the confirmation step and are
  // about ROUTING — which project, which change, which attachments — so they
  // keep filing straight through, and the tests that care switch it on.
  askToConfirmCapture: async (input: Record<string, unknown>) => {
    state.readBack.push(input);
    return state.confirmationEnabled ? { token: 'SUM1' } : null;
  },
  // The real one is pure, and these tests care about WHETHER a follow-up was
  // asked for, not which fields it named.
  plannedDetailFields: () => state.detailFields,
  hadRecentExchange: async () => state.recentExchange,
}));

vi.mock('@/services/document.service', () => ({
  storeCaptureEvidence: async (input: Record<string, unknown>) => {
    state.evidence.push(input);
    return { stored: (input.attachments as unknown[]).length, skipped: [] };
  },
}));

vi.mock('@/integrations/claude', () => ({
  extractWithFallback: async () => ({
    envelope: {
      extractedData: {
        suggestedTitle: 'Reception wall moved 400mm',
        location: 'Reception',
        affectedTrade: ['joinery'],
        possibleTimeImpact: false,
      },
      confidenceScore: 0.6,
      missingInformation: [],
      suggestedNextAction: 'assess',
    },
    provider: 'mock',
    degraded: false,
  }),
}));

vi.mock('@/services/audit-log.service', () => ({ recordAudit: async () => ({}) }));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async () => [],
  recordTaskNotifications: async () => 0,
  recordDirectNotifications: async () => 0,
  dispatchNow: async () => undefined,
  dispatchPendingNotifications: async () => ({ queued: 0, sent: 0, failed: 0 }),
}));
vi.mock('@/services/permissions.service', () => ({
  pickResponsibleMember: async () => 'cm-1',
  listMembersWithCapability: async () => [],
}));
vi.mock('@/services/integration.service', () => ({
  closeEvent: async () => undefined,
  listUnprocessedEvents: async () => [],
}));

const { captureFromChannel } = await import('@/services/capture.service');

const PROJECTS = [
  { id: 'proj-a', projectCode: 'DXB-001', projectName: 'Marina Heights Lobby', clientName: 'Emaar Properties' },
  { id: 'proj-b', projectCode: 'DXB-002', projectName: 'Corniche Retail', clientName: 'Aldar Properties' },
  { id: 'proj-c', projectCode: 'AUH-014', projectName: 'Yas Mall Unit 12', clientName: 'Miral Asset Management' },
  { id: 'proj-z', projectCode: 'SHJ-900', projectName: 'Somebody Elses Job', clientName: 'Arada Developments' },
];

const memberOf = (...ids: string[]) =>
  PROJECTS.filter((p) => ids.includes(p.id)).map((p) => ({
    projectId: p.id,
    project: { projectCode: p.projectCode, projectName: p.projectName, clientName: p.clientName },
  }));

const capture = (text: string, over: Record<string, unknown> = {}) =>
  captureFromChannel(
    {
      channel: 'email',
      senderIdentifier: 'ahmed@abc.ae',
      senderName: 'Ahmed',
      text,
      externalMessageId: 'msg-1',
      ...over,
    },
    'evt-1',
  );

describe('choosing the project a captured message belongs to', () => {
  beforeEach(() => {
    state.user = { id: 'ahmed', fullName: 'Ahmed' };
    state.memberships = memberOf('proj-a', 'proj-b', 'proj-c');
    state.allProjects = PROJECTS;
    state.asked = [];
    state.confirmed = [];
    state.created = [];
    state.evidence = [];
    state.answer = null;
    state.eventPayload = null;
    state.senders = null;
    state.acknowledged = [];
    state.askedWhichChange = [];
    state.askedToDescribe = [];
    state.askedForDetail = [];
    state.readBack = [];
    state.confirmationEnabled = false;
    state.detailFields = [];
    state.recentExchange = false;
  });

  it('files straight away when the sender is on exactly one live project', async () => {
    state.memberships = memberOf('proj-a');
    const outcome = await capture('client wants the wall moved');
    expect(outcome.kind).toBe('created');
    expect(state.asked).toHaveLength(0);
    expect(state.confirmed).toHaveLength(0);
  });

  it('proposes the project when the text names its code, and files nothing yet', async () => {
    const outcome = await capture('DXB-002 reception wall moved 400mm');
    expect(outcome.kind).toBe('needs_triage');
    expect(state.created).toHaveLength(0);
    expect(state.confirmed[0]?.proposedProjectId).toBe('proj-b');
  });

  it('proposes the project when the text names only the client', async () => {
    await capture('Miral asked for another door in the back of house');
    expect(state.confirmed[0]?.proposedProjectId).toBe('proj-c');
  });

  it('carries their other live jobs into the confirmation, so a "no" resolves in one reply', async () => {
    await capture('DXB-002 extra sockets');
    expect(state.confirmed[0]?.otherProjectIds).toEqual(['proj-a', 'proj-b', 'proj-c']);
  });

  it('asks for the full list when the message names nothing', async () => {
    await capture('client wants the reception wall moved 400mm');
    expect(state.confirmed).toHaveLength(0);
    expect(state.asked[0]?.candidateProjectIds).toEqual(['proj-a', 'proj-b', 'proj-c']);
  });

  it('narrows the list to the jobs the text could mean when it names two', async () => {
    await capture('Emaar and Aldar both want this detail changed');
    expect(state.asked[0]?.candidateProjectIds).toEqual(['proj-a', 'proj-b']);
  });

  it('refuses a project the sender is not on, and says so', async () => {
    // The dangerous case. Without this he is shown HIS OWN three projects,
    // picks one, and the change lands on a job the message was never about.
    const outcome = await capture('SHJ-900 the ceiling grid is wrong');
    expect(outcome.kind).toBe('needs_triage');
    if (outcome.kind !== 'needs_triage') throw new Error('unreachable');
    expect(outcome.reason).toContain('SHJ-900');
    expect(outcome.reason).toContain('not assigned');
    expect(state.confirmed).toHaveLength(0);
    expect(state.asked).toHaveLength(0);
    expect(state.created).toHaveLength(0);
  });

  it('treats a structured project_code hint exactly like one written in the text', async () => {
    await capture('extra sockets needed', { projectCodeHint: 'DXB-002' });
    expect(state.confirmed[0]?.proposedProjectId).toBe('proj-b');
  });

  it('REFUSES to pick when several people share the identifier', async () => {
    // Every user on this deployment shares one phone number. Picking the first
    // row would put a colleague's name on a claim they know nothing about, in
    // the audit trail, silently. Park it and say why.
    state.senders = [
      { id: 'ahmed', fullName: 'Ahmed' },
      { id: 'hassan', fullName: 'Hassan' },
    ];

    const outcome = await capture('DXB-002 the wall came down', {
      channel: 'whatsapp',
      senderIdentifier: '+971565951887',
    });

    expect(outcome.kind).toBe('needs_triage');
    if (outcome.kind !== 'needs_triage') throw new Error('unreachable');
    expect(outcome.reason).toContain('more than one active user');
    expect(outcome.reason).toContain('Ahmed');
    expect(state.created).toHaveLength(0);
    expect(state.confirmed).toHaveLength(0);
    expect(state.asked).toHaveLength(0);
  });
});

describe('evidence that arrived with the message', () => {
  beforeEach(() => {
    state.user = { id: 'ahmed', fullName: 'Ahmed' };
    state.memberships = memberOf('proj-a');
    state.allProjects = PROJECTS;
    state.asked = [];
    state.confirmed = [];
    state.created = [];
    state.evidence = [];
    state.answer = null;
    state.eventPayload = null;
    state.senders = null;
    state.acknowledged = [];
  });

  it('files the attachments against the change it created', async () => {
    await capture('wall moved, photo attached', {
      attachments: [
        { externalId: 'att-1', fileName: 'wall.jpg', mimeType: 'image/jpeg', contentBase64: 'AAA=' },
      ],
    });
    expect(state.evidence[0]?.potentialChangeId).toBe('pc-1');
    expect(state.evidence[0]?.projectId).toBe('proj-a');
    expect(state.evidence[0]?.channel).toBe('email');
  });

  it('does not touch storage when nothing was attached', async () => {
    await capture('wall moved');
    expect(state.evidence).toHaveLength(0);
  });

  it('picks the photos back up off the ORIGINAL message when the answer arrives', async () => {
    // The reply is the word "yes" and carries nothing. Reading attachments off
    // it alone would file the change and silently lose what proved it.
    state.answer = {
      outcome: 'answered',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      originalText: 'Client wants the reception wall moved 400mm',
      candidateProjectIds: ['proj-a', 'proj-b'],
      sourceMessageId: null,
      sourceSubject: null,
    };
    state.eventPayload = {
      attachments: [
        { external_id: 'att-9', file_name: 'wall.jpg', mime_type: 'image/jpeg', content_base64: 'AAA=' },
      ],
    };

    const outcome = await capture('yes');
    expect(outcome.kind).toBe('created');
    expect(state.evidence[0]?.attachments).toHaveLength(1);
    // And the change carries the ORIGINAL report, not the word "yes".
    expect(state.created[0]?.description).toContain('reception wall');
    // The exchange is closed by telling them where it landed. A reporter who
    // is never told assumes he was not heard, and reports it again by hand.
    expect(String(state.acknowledged[0]?.text)).toContain('PC-');
  });

  it('files nothing and says so when the reporter cancels', async () => {
    state.answer = {
      outcome: 'cancelled',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: null,
      originalText: 'Client wants the reception wall moved 400mm',
      candidateProjectIds: ['proj-a', 'proj-b'],
      sourceMessageId: null,
      sourceSubject: null,
    };

    const outcome = await capture('cancel');
    expect(outcome.kind).toBe('cancelled');
    expect(state.created).toHaveLength(0);
    expect(state.evidence).toHaveLength(0);
    expect(String(state.acknowledged[0]?.text)).toContain('Nothing has been recorded');
  });

  it('re-asks with the full list when the reporter says we had it wrong', async () => {
    state.answer = {
      outcome: 'rejected',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: null,
      originalText: 'Client wants the reception wall moved 400mm',
      candidateProjectIds: ['proj-a', 'proj-b', 'proj-c'],
      sourceMessageId: 'msg-original',
      sourceSubject: 'Reception wall',
    };

    const outcome = await capture('no');
    expect(outcome.kind).toBe('needs_triage');
    expect(state.created).toHaveLength(0);
    expect(state.asked[0]?.candidateProjectIds).toEqual(['proj-a', 'proj-b', 'proj-c']);
    // Still on the same email thread as the question they answered.
    expect(state.asked[0]?.sourceMessageId).toBe('msg-original');
  });
});

/**
 * The exchange as a conversation rather than a form.
 *
 * Everything below is about the messages that are NOT reports: the courtesy at
 * the end, the photographs with no words, the one line that follows a filing.
 * Each of them used to become a Potential Change, and each of those was a junk
 * record somebody had to close by hand.
 */
describe('the rest of the conversation', () => {
  beforeEach(() => {
    state.user = { id: 'ahmed', fullName: 'Ahmed' };
    state.memberships = memberOf('proj-a');
    state.allProjects = PROJECTS;
    state.asked = [];
    state.confirmed = [];
    state.created = [];
    state.evidence = [];
    state.answer = null;
    state.eventPayload = null;
    state.senders = null;
    state.acknowledged = [];
    state.askedWhichChange = [];
    state.askedToDescribe = [];
    state.askedForDetail = [];
    state.readBack = [];
    state.confirmationEnabled = false;
    state.detailFields = [];
    state.recentExchange = false;
    state.updated = [];
    state.change = null;
  });

  it('answers "thanks" instead of filing a Potential Change called "thanks"', async () => {
    state.recentExchange = true;
    const outcome = await capture('thanks');
    expect(outcome.kind).toBe('closed');
    expect(state.created).toHaveLength(0);
    expect(state.acknowledged).toHaveLength(1);
  });

  it('says what the number is for when the courtesy came out of the blue', async () => {
    state.recentExchange = false;
    await capture('ok');
    expect(String(state.acknowledged[0]?.text)).toContain('Send a line');
  });

  it('still files a report that merely opens politely', async () => {
    const outcome = await capture('thanks, and the client wants the ceiling grid lowered');
    expect(outcome.kind).toBe('created');
  });

  it('a photograph captioned "thanks" is still a photograph', async () => {
    const outcome = await capture('thanks', {
      attachments: [{ externalId: 'a', fileName: 'a.jpg', mimeType: 'image/jpeg' }],
    });
    expect(outcome.kind).not.toBe('closed');
  });

  it('asks what files with no message are OF, rather than opening a change titled "[media only]"', async () => {
    const outcome = await capture('[media only]', {
      channel: 'whatsapp',
      attachments: [
        { externalId: 'a', fileName: 'a.jpg', mimeType: 'image/jpeg' },
        { externalId: 'b', fileName: 'b.jpg', mimeType: 'image/jpeg' },
      ],
    });
    expect(outcome.kind).toBe('needs_triage');
    expect(state.created).toHaveLength(0);
    expect(state.askedWhichChange[0]?.projectId).toBe('proj-a');
    expect(state.askedWhichChange[0]?.evidenceCount).toBe(2);
  });

  it('files a captioned photo straight away, because a caption says what it is', async () => {
    // The caption is the report. Asking a man who has just told you what a
    // photo is to tell you again is how a system teaches people to stop
    // replying to it.
    const outcome = await capture('reception ceiling grid is 300mm low', {
      attachments: [{ externalId: 'a', fileName: 'a.jpg', mimeType: 'image/jpeg' }],
    });
    expect(outcome.kind).toBe('created');
    expect(state.askedWhichChange).toHaveLength(0);
  });

  it('puts the files on the change they name, and opens nothing new', async () => {
    state.change = {
      id: 'pc-7',
      pcNumber: 'PC-DXB-001-0007',
      projectId: 'proj-a',
      title: 'Reception ceiling grid lowered',
      summary: null,
      description: 'Reception ceiling grid lowered',
    };
    state.answer = {
      outcome: 'attach_existing',
      kind: 'attach',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: 'pc-7',
      originalText: '[media only]',
      replyText: '0007',
      candidateProjectIds: ['proj-a'],
      detailFields: [],
      sourceMessageId: null,
      sourceSubject: null,
    };
    state.eventPayload = {
      attachments: [
        { external_id: 'att-9', file_name: 'ceiling.jpg', mime_type: 'image/jpeg', content_base64: 'AAA=' },
      ],
    };

    const outcome = await capture('0007');
    expect(outcome.kind).toBe('evidence_filed');
    // A second change for the same event splits the evidence across two
    // claims, and both get priced on half the story.
    expect(state.created).toHaveLength(0);
    expect(state.evidence[0]?.potentialChangeId).toBe('pc-7');
    expect(String(state.acknowledged[0]?.text)).toContain('PC-DXB-001-0007');
  });

  it('asks what changed when the files turn out to be something new', async () => {
    state.answer = {
      outcome: 'attach_new',
      kind: 'attach',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: null,
      originalText: '[media only]',
      replyText: 'new one',
      candidateProjectIds: ['proj-a'],
      detailFields: [],
      sourceMessageId: null,
      sourceSubject: null,
    };
    state.eventPayload = {
      attachments: [{ external_id: 'att-9', file_name: 'a.jpg', mime_type: 'image/jpeg' }],
    };

    const outcome = await capture('new one');
    expect(outcome.kind).toBe('needs_triage');
    // A change with photographs and no description is not a claim, it is a
    // puzzle for whoever opens it.
    expect(state.created).toHaveLength(0);
    expect(state.askedToDescribe[0]?.projectId).toBe('proj-a');
  });

  it('opens the change on the line they send back, with the waiting files on it', async () => {
    state.answer = {
      outcome: 'described',
      kind: 'describe',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: null,
      originalText: '[media only]',
      replyText: 'client asked for the reception ceiling grid to be reset 300mm lower',
      candidateProjectIds: ['proj-a'],
      detailFields: [],
      sourceMessageId: null,
      sourceSubject: null,
    };
    state.eventPayload = {
      attachments: [{ external_id: 'att-9', file_name: 'a.jpg', mime_type: 'image/jpeg' }],
    };

    const outcome = await capture('client asked for the reception ceiling grid to be reset 300mm lower');
    expect(outcome.kind).toBe('created');
    expect(String(state.created[0]?.description)).toContain('300mm lower');
    expect(state.evidence[0]?.attachments).toHaveLength(1);
  });

  it('moves the notice deadline when the follow-up says when it actually happened', async () => {
    // The point of asking. The deadline counts from the day it happened, so a
    // change reported late has fewer days left than the contract's full period
    // — and a system that silently assumes today says otherwise.
    state.change = {
      id: 'pc-7',
      pcNumber: 'PC-DXB-001-0007',
      projectId: 'proj-a',
      description: 'Reception ceiling grid lowered',
      // Deliberately far from any date the reply could parse to. It was
      // 1 September, which silently became "3 days ago" when the calendar
      // reached the 4th — the patch turned into a no-op and the test failed
      // on a day nobody had touched the code.
      eventDate: new Date(Date.UTC(2026, 0, 1)),
      sourceReference: null,
      workStatus: 'not_started',
      project: { projectCode: 'DXB-001', contractRules: { noticePeriodDays: 28 } },
    };
    state.answer = {
      outcome: 'detailed',
      kind: 'detail',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: 'pc-7',
      originalText: 'Reception ceiling grid lowered',
      replyText: 'it happened 3 days ago, drawing AR-201 Rev C, work already started',
      candidateProjectIds: ['proj-a'],
      detailFields: ['event_date', 'document_reference'],
      sourceMessageId: null,
      sourceSubject: null,
    };

    const outcome = await capture('it happened 3 days ago, drawing AR-201 Rev C, work already started');
    expect(outcome.kind).toBe('updated');
    expect(state.created).toHaveLength(0);

    const patch = state.updated[0] ?? {};
    expect(patch.eventDate).toBeInstanceOf(Date);
    expect(patch.noticeDueDate).toBeInstanceOf(Date);
    expect(String(patch.sourceReference)).toContain('AR-201');
    expect(patch.workStatus).toBe('in_progress');
    // The reporter's extra words are kept verbatim, whether or not anything
    // parsed out of them.
    expect(String(patch.description)).toContain('AR-201 Rev C');
  });

  it('leaves the change alone when the follow-up is declined', async () => {
    state.answer = {
      outcome: 'declined',
      kind: 'detail',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: 'pc-7',
      originalText: 'Reception ceiling grid lowered',
      replyText: 'skip',
      candidateProjectIds: ['proj-a'],
      detailFields: ['event_date'],
      sourceMessageId: null,
      sourceSubject: null,
    };

    const outcome = await capture('skip');
    expect(outcome.kind).toBe('closed');
    expect(state.updated).toHaveLength(0);
    expect(state.created).toHaveLength(0);
  });

  it('reads the event date out of the report itself, so the deadline is right without asking', async () => {
    await capture('client instructed the ceiling change 3 days ago');
    const eventDate = state.created[0]?.eventDate as Date;
    const daysAgo = Math.round((Date.now() - eventDate.getTime()) / 86_400_000);
    expect(daysAgo).toBeGreaterThanOrEqual(3);
  });

  it('asks what is missing BEFORE opening anything', async () => {
    state.detailFields = ['work_status'];
    const outcome = await capture('client wants the wall moved');

    // Osman's rule, 2026-09-04. A change whose work status nobody knows cannot
    // be assessed — it may be an instruction to price or a cost already spent
    // — so it is not opened on half a story. Nothing is written until he
    // answers, and the question carries no change reference because there is
    // no change yet.
    expect(outcome.kind).toBe('needs_triage');
    expect(state.created).toHaveLength(0);
    expect(state.askedForDetail[0]?.fields).toEqual(['work_status']);
    expect(state.askedForDetail[0]?.potentialChangeId ?? null).toBeNull();
  });

  it('files on the answer, reading the reply and the report as one', async () => {
    state.answer = {
      outcome: 'detailed',
      kind: 'detail',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      // No change yet. This is the pre-filing follow-up.
      potentialChangeId: null,
      originalText: 'client wants the reception wall moved',
      replyText: 'yes work started yesterday',
      candidateProjectIds: ['proj-a'],
      detailFields: ['work_status', 'event_date'],
      sourceMessageId: null,
      sourceSubject: null,
    };

    const outcome = await capture('yes work started yesterday');

    expect(outcome.kind).toBe('created');
    // Both halves reach the record. Filing on the reply alone would store
    // "yes work started yesterday" as the entire report and lose the change.
    const description = String(state.created[0]?.description ?? '');
    expect(description).toContain('reception wall moved');
    expect(description).toContain('work started');
  });

  it('reads the capture back before writing anything', async () => {
    // Osman's call, 2026-09-04. The last cheap moment to be wrong: after this
    // a PC number exists, a clock is running and two people have been told.
    state.confirmationEnabled = true;
    state.detailFields = [];

    const outcome = await capture('client wants the reception wall moved yesterday, not started');

    expect(outcome.kind).toBe('needs_triage');
    expect(state.created).toHaveLength(0);
    expect(state.readBack).toHaveLength(1);

    const summary = state.readBack[0]?.summary as Record<string, unknown>;
    expect(String(summary.description)).toContain('reception wall moved');
    expect(summary.projectLabel).toBe('DXB-001 Marina Heights Lobby');
  });

  it('files on the word back, without asking anything else', async () => {
    state.confirmationEnabled = true;
    state.detailFields = ['work_status'];
    state.answer = {
      outcome: 'answered',
      kind: 'summary',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: null,
      originalText: 'client wants the reception wall moved',
      replyText: 'ok',
      candidateProjectIds: ['proj-a'],
      detailFields: [],
      sourceMessageId: null,
      sourceSubject: null,
    };

    const outcome = await capture('ok');

    // He has checked it. Asking again would be the system refusing to believe
    // its own summary.
    expect(outcome.kind).toBe('created');
    expect(state.askedForDetail).toHaveLength(0);
  });

  it('takes a correction instead of filing what he says is wrong', async () => {
    state.confirmationEnabled = true;
    state.detailFields = [];
    state.answer = {
      outcome: 'described',
      kind: 'summary',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: null,
      originalText: 'client wants the reception wall moved',
      replyText: 'no it is the lobby wall not the reception',
      candidateProjectIds: ['proj-a'],
      detailFields: [],
      sourceMessageId: null,
      sourceSubject: null,
    };

    const outcome = await capture('no it is the lobby wall not the reception');

    // Nothing was written, so the correction costs one more round and no
    // cleanup. That is the whole reason the read-back comes before the filing.
    expect(outcome.kind).toBe('needs_triage');
    expect(state.created).toHaveLength(0);
    const summary = state.readBack.at(-1)?.summary as Record<string, unknown>;
    expect(String(summary.description)).toContain('lobby wall');
  });

  it('files as reported when he says he cannot answer', async () => {
    state.answer = {
      outcome: 'declined',
      kind: 'detail',
      questionId: 'q1',
      integrationEventId: 'evt-original',
      userId: 'ahmed',
      userName: 'Ahmed',
      projectId: 'proj-a',
      potentialChangeId: null,
      originalText: 'client wants the reception wall moved',
      replyText: 'skip',
      candidateProjectIds: ['proj-a'],
      detailFields: ['work_status'],
      sourceMessageId: null,
      sourceSubject: null,
    };

    const outcome = await capture('skip');

    // "I don't know" is an answer, and it must not cost him the record.
    // Refusing to file here would punish honesty by losing a real change.
    expect(outcome.kind).toBe('created');
    expect(state.askedForDetail).toHaveLength(0);
  });
});
