import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The capture inbox.
 *
 * `captureFromChannel` has always refused to guess which project a message
 * belongs to when the sender is on several. That refusal was correct and it
 * was also, until now, a hole: `processOnce` marked the event `processed`
 * because nothing threw, so a message the system deliberately parked was
 * indistinguishable from one that became a real Potential Change. Nobody would
 * have found it. These tests hold the two halves of the fix — the event says
 * it is waiting, and a person can put it somewhere.
 */

const state = {
  event: null as Record<string, unknown> | null,
  users: [] as Record<string, unknown>[],
  closed: [] as { id: string; status: string; outcome: Record<string, unknown> }[],
  created: [] as Record<string, unknown>[],
  accessChecks: [] as { projectId: string; capability?: string }[],
  accessDenied: false,
};

vi.mock('server-only', () => ({}));

const tx = {
  project: {
    findUnique: async () => ({
      id: 'proj-b',
      projectCode: 'DXB-001',
      contractRules: { noticePeriodDays: 28, pmScopeReviewDueDays: 3 },
    }),
  },
  $queryRaw: async () => [{ pc_sequence: 9 }],
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
    integrationEvent: {
      findUnique: async () => state.event,
    },
    user: {
      findFirst: async (args: { where: Record<string, unknown> }) =>
        state.users.find((u) =>
          args.where.phone ? u.phone === args.where.phone : u.email === args.where.email,
        ) ?? null,
      findMany: async (args: { where: Record<string, unknown> }) =>
        state.users.filter((u) =>
          args.where.phone ? u.phone === args.where.phone : u.email === args.where.email,
        ),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock('@/integrations/claude', () => ({
  extractWithFallback: async () => ({
    envelope: {
      extractedData: {
        suggestedTitle: 'Reception wall moved 400mm',
        location: 'Reception, Level 2',
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

vi.mock('@/services/permissions.service', () => ({
  pickResponsibleMember: async () => 'daniel',
}));

vi.mock('@/services/notification.service', () => ({
  loadRecipients: async (ids: string[]) => ids.filter(Boolean).map((id) => ({ userId: id })),
  recordTaskNotifications: async () => 1,
}));

vi.mock('@/services/audit-log.service', () => ({ recordAudit: async () => undefined }));

vi.mock('@/services/project-access.service', () => ({
  assertProjectAccess: async (_u: unknown, projectId: string, capability?: string) => {
    state.accessChecks.push({ projectId, capability });
    if (state.accessDenied) throw new (await import('@/lib/errors')).ForbiddenError('no');
    return { projectRoles: [] };
  },
  assertCapability: async () => undefined,
}));

vi.mock('@/services/integration.service', () => ({
  listUnprocessedEvents: async () => (state.event ? [state.event] : []),
  closeEvent: async (id: string, status: string, outcome: Record<string, unknown>) => {
    state.closed.push({ id, status, outcome });
  },
}));

const capture = await import('@/services/capture.service');

const user = { id: 'coordinator', email: 'coord@abc.ae', fullName: 'Nadia', systemRole: 'project_manager' } as never;

function whatsappEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    source: 'whatsapp',
    externalId: 'wa-123',
    status: 'needs_triage',
    receivedAt: new Date('2026-09-01T06:00:00Z'),
    errorMessage: null,
    payloadJson: {
      sender: { phone: '+971500000001', display_name: 'Ahmed' },
      message: { text: 'Client asked us to move the reception wall 400mm' },
    },
    resultJson: {
      kind: 'needs_triage',
      reason: 'Ahmed Khan is on 3 active projects — cannot determine which',
      candidateProjectIds: ['proj-a', 'proj-b', 'proj-c'],
    },
    ...overrides,
  };
}

describe('the capture inbox', () => {
  beforeEach(() => {
    state.event = whatsappEvent();
    state.users = [{ id: 'ahmed', fullName: 'Ahmed Khan', phone: '+971500000001', email: 'ahmed@abc.ae' }];
    state.closed = [];
    state.created = [];
    state.accessChecks = [];
    state.accessDenied = false;
  });

  it('shows the message, the sender and the reason it was not filed', async () => {
    const [item] = await capture.listTriageQueue();

    expect(item?.senderName).toBe('Ahmed');
    expect(item?.text).toContain('reception wall');
    expect(item?.reason).toContain('3 active projects');
    expect(item?.candidateProjectIds).toEqual(['proj-a', 'proj-b', 'proj-c']);
  });

  it('checks authority on the CHOSEN project, not on the inbox', async () => {
    await capture.fileTriagedEvent(user, { eventId: 'evt-1', projectId: 'proj-b' });

    expect(state.accessChecks).toEqual([
      { projectId: 'proj-b', capability: 'potentialChange.create' },
    ]);
  });

  it('refuses to file onto a project the person has no authority on', async () => {
    state.accessDenied = true;

    await expect(
      capture.fileTriagedEvent(user, { eventId: 'evt-1', projectId: 'proj-z' }),
    ).rejects.toThrow();

    expect(state.created).toHaveLength(0);
  });

  it('attributes the change to whoever SENT it, not to whoever filed it', async () => {
    await capture.fileTriagedEvent(user, { eventId: 'evt-1', projectId: 'proj-b' });

    // Ahmed saw it happen. Nadia moved it out of a queue.
    expect(state.created[0]?.reportedByUserId).toBe('ahmed');
    expect(state.created[0]?.reportedByUserId).not.toBe('coordinator');
  });

  it('falls back to the filer when the sender is nobody we hold', async () => {
    state.users = [];

    await capture.fileTriagedEvent(user, { eventId: 'evt-1', projectId: 'proj-b' });

    expect(state.created[0]?.reportedByUserId).toBe('coordinator');
  });

  it('records what happened to the event, keeping the original reason', async () => {
    await capture.fileTriagedEvent(user, { eventId: 'evt-1', projectId: 'proj-b' });

    expect(state.closed[0]?.status).toBe('processed');
    expect(state.closed[0]?.outcome.pcNumber).toBe('PC-DXB-001-0009');
    expect(state.closed[0]?.outcome.filedByUserId).toBe('coordinator');
  });

  it('will not file the same message twice', async () => {
    state.event = whatsappEvent({ status: 'processed' });

    await expect(
      capture.fileTriagedEvent(user, { eventId: 'evt-1', projectId: 'proj-b' }),
    ).rejects.toThrow(/already been dealt with/);
  });

  it('will not dismiss a message without a reason', async () => {
    await expect(
      capture.dismissTriagedEvent(user, { eventId: 'evt-1', reason: '' }),
    ).rejects.toThrow(/why/i);

    expect(state.closed).toHaveLength(0);
  });

  it('keeps a dismissed message, marked ignored, with who decided', async () => {
    await capture.dismissTriagedEvent(user, {
      eventId: 'evt-1',
      reason: 'Duplicate of a photo already sent on the group',
    });

    expect(state.closed[0]?.status).toBe('ignored');
    expect(state.closed[0]?.outcome.dismissedByUserId).toBe('coordinator');
    expect(state.closed[0]?.outcome.reason).toContain('Duplicate');
  });
});
