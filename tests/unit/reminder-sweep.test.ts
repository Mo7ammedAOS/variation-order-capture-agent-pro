import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chase, and the four things it must never get wrong.
 *
 *   1. It stops. A completed or cancelled task is not chased, ever.
 *   2. It does not nag on a weekend — unless a CONTRACTUAL deadline has
 *      arrived, which does not observe a working week.
 *   3. It widens the audience on a ladder, and never hands the decision away.
 *   4. Running it twice on one day sends nothing twice.
 *
 * The fourth is the one worth a test even though it looks like plumbing: the
 * failure it prevents is messaging a managing director repeatedly about the
 * same overdue task, which is how a company switches the system off.
 */

type Row = Record<string, unknown>;

const state = {
  tasks: [] as Row[],
  members: [] as Row[],
  directors: [] as Row[],
  settings: { workweekStartDay: 1, workweekEndDay: 5 } as Row | null,
  created: [] as Row[],
  taskUpdates: [] as Row[],
  taskWhere: null as Row | null,
  emailUrl: '',
  whatsappUrl: '',
};

/** Stands in for the unique index that makes the sweep idempotent. */
const insertedKeys = new Set<string>();

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    N8N_NOTIFY_EMAIL_URL: state.emailUrl,
    N8N_NOTIFY_WHATSAPP_URL: state.whatsappUrl,
  }),
}));

vi.mock('@/integrations/n8n/client', () => ({
  dispatch: async () => ({ dispatched: false }),
}));

