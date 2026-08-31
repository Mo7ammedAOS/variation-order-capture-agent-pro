import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A status is not a handover.
 *
 * Moving a change used to write one column. No owner, no next action, no task.
 * So PC-AUH-003-0006 passed both approvals, landed on QS pricing, and appeared
 * on nobody's list — Osman found it as "it didn't appear to the QS".
 *
 * A handover is four things together: a named person, a stated next action, a
 * date, and something on their list. These tests hold all four.
 */

const state = {
  owner: null as string | null,
  openTask: null as Record<string, unknown> | null,
  pcUpdates: [] as Record<string, unknown>[],
  tasksCreated: [] as Record<string, unknown>[],
  notifications: [] as Record<string, unknown>[],
  askedFor: [] as { capability: string; preferred: string[] }[],
};

vi.mock('server-only', () => ({}));
vi.mock('@/services/permissions.service', () => ({
  pickResponsibleMember: async (_p: string, capability: string, preferred: string[]) => {
    state.askedFor.push({ capability, preferred });
    return state.owner;
  },
}));
vi.mock('@/services/notification.service', () => ({
  loadRecipients: async (ids: string[]) => ids.filter(Boolean).map((id) => ({ userId: id })),
  recordTaskNotifications: async (_db: unknown, input: Record<string, unknown>) => {
    state.notifications.push(input);
    return 1;
  },
}));

const tx = {
  potentialChange: {
    update: async (args: Record<string, unknown>) => {
      state.pcUpdates.push(args);
      return args;
    },
  },
  task: {
    findFirst: async () => state.openTask,
    create: async (args: Record<string, unknown>) => {
      state.tasksCreated.push(args);
      return { id: 'task-' + state.tasksCreated.length };
    },
  },
};

const { enterStage } = await import('@/services/stage.service');

function enter(status: string) {
  return enterStage(tx as never, {
    potentialChangeId: 'pc-1',
    projectId: 'proj-1',
    pcNumber: 'PC-AUH-003-0006',
    title: 'Flooring change',
    status: status as never,
    actorUserId: 'khalid',
  });
}

describe('handing a change to the next stage', () => {
  beforeEach(() => {
    state.owner = 'suresh';
    state.openTask = null;
    state.pcUpdates = [];
    state.tasksCreated = [];
    state.notifications = [];
    state.askedFor = [];
  });

  it('gives QS pricing an owner, a next action and a task', async () => {
    const result = await enter('qs_pricing');

    expect(result.ownerUserId).toBe('suresh');
    expect(result.taskCreated).toBe(true);
    expect(state.pcUpdates[0]).toMatchObject({
      data: { currentOwnerUserId: 'suresh', waitingFor: 'QS pricing' },
    });
    expect(state.tasksCreated[0]).toMatchObject({
      data: { taskType: 'qs_pricing', assignedToUserId: 'suresh' },
    });
  });

  it('tells the person, rather than waiting for them to notice', async () => {
    await enter('qs_pricing');
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({ kind: 'task_assigned' });
  });

  // Asking "who is the QS" would have found nobody on a project whose surveyor
  // sits under a different role name. Asking who may PRICE finds whoever the
  // administrator granted it to.
  it('asks who may price, not who is called a quantity surveyor', async () => {
    await enter('qs_pricing');
    expect(state.askedFor[0]?.capability).toBe('pricing.submit');
  });

  it('sets a due date so the chase has something to count from', async () => {
    await enter('qs_pricing');
    const data = state.pcUpdates[0]?.data as Record<string, unknown>;
    expect(data.nextActionDueDate).toBeInstanceOf(Date);
  });

  // Moving a change back and forth would otherwise leave a trail of duplicate
  // tasks, each being chased daily.
  it('does not raise a second task when one is already open', async () => {
    state.openTask = { id: 'existing' };

    const result = await enter('qs_pricing');

    expect(result.taskCreated).toBe(false);
    expect(state.tasksCreated).toHaveLength(0);
  });

  it('still records the owner and next action when nobody can do the work', async () => {
    state.owner = null;

    const result = await enter('qs_pricing');

    expect(result.ownerUserId).toBeNull();
    // The task exists and is unassigned on purpose: an unowned task shows as a
    // bottleneck, where a missing one shows as nothing at all.
    expect(state.tasksCreated[0]).toMatchObject({ data: { assignedToUserId: null } });
    expect(state.notifications).toHaveLength(0);
  });

  it('routes scope review to the project manager', async () => {
    await enter('pm_scope_review');
    expect(state.askedFor[0]?.preferred[0]).toBe('project_manager');
    expect(state.tasksCreated[0]).toMatchObject({ data: { taskType: 'pm_scope_review' } });
  });

  // The two-seat gate raises its own task per seat. A stage task as well would
  // put one decision on somebody's list twice.
  it('raises no stage task at the approval gate', async () => {
    const result = await enter('internal_approval');

    expect(result.taskCreated).toBe(false);
    expect(state.tasksCreated).toHaveLength(0);
  });

  it('stops a finished change claiming it is still waiting for something', async () => {
    await enter('included_scope');

    expect(state.pcUpdates[0]).toMatchObject({ data: { waitingFor: null, nextAction: null } });
    expect(state.tasksCreated).toHaveLength(0);
  });
});
