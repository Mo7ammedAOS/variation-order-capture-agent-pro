import { jsonResponse, withAuth } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/services/project-access.service';
import { enterStage } from '@/services/stage.service';

/**
 * Finds live changes that belong to nobody and hands them over properly.
 *
 * A change with no open task is invisible: it has a status, and no person. It
 * happened here because moving a change used to write one column and stop, and
 * eleven records — seeded ones and one that had just passed both approvals —
 * were sitting in exactly that state when the handover was fixed.
 *
 * This runs the real `enterStage`, not a copy of it, so a repaired change is
 * indistinguishable from one that arrived correctly. Safe to re-run: it only
 * touches changes with no open task, and `enterStage` refuses to raise a
 * second task for work already on somebody's list.
 */
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request, { user }) => {
  await assertCapability(user, 'companySettings.manage');

  const orphaned = await prisma.potentialChange.findMany({
    where: {
      currentStatus: { notIn: ['included_scope', 'cancelled'] },
      tasks: { none: { status: { in: ['open', 'in_progress', 'blocked'] } } },
    },
    select: { id: true, projectId: true, pcNumber: true, title: true, currentStatus: true },
  });

  const repaired: { pcNumber: string; status: string; owner: string | null }[] = [];

  for (const change of orphaned) {
    // One transaction each: a single change that cannot be re-homed — because
    // nobody holds the capability, say — must not roll back the other ten.
    const result = await prisma.$transaction((tx) =>
      enterStage(tx, {
        potentialChangeId: change.id,
        projectId: change.projectId,
        pcNumber: change.pcNumber,
        title: change.title,
        status: change.currentStatus,
        actorUserId: user.id,
      }),
    );
    repaired.push({
      pcNumber: change.pcNumber,
      status: change.currentStatus,
      owner: result.ownerUserId,
    });
  }

  return jsonResponse({ found: orphaned.length, repaired });
});
