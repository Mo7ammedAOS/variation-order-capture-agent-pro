/**
 * Empties the database and every Supabase identity that went with it.
 *
 * ── Why the two halves must go together ────────────────────────────────────
 * Deleting `users` rows while their Supabase Auth identities survive is what
 * locked the live app once already: middleware trusted the token, the page
 * render trusted the table, and /login bounced straight back to /dashboard in a
 * loop nobody could break from the browser. So identities are removed FIRST,
 * and only for the emails this seed owns.
 *
 * ── Why it refuses unless you mean it ──────────────────────────────────────
 * There is no undo. It takes a deliberate flag rather than a prompt, because a
 * prompt is something you learn to press through.
 *
 *     WIPE=yes npx tsx scripts/wipe.ts
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { USERS } from '../prisma/seed-data';

const prisma = new PrismaClient();

async function main() {
  if (process.env.WIPE !== 'yes') {
    console.error('Refusing. This deletes everything. Re-run with WIPE=yes');
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ── identities ────────────────────────────────────────────────────────────
  if (url && serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Everyone currently in the table, plus everyone the seed is about to
    // create. The second half matters: an identity left over from an earlier
    // cast under the same address would collide on the next seed.
    const existing = await prisma.user.findMany({ select: { email: true } });
    const owned = new Set([
      ...existing.map((u) => u.email.toLowerCase()),
      ...USERS.map((u) => u.email.toLowerCase()),
    ]);

    const { data } = await admin.auth.admin.listUsers({ perPage: 500 });
    let removed = 0;
    for (const identity of data?.users ?? []) {
      const email = identity.email?.toLowerCase();
      // Anything from the fictional seed company goes too — those are the
      // orphans that caused the lockout, and they belong to nobody.
      const isSeedCompany = email?.endsWith('@abcfitout.example');
      if (!email || !(owned.has(email) || isSeedCompany)) continue;
      await admin.auth.admin.deleteUser(identity.id);
      removed++;
    }
    console.log(`identities removed: ${removed}`);
  } else {
    console.log('!! No Supabase service key — identities NOT removed.');
    console.log('   Deleting the rows alone would lock the app. Stopping.');
    process.exitCode = 1;
    return;
  }

  // ── rows ──────────────────────────────────────────────────────────────────
  // Children before parents. TRUNCATE ... CASCADE would be shorter and would
  // also silently empty a table added later that nobody meant to clear.
  const order = [
    'capture_questions', 'notification_logs', 'integration_events',
    'pricing_line_items', 'approvals', 'activity_logs', 'bottlenecks', 'tasks',
    'potential_change_embeddings', 'document_chunks', 'potential_changes',
    'project_documents', 'contacts', 'project_contract_rules', 'project_members',
    'projects', 'users', 'role_permissions', 'company_settings',
  ];

  for (const table of order) {
    const n = await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    console.log(`  ${table.padEnd(30)} ${n}`);
  }

  console.log('\nEmpty. Now run: npm run db:seed');
}

main()
  .catch((error) => {
    console.error('\nWipe failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
