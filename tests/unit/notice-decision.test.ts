import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The project manager's notice decision.
 *
 * One screen, three answers, and the two rules that make the answers worth
 * having:
 *
 *   · "no" is not an answer without a reason on the record
 *   · deciding does not hold up the money — pricing starts the same moment,
 *     whether a notice is going out or not
 *
 * The second one is the whole reason this stage exists. A notice protects
 * entitlement inside a contractual window; if the QS waits for it to be
 * drafted, approved and served, the days it was trying to save are spent
 * waiting for it.
 */

const state = {
  change: null as Record<string, unknown> | null,
  pcUpdates: [] as Record<string, unknown>[],
  tasksCreated: [] as Record<string, unknown>[],
  taskUpdates: [] as Record<string, unknown>[],
  drafted: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
  openTaskOfType: null as Record<string, unknown> | null,
  stageOwner: 'quinn-the-qs' as string | null,
};

vi.mock('server-only', () => ({}));
vi.mock('@/services/audit-log.service', () => ({
  recordAudit: async (input: Record<string, unknown>) => {
    state.audits.push(input);
    return {};
  },
}));
vi.mock('@/services/project-access.service', () => ({
  assertProjectAccess: async () => undefined,
}));
vi.mock('@/services/permissions.service', () => ({
  pickResponsibleMember: async () => state.stageOwner,
  listMembersWithCapability: async () => [],
}));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async () => [],
  recordTaskNotifications: async () => 0,
}));
vi.mock('@/services/notice-document.service', () => ({
  draftNotice: async (_tx: unknown, input: Record<string, unknown>) => {
    state.drafted.push(input);
    return { id: 'notice-1' };
  },
  markNoticeDelivered: async () => undefined,
}));
vi.mock('@/integrations/claude', () => ({
  getAiProvider: () => ({ draftNoticeNarrative: async () => null }),
}));
vi.mock('@/integrations/claude/provider', () => ({ CONFIDENCE_REVIEW_THRESHOLD: 0.6 }));

