import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { assertProjectAccess } from '@/services/project-access.service';
import { getEmbeddingProvider } from '@/integrations/embeddings';

/**
 * Vector search.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY SIMILARITY QUERY IS FILTERED BY project_id BEFORE THE ANN SEARCH.
 *
 *  An unscoped nearest-neighbour search would surface one project's
 *  correspondence inside another — the exact failure the critical access rule
 *  forbids, arriving through a door that looks like a feature. Cross-project
 *  semantic search is not a Phase 2 item. It is permanently out of scope.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Results are SUGGESTIONS. Duplicate detection never merges, never closes and
 * never decides. A human looks at the score and judges.
 */

export interface SimilarChange {
  id: string;
  pcNumber: string;
  title: string;
  currentStatus: string;
  createdAt: Date;
  /** Cosine similarity, 0..1. Higher is more alike. */
  similarity: number;
}

/** Below this, "similar" is noise and showing it trains people to ignore the panel. */
const SIMILARITY_FLOOR = 0.55;

export async function indexPotentialChange(
  potentialChangeId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const change = await db.potentialChange.findUnique({
    where: { id: potentialChangeId },
    select: { id: true, projectId: true, title: true, description: true, trade: true, location: true },
  });
  if (!change) return;

  const content = [change.title, change.description, change.trade, change.location]
    .filter(Boolean)
    .join('\n');

  const provider = getEmbeddingProvider();
  const { vector, model, dims } = await provider.embed(content);
  const literal = toVectorLiteral(vector);

  // Prisma has no vector type, so the write is raw. The upsert keeps one row
  // per change: re-indexing after an edit replaces rather than accumulates.
  await db.$executeRaw`
    INSERT INTO potential_change_embeddings
      (id, potential_change_id, project_id, content, embedding, embedding_model, embedding_dims, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${change.id}::uuid, ${change.projectId}::uuid, ${content},
       ${literal}::vector, ${model}, ${dims}, now(), now())
    ON CONFLICT (potential_change_id) DO UPDATE SET
      content = EXCLUDED.content,
      embedding = EXCLUDED.embedding,
      embedding_model = EXCLUDED.embedding_model,
      embedding_dims = EXCLUDED.embedding_dims,
      updated_at = now()
  `;
}

/**
 * "Has this change already been raised?"
 *
 * Scoped to the one project the change belongs to, and the caller's access to
 * that project is asserted first.
 */
export async function findSimilarChanges(
  user: AuthenticatedUser,
  potentialChangeId: string,
  limit = 5,
): Promise<SimilarChange[]> {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    select: { id: true, projectId: true },
  });
  if (!change) return [];

  await assertProjectAccess(user, change.projectId);

  const rows = await prisma.$queryRaw<
    { id: string; pc_number: string; title: string; current_status: string; created_at: Date; similarity: number }[]
  >`
    SELECT pc.id,
           pc.pc_number,
           pc.title,
           pc.current_status::text AS current_status,
           pc.created_at,
           1 - (target.embedding <=> other.embedding) AS similarity
      FROM potential_change_embeddings target
      JOIN potential_change_embeddings other
        ON other.project_id = target.project_id
       AND other.potential_change_id <> target.potential_change_id
      JOIN potential_changes pc
        ON pc.id = other.potential_change_id
     WHERE target.potential_change_id = ${potentialChangeId}::uuid
       -- Redundant with the join above, and deliberately so. This predicate is
       -- the one that must never be removed.
       AND other.project_id = ${change.projectId}::uuid
       AND pc.current_status <> 'cancelled'
     ORDER BY target.embedding <=> other.embedding
     LIMIT ${limit}
  `;

  return rows
    .filter((row) => row.similarity >= SIMILARITY_FLOOR)
    .map((row) => ({
      id: row.id,
      pcNumber: row.pc_number,
      title: row.title,
      currentStatus: row.current_status,
      createdAt: row.created_at,
      similarity: Number(row.similarity),
    }));
}

/** Free-text semantic search within ONE project the caller may access. */
export async function searchWithinProject(
  user: AuthenticatedUser,
  projectId: string,
  query: string,
  limit = 10,
): Promise<SimilarChange[]> {
  await assertProjectAccess(user, projectId);

  const { vector } = await getEmbeddingProvider().embed(query);
  const literal = toVectorLiteral(vector);

  const rows = await prisma.$queryRaw<
    { id: string; pc_number: string; title: string; current_status: string; created_at: Date; similarity: number }[]
  >`
    SELECT pc.id, pc.pc_number, pc.title, pc.current_status::text AS current_status,
           pc.created_at, 1 - (e.embedding <=> ${literal}::vector) AS similarity
      FROM potential_change_embeddings e
      JOIN potential_changes pc ON pc.id = e.potential_change_id
     WHERE e.project_id = ${projectId}::uuid
     ORDER BY e.embedding <=> ${literal}::vector
     LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    pcNumber: row.pc_number,
    title: row.title,
    currentStatus: row.current_status,
    createdAt: row.created_at,
    similarity: Number(row.similarity),
  }));
}

/** pgvector's text input format: `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
