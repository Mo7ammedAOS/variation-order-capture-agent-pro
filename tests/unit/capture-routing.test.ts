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
    },
    integrationEvent: { findUnique: async () => ({ payloadJson: state.eventPayload }) },
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
}));
vi.mock('@/services/permissions.service', () => ({ pickResponsibleMember: async () => 'cm-1' }));
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