const prismaMock = {
  potentialChange: {
    findUnique: async () => state.change,
    update: async (args: Record<string, unknown>) => {
      state.pcUpdates.push(args);
      return { ...(state.change ?? {}), ...(args.data as Record<string, unknown>) };
    },
  },
  task: {
    updateMany: async (args: Record<string, unknown>) => {
      state.taskUpdates.push(args);
      return { count: 1 };
    },
    findFirst: async () => state.openTaskOfType,
    create: async (args: Record<string, unknown>) => {
      state.tasksCreated.push(args);
      return { id: `task-${state.tasksCreated.length}` };
    },
  },
  user: { findMany: async () => [] },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const { assessNotice, noticeAssessmentSchema } = await import('@/services/notice.service');

const PM = { id: 'pm-1', fullName: 'Daniel Okafor', systemRole: 'standard_user' } as never;
const PC_ID = '33333333-3333-4333-8333-333333333333';

function change(overrides: Record<string, unknown> = {}) {
  return {
    id: PC_ID,
    projectId: 'proj-1',
    pcNumber: 'PC-DXB-001-0004',
    title: 'Glass partitions in place of plasterboard',
    description: 'The consultant asked for glass on the walk this morning.',
    trade: 'Partitions',
    location: 'Level 3',
    noticeStatus: 'not_assessed',
    reportedByUserId: 'engineer-1',
    currentOwnerUserId: 'pm-1',
    project: { contractRules: { pmScopeReviewDueDays: 3 } },
    ...overrides,
  };
}

/** The single update that carries the decision, whatever else was written. */
function decisionUpdate() {
  return state.pcUpdates[0]?.data as Record<string, unknown>;
}

function tasksOfType(taskType: string) {
  return state.tasksCreated.filter(
    (task) => (task.data as Record<string, unknown>)?.taskType === taskType,
  );
}

beforeEach(() => {
  state.change = change();
  state.pcUpdates = [];
  state.tasksCreated = [];
  state.taskUpdates = [];
  state.drafted = [];
  state.audits = [];
  state.openTaskOfType = null;
  state.stageOwner = 'quinn-the-qs';
});

describe('what the form will accept', () => {
  it('refuses "no notice required" with no reason', () => {
    const result = noticeAssessmentSchema.safeParse({ outcome: 'not_required' });
    expect(result.success).toBe(false);
  });

  it('refuses a reason it does not recognise', () => {
    const result = noticeAssessmentSchema.safeParse({
      outcome: 'not_required',
      reason: 'because I said so',
    });
    expect(result.success).toBe(false);
  });

  it('refuses "need more information" without saying what is missing', () => {
    expect(noticeAssessmentSchema.safeParse({ outcome: 'needs_more_information' }).success).toBe(
      false,
    );
    // Too short to act on is the same as not saying.
    expect(
      noticeAssessmentSchema.safeParse({ outcome: 'needs_more_information', missingInformation: 'no' })
        .success,
    ).toBe(false);
  });

  it('takes "yes" on its own, because that answer explains itself', () => {
    expect(noticeAssessmentSchema.safeParse({ outcome: 'required' }).success).toBe(true);
  });

  it('reads an unticked checkbox as no, never as the string "false"', () => {
    const absent = noticeAssessmentSchema.parse({
      outcome: 'needs_more_information',
      missingInformation: 'The consultant instruction reference',
    });
    expect(absent).toMatchObject({ allowPricingToContinue: false });

    const ticked = noticeAssessmentSchema.parse({
      outcome: 'needs_more_information',
      missingInformation: 'The consultant instruction reference',
      allowPricingToContinue: 'on',
    });
    expect(ticked).toMatchObject({ allowPricingToContinue: true });
  });
});

describe('yes, send a notice', () => {
  it('drafts the notice and starts pricing in the same breath', async () => {
    await assessNotice(PM, PC_ID, { outcome: 'required' });

    expect(state.drafted).toHaveLength(1);
    expect(decisionUpdate()).toMatchObject({
      noticeRequired: true,
      noticeStatus: 'drafted',
      currentStatus: 'qs_pricing',
    });
    expect(tasksOfType('qs_pricing')).toHaveLength(1);
  });

  it('does not send anything', async () => {
    await assessNotice(PM, PC_ID, { outcome: 'required' });

    // `drafted` is as far as one person's decision may carry it. Sending is a
    // second, deliberate act on the draft itself.
    expect(decisionUpdate().noticeStatus).toBe('drafted');
    expect(decisionUpdate().noticeStatus).not.toBe('sent');
  });

  it('closes the assessment task it just answered', async () => {
    await assessNotice(PM, PC_ID, { outcome: 'required' });

    const closed = state.taskUpdates.find(
      (update) =>
        ((update.where as Record<string, unknown>)?.taskType as string) === 'notice_assessment',
    );
    expect((closed?.data as Record<string, unknown>)?.status).toBe('completed');
  });
});

describe('no, notice not required', () => {
  it('records the reason on the change and in the audit trail', async () => {
    await assessNotice(PM, PC_ID, {
      outcome: 'not_required',
      reason: 'included_in_scope',
      notes: 'Covered by the tender drawings.',
    });

    expect(decisionUpdate()).toMatchObject({
      noticeRequired: false,
      noticeStatus: 'not_required',
      noticeNotRequiredReason: 'included_in_scope',
    });
    expect(state.audits[0]).toMatchObject({
      actionType: 'notice_not_required',
      metadata: { reason: 'included_in_scope' },
    });
  });

  it('still goes to pricing, and drafts no notice', async () => {
    await assessNotice(PM, PC_ID, { outcome: 'not_required', reason: 'other' });

    expect(decisionUpdate().currentStatus).toBe('qs_pricing');
    expect(tasksOfType('qs_pricing')).toHaveLength(1);
    expect(state.drafted).toHaveLength(0);
  });
});

describe('need more information', () => {
  const missing = 'Which drawing revision the consultant was pointing at';

  it('asks the person who reported it, in their own words', async () => {
    await assessNotice(PM, PC_ID, {
      outcome: 'needs_more_information',
      missingInformation: missing,
      allowPricingToContinue: false,
    });

    const [task] = tasksOfType('evidence_collection');
    expect((task?.data as Record<string, unknown>)?.assignedToUserId).toBe('engineer-1');
    // Quoted, not paraphrased — the engineer has to know what to go and get.
    expect((task?.data as Record<string, unknown>)?.description).toBe(missing);
  });

  it('holds the change with the PM and raises no pricing task', async () => {
    await assessNotice(PM, PC_ID, {
      outcome: 'needs_more_information',
      missingInformation: missing,
      allowPricingToContinue: false,
    });

    expect(decisionUpdate()).toMatchObject({
      currentStatus: 'needs_evidence',
      waitingFor: 'Missing information',
      pricingStartedEarly: false,
    });
    expect(tasksOfType('qs_pricing')).toHaveLength(0);
    expect(state.drafted).toHaveLength(0);
  });

  it('prices in parallel only when the PM says so, and still says what is missing', async () => {
    await assessNotice(PM, PC_ID, {
      outcome: 'needs_more_information',
      missingInformation: missing,
      allowPricingToContinue: true,
    });

    expect(tasksOfType('qs_pricing')).toHaveLength(1);
    // The headline still names the gap. If this said "QS pricing" the register
    // would stop showing that the review was never finished.
    expect(decisionUpdate()).toMatchObject({
      currentStatus: 'needs_evidence',
      waitingFor: 'Missing information',
      pricingStartedEarly: true,
    });
  });

  it('falls back to the change owner when nobody is named as the reporter', async () => {
    state.change = change({ reportedByUserId: null, currentOwnerUserId: 'pm-1' });

    await assessNotice(PM, PC_ID, {
      outcome: 'needs_more_information',
      missingInformation: missing,
      allowPricingToContinue: false,
    });

    const [task] = tasksOfType('evidence_collection');
    expect((task?.data as Record<string, unknown>)?.assignedToUserId).toBe('pm-1');
  });

  it('does not raise a second request when one is already open', async () => {
    state.openTaskOfType = { id: 'task-existing' };

    await assessNotice(PM, PC_ID, {
      outcome: 'needs_more_information',
      missingInformation: missing,
      allowPricingToContinue: false,
    });

    expect(tasksOfType('evidence_collection')).toHaveLength(0);
  });
});