const prismaMock = {
  companySettings: { findFirst: async () => state.settings },
  task: {
    findMany: async (args: { where: Row }) => {
      state.taskWhere = args.where;
      return state.tasks;
    },
    update: async (args: Row) => {
      state.taskUpdates.push(args);
      return args;
    },
  },
  projectMember: { findMany: async () => state.members },
  user: { findMany: async () => state.directors },
  notificationLog: {
    createMany: async ({ data }: { data: Row[] }) => {
      let count = 0;
      for (const row of data) {
        const key = row.dedupeKey as string;
        if (insertedKeys.has(key)) continue;
        insertedKeys.add(key);
        state.created.push(row);
        count++;
      }
      return { count };
    },
    findMany: async () => [],
    update: async () => ({}),
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const { runReminderSweep } = await import('@/services/reminder.service');

const ASSIGNEE = {
  id: 'daniel',
  fullName: 'Daniel Okafor',
  email: 'daniel@example.com',
  phone: '+971500000001',
};

function task(overrides: Row = {}): Row {
  return {
    id: 'task-1',
    title: 'Notice assessment — PC-AUH-003-0006',
    dueDate: new Date('2026-09-01T00:00:00Z'),
    status: 'open',
    escalationLevel: 'none',
    potentialChangeId: 'pc-1',
    assignedToUserId: ASSIGNEE.id,
    assignedTo: ASSIGNEE,
    project: { id: 'proj-1', projectCode: 'AUH-003', projectName: 'Al Maryah Clinic' },
    potentialChange: {
      id: 'pc-1',
      pcNumber: 'PC-AUH-003-0006',
      title: 'Flooring change',
      noticeDueDate: new Date('2026-09-28T00:00:00Z'),
    },
    ...overrides,
  };
}

function recipientsOf(): string[] {
  return [...new Set(state.created.map((row) => row.userId as string))];
}

describe('the daily chase', () => {
  beforeEach(() => {
    state.tasks = [];
    state.members = [];
    state.directors = [];
    state.settings = { workweekStartDay: 1, workweekEndDay: 5 };
    state.created = [];
    state.taskUpdates = [];
    state.taskWhere = null;
    state.emailUrl = '';
    state.whatsappUrl = '';
    insertedKeys.clear();
  });

  it('only ever looks at work that is still open', async () => {
    await runReminderSweep(new Date('2026-09-01T09:00:00Z'));

    // Cancelling a task is how an administrator calls off a chase, so the
    // exclusion has to live in the query and not in a branch someone can slip
    // past later.
    expect(state.taskWhere?.status).toEqual({ in: ['open', 'in_progress', 'blocked'] });
    expect(state.taskWhere?.assignedTo).toEqual({ active: true });
  });

  it('reminds the person on a working day, and nobody else', async () => {
    state.tasks = [task()];

    await runReminderSweep(new Date('2026-09-01T09:00:00Z')); // Tuesday, due today

    expect(recipientsOf()).toEqual(['daniel']);
    expect(state.created[0]?.kind).toBe('task_reminder');
  });

  it('says nothing on a Saturday', async () => {
    state.tasks = [task()];

    const result = await runReminderSweep(new Date('2026-09-05T09:00:00Z'));

    expect(result.skippedNonWorkingDay).toBe(true);
    expect(state.created).toHaveLength(0);
  });

  // A contractual deadline does not observe the working week, and this is the
  // one case where the app is allowed to interrupt a weekend.
  it('chases on a Saturday when the notice deadline has arrived', async () => {
    state.tasks = [
      task({
        potentialChange: {
          id: 'pc-1',
          pcNumber: 'PC-AUH-003-0006',
          title: 'Flooring change',
          noticeDueDate: new Date('2026-09-04T00:00:00Z'),
        },
      }),
    ];
    state.members = [{ user: { id: 'pm', fullName: 'PM', email: 'pm@x.com', phone: null } }];
    state.directors = [{ id: 'md', fullName: 'MD', email: 'md@x.com', phone: null }];

    await runReminderSweep(new Date('2026-09-05T09:00:00Z'));

    expect(state.created.length).toBeGreaterThan(0);
    expect(state.created[0]?.body).toContain('DEADLINE');
  });

  it('copies the project manager once the task is a working day late', async () => {
    state.tasks = [task()];
    state.members = [{ user: { id: 'pm', fullName: 'PM', email: 'pm@x.com', phone: null } }];

    await runReminderSweep(new Date('2026-09-02T09:00:00Z')); // one day late

    expect(recipientsOf().sort()).toEqual(['daniel', 'pm']);
    expect(state.taskUpdates[0]).toMatchObject({ data: { escalationLevel: 'level_1' } });
  });

  it('brings in the managing director at three working days, weekend not counted', async () => {
    state.tasks = [task()];
    state.members = [{ user: { id: 'pm', fullName: 'PM', email: 'pm@x.com', phone: null } }];
    state.directors = [{ id: 'md', fullName: 'MD', email: 'md@x.com', phone: null }];

    // Due Tuesday 01 Sep, swept Friday 04 Sep: three working days, and no
    // weekend has been counted to inflate it.
    await runReminderSweep(new Date('2026-09-04T09:00:00Z'));

    expect(recipientsOf().sort()).toEqual(['daniel', 'md', 'pm']);
    expect(state.taskUpdates[0]).toMatchObject({ data: { escalationLevel: 'level_2' } });
  });

  it('never chases the same person twice for the same thing on the same day', async () => {
    state.tasks = [task()];

    await runReminderSweep(new Date('2026-09-02T09:00:00Z'));
    const afterFirst = state.created.length;
    await runReminderSweep(new Date('2026-09-02T17:00:00Z'));

    expect(afterFirst).toBeGreaterThan(0);
    expect(state.created).toHaveLength(afterFirst);
  });

  it('chases again the next day, because the decision is still owed', async () => {
    state.tasks = [task()];

    await runReminderSweep(new Date('2026-09-02T09:00:00Z'));
    const afterFirst = state.created.length;
    await runReminderSweep(new Date('2026-09-03T09:00:00Z'));

    expect(state.created.length).toBeGreaterThan(afterFirst);
  });

  it('writes an in-app record even when no delivery channel is configured', async () => {
    state.tasks = [task()];

    await runReminderSweep(new Date('2026-09-01T09:00:00Z'));

    expect(state.created.map((r) => r.channel)).toEqual(['in_app']);
  });

  it('queues email and WhatsApp as well once those lanes exist', async () => {
    state.emailUrl = 'https://n8n.example.com/webhook/email';
    state.whatsappUrl = 'https://n8n.example.com/webhook/whatsapp';
    state.tasks = [task()];

    await runReminderSweep(new Date('2026-09-01T09:00:00Z'));

    expect(state.created.map((r) => r.channel).sort()).toEqual(['email', 'in_app', 'whatsapp']);
  });

  it('skips WhatsApp for someone with no phone number rather than inventing one', async () => {
    state.whatsappUrl = 'https://n8n.example.com/webhook/whatsapp';
    state.tasks = [task({ assignedTo: { ...ASSIGNEE, phone: null } })];

    await runReminderSweep(new Date('2026-09-01T09:00:00Z'));

    expect(state.created.map((r) => r.channel)).toEqual(['in_app']);
  });
});
