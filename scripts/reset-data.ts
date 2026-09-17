/**
 * Empties the working data and leaves the people behind.
 *
 * ── How this differs from `wipe.ts` ────────────────────────────────────────
 * `wipe.ts` is the scorched-earth one: it deletes the Supabase identities, the
 * users, the role permissions and the company settings, and hands back a
 * database that nobody can log into until `db:bootstrap` rebuilds it. That is
 * the right tool before a fresh seed.
 *
 * This is the other tool. Everything a company has *done* goes — projects,
 * changes, notices, pricing, variations, invoices, payments, tasks,
 * bottlenecks, the audit trail — and everything a company *is* stays:
 *
 *     users              the accounts and their system roles
 *     role_permissions   a missing row here is a DENIAL, not a default, so
 *                        clearing it would lock the app out of its own
 *                        Settings screen — see scripts/bootstrap.ts
 *     company_settings   branding, contractual defaults, working week
 *
 * Supabase Auth identities are left alone, deliberately: the accounts must
 * still work afterwards. Project membership does NOT survive, because projects
 * do not — everyone keeps their login and their system role, and is assigned
 * to projects again when projects exist again.
 *
 * ── It refuses unless you mean it ──────────────────────────────────────────
 * There is no undo. Take a snapshot first if the rows are worth anything.
 *
 *     RESET=yes npm run db:reset-data
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Children before parents. Order is load-bearing. */
const CLEAR = [
  // money, newest layer first
  'payments', 'credit_notes', 'invoices', 'variation_orders', 'notices',
  // capture, workflow and trail
  'capture_questions', 'notification_logs', 'integration_events',
  'pricing_line_items', 'approvals', 'activity_logs', 'bottlenecks', 'tasks',
  // the changes themselves and what hangs off them
  'potential_change_embeddings', 'document_chunks', 'potential_changes',
  'project_documents', 'contacts', 'project_contract_rules', 'project_members',
  'projects',
] as const;

/** Deliberately kept. Anything in neither list stops the run. */
const KEEP = ['users', 'role_permissions', 'company_settings', '_prisma_migrations'] as const;

async function main() {
  if (process.env.RESET !== 'yes') {
    console.error('Refusing. This deletes every project and everything under it.');
    console.error('Re-run with RESET=yes');
    process.exitCode = 1;
    return;
  }

  // A table added to the schema later must not be emptied by accident, nor
  // quietly left full while this script reports success.
  const live: { tablename: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const known = new Set<string>([...CLEAR, ...KEEP]);
  const strangers = live.map((t) => t.tablename).filter((t) => !known.has(t));
  if (strangers.length) {
    console.error('Unknown tables — decide where each belongs, then re-run:');
    for (const t of strangers) console.error(`  ${t}`);
    process.exitCode = 1;
    return;
  }

  // All or nothing: a half-cleared database has orphan rows the UI will trip on.
  const counts = await prisma.$transaction(
    CLEAR.map((t) => prisma.$executeRawUnsafe(`DELETE FROM "${t}"`))
  );

  CLEAR.forEach((t, i) => console.log(`  ${t.padEnd(30)} ${counts[i]}`));

  const kept = await Promise.all(
    KEEP.filter((t) => t !== '_prisma_migrations').map(async (t) => {
      const rows: { c: number }[] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS c FROM "${t}"`
      );
      return `${t} ${rows[0]?.c ?? 0}`;
    })
  );
  console.log(`\nKept: ${kept.join(', ')}`);
}

main()
  .catch((error) => {
    console.error('\nReset failed — nothing was deleted:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
