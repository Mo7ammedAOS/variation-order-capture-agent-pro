import { jsonResponse, withAuth } from '@/lib/api';
import { listProjects } from '@/services/project.service';
import { listPotentialChanges } from '@/services/potential-change.service';

export const dynamic = 'force-dynamic';

/**
 * What the command palette can reach.
 *
 * Both services scope to the caller, which is the whole point of routing this
 * through them rather than querying Prisma here: a search box that quietly
 * indexes every project would be the neatest possible way to leak one client's
 * commercial correspondence to another, and it would look like a feature.
 *
 * A Site Engineer typing a PC number from a project they are not on gets
 * nothing back, exactly as if it did not exist.
 */
export const GET = withAuth(async (request, { user }) => {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  const [projects, changes] = await Promise.all([
    listProjects(user, query ? { search: query } : {}),
    query.length >= 2 ? listPotentialChanges(user, { search: query }) : Promise.resolve([]),
  ]);

  return jsonResponse({
    projects: projects.slice(0, 6).map((project) => ({
      id: project.id,
      code: project.projectCode,
      name: project.projectName,
    })),
    changes: changes.slice(0, 8).map((change) => ({
      id: change.id,
      pcNumber: change.pcNumber,
      title: change.title,
      projectCode: change.project.projectCode,
      riskLevel: change.riskLevel,
    })),
  });
});
