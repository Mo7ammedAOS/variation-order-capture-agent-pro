/**
 * An empty system that somebody can actually log into.
 *
 * ── Why this exists beside the wipe ───────────────────────────────────────
 * `wipe.ts` empties everything, and everything includes `role_permissions` and
 * `company_settings`. A missing permission row is a DENIAL — deliberately, so
 * that a right an administrator revoked cannot come back on the next deploy —
 * so a freshly wiped database is not a blank system waiting to be set up. It is
 * a system where nobody can do anything, including the person who would grant
 * the permissions, because the screen that grants them needs one.
 *
 * And `seed.ts` is the opposite problem: it fills the database with a fictional
 * contractor, five projects and twenty changes. Useful for a demo, useless when
 * the point is to build a real company by hand and watch every step work.
 *
 * So: this restores the two things that must exist before a human can start,
 * and one account for that human. Nothing else. No projects, no contacts, no
 * changes — those are the test.
 *
 *     npm run db:bootstrap -- --email you@company.com --name "Your Name"
 *
 * ── The password is never printed and never chosen here ───────────────────
 * The identity is created with an unguessable throwaway and an invitation is
 * emailed. The person clicks it and sets their own. A password echoed into a
 * terminal ends up in a scrollback, a screenshot, or a chat window, and this
 * account is the one that can do everything.
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_PROJECT_ROLE_CAPABILITIES,
  DEFAULT_SYSTEM_ROLE_CAPABILITIES,
} from '../src/lib/rbac';

const prisma = new PrismaClient();

function arg(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] ?? null;
  const inline = process.argv.find((value) => value.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const fullName = arg('name')?.trim() ?? 'Administrator';
  const companyName = arg('company')?.trim() ?? 'Your Company';

  if (!email) {
    console.error('Who is the first account for?');
    console.error('  npm run db:bootstrap -- --email you@company.com --name "Your Name"');
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('No Supabase credentials. The account could be created and never logged into.');
    process.exitCode = 1;
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── the permission matrix ────────────────────────────────────────────────
  // Restored from the code defaults, which is exactly what the "reset to
  // defaults" button on the permissions screen does. Written first, because
  // everything below this line is checked against it.
  const rows: { scope: 'system' | 'project'; role: string; capability: string }[] = [];
  for (const [role, capabilities] of Object.entries(DEFAULT_SYSTEM_ROLE_CAPABILITIES)) {
    for (const capability of capabilities) rows.push({ scope: 'system', role, capability });
  }
  for (const [role, capabilities] of Object.entries(DEFAULT_PROJECT_ROLE_CAPABILITIES)) {
    for (const capability of capabilities) rows.push({ scope: 'project', role, capability });
  }

  await prisma.rolePermission.deleteMany({});
  await prisma.rolePermission.createMany({
    data: rows.map((row) => ({ ...row, granted: true })),
    skipDuplicates: true,
  });
  console.log(`permissions restored: ${rows.length}`);

  // ── company settings ─────────────────────────────────────────────────────
  // A singleton the app reads on every page. Its absence is not fatal, but the
  // shell falls back to a placeholder name and the notice templates have no
  // sender, which looks like a fault rather than an empty system.
  const settings = await prisma.companySettings.findFirst();
  if (!settings) {
    await prisma.companySettings.create({
      data: {
        legalCompanyName: companyName,
        displayCompanyName: companyName,
        defaultCurrency: 'AED',
        timezone: 'Asia/Dubai',
      },
    });
    console.log(`company settings created: ${companyName}`);
  } else {
    console.log('company settings already present, left alone');
  }

  // ── the first account ────────────────────────────────────────────────────
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`${email} already exists. Nothing created.`);
    console.log('Use "Email a reset link" on Settings → Users if the password is lost.');
    return;
  }

  // An identity may survive a wipe that missed it. Reusing it is correct and
  // necessary: two identities for one address is the state that bricked the
  // live app once, because middleware trusted a token the tables knew nothing
  // about.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 500 });
  const found = list?.users?.find((identity) => identity.email?.toLowerCase() === email);

  let authId = found?.id ?? null;
  if (!authId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      // Never used and never printed. The invitation below is how they get in.
      password: randomBytes(24).toString('base64url'),
      email_confirm: true,
    });
    if (error || !data?.user) {
      console.error(`Could not create the identity: ${error?.message ?? 'unknown'}`);
      process.exitCode = 1;
      return;
    }
    authId = data.user.id;
  } else {
    console.log('reused the existing Supabase identity for this address');
  }

  await prisma.user.create({
    data: {
      id: authId,
      email,
      fullName,
      systemRole: 'company_owner',
      canAdministerCompany: true,
      active: true,
    },
  });

  const { error: linkError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
      : undefined,
  });

  console.log(`\nowner created: ${fullName} <${email}>`);
  console.log(
    linkError
      ? `!! Could not send the set-password email: ${linkError.message}\n   Use Settings → Users → Password once you are in, or send it again from Supabase.`
      : 'A set-password email is on its way to that address. Follow it, then sign in.',
  );
  console.log('\nEverything else — projects, people, contacts — is the test. Follow TEST-PLAN.md.');
}

main()
  .catch((error) => {
    console.error('\nBootstrap failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
