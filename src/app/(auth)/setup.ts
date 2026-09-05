import 'server-only';

import { prisma } from '@/lib/prisma';
import { createSupabaseAdminClient } from '@/lib/auth/supabase';
import {
  DEFAULT_PROJECT_ROLE_CAPABILITIES,
  DEFAULT_SYSTEM_ROLE_CAPABILITIES,
} from '@/lib/rbac';

/**
 * First-run set-up, and the single condition that governs it.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Set-up is available while, and only while, the company has NO users. The
 * first account closes the door behind itself, permanently, and after that
 * every account is created by an administrator from Settings → Users.
 *
 * This is what makes a signup button safe on a public URL. `/admin-signup` is
 * reachable by anybody who types it — the repository is public, so the address
 * is not a secret and was never treated as one. What stops a stranger creating
 * an owner account is not the obscurity of the path; it is that on any
 * deployment which has been set up, there is nothing here to do.
 *
 * ── Why the count is checked twice ────────────────────────────────────────
 * Once to decide whether to show the button and start the work, and again
 * inside the transaction that writes the row, holding an advisory lock. Two
 * people opening the page on a brand-new deployment at the same moment would
 * otherwise both read zero and both become owner. The second check is the one
 * that is actually load-bearing; the first only avoids wasted work.
 *
 * ── Why the identity is created outside the transaction ───────────────────
 * Creating a Supabase identity is a network call, and a network call inside a
 * Prisma interactive transaction holds a database connection open for the
 * length of somebody else's outage. So the identity is created first and
 * deleted again if the transaction then finds it lost the race. An orphaned
 * identity is the one state this system genuinely cannot tolerate: a Supabase
 * login that no `users` row answers for locked the live app out once already.
 */

// A constant, arbitrary, and shared by every process: the point is that they
// all queue behind the same lock.
const SETUP_LOCK = 8_712_340_001n;

export async function isSetupAvailable(): Promise<boolean> {
  try {
    return (await prisma.user.count()) === 0;
  } catch (error) {
    // An unreachable database must not render as "set-up is open". Refusing is
    // the safe direction: the worst case is an administrator who has to try
    // again, rather than a second owner on a company that already has one.
    console.warn(
      '[setup] could not read the user count:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export type SetupOutcome =
  | { ok: true }
  | { ok: false; reason: 'closed' | 'email_taken' | 'identity_failed'; message: string };

export async function createFirstAdministrator(input: {
  email: string;
  fullName: string;
  companyName: string;
  password: string;
}): Promise<SetupOutcome> {
  const email = input.email.trim().toLowerCase();

  if (!(await isSetupAvailable())) {
    return {
      ok: false,
      reason: 'closed',
      message: 'This company already has an administrator. Ask them to add you.',
    };
  }

  const admin = createSupabaseAdminClient();

  // An identity may outlive a wipe that missed it, or a previous attempt that
  // failed halfway. Reusing it is correct: a second identity for one address
  // is precisely the broken state described above.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find((identity) => identity.email?.toLowerCase() === email);

  let authId = existing?.id ?? null;
  let createdIdentity = false;

  if (authId) {
    // It exists but no profile row does, so nobody can be signing in with it.
    // Setting the password is how the person takes ownership of the address.
    const { error } = await admin.auth.admin.updateUserById(authId, {
      password: input.password,
      email_confirm: true,
    });
    if (error) {
      return { ok: false, reason: 'identity_failed', message: error.message };
    }
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
    if (error || !data?.user) {
      return {
        ok: false,
        reason: 'identity_failed',
        message: error?.message ?? 'The account could not be created.',
      };
    }
    authId = data.user.id;
    createdIdentity = true;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`;

      // The check that counts. Anything that got here first has already
      // committed its row, and this one loses.
      if ((await tx.user.count()) > 0) {
        throw new SetupRaceLost();
      }

      // ── the permission matrix ──────────────────────────────────────────
      // A missing permission row is a DENIAL, deliberately, so that a right an
      // administrator revoked cannot come back on the next deploy. The
      // consequence is that an empty `role_permissions` table is not a blank
      // slate: it is a company where nobody can do anything, including the
      // person who would grant the permissions, because the screen that grants
      // them needs one. So the defaults are laid down here if and only if
      // nothing is there. An existing matrix is somebody's decisions and is
      // never overwritten.
      if ((await tx.rolePermission.count()) === 0) {
        const rows: { scope: 'system' | 'project'; role: string; capability: string }[] = [];
        for (const [role, capabilities] of Object.entries(DEFAULT_SYSTEM_ROLE_CAPABILITIES)) {
          for (const capability of capabilities) rows.push({ scope: 'system', role, capability });
        }
        for (const [role, capabilities] of Object.entries(DEFAULT_PROJECT_ROLE_CAPABILITIES)) {
          for (const capability of capabilities) {
            rows.push({ scope: 'project', role, capability });
          }
        }
        await tx.rolePermission.createMany({
          data: rows.map((row) => ({ ...row, granted: true })),
          skipDuplicates: true,
        });
      }

      // A singleton the app reads on every page. Its absence is not fatal, but
      // the shell falls back to a placeholder name and notices have no sender,
      // which reads as a fault rather than as an empty system.
      if (!(await tx.companySettings.findFirst())) {
        await tx.companySettings.create({
          data: {
            legalCompanyName: input.companyName,
            displayCompanyName: input.companyName,
            defaultCurrency: 'AED',
            timezone: 'Asia/Dubai',
          },
        });
      }

      await tx.user.create({
        data: {
          id: authId!,
          email,
          fullName: input.fullName,
          systemRole: 'company_owner',
          canAdministerCompany: true,
          active: true,
        },
      });
    });
  } catch (error) {
    // Only an identity this call brought into existence is cleaned up. One
    // that was already there belongs to whatever put it there.
    if (createdIdentity && authId) {
      await admin.auth.admin.deleteUser(authId).catch(() => undefined);
    }

    if (error instanceof SetupRaceLost) {
      return {
        ok: false,
        reason: 'closed',
        message: 'Somebody set this company up a moment ago. Sign in instead.',
      };
    }

    // A unique-constraint collision on the email means a profile row appeared
    // between the two checks — the same story, told by Postgres.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Unique constraint')) {
      return {
        ok: false,
        reason: 'email_taken',
        message: 'That address already has an account. Sign in instead.',
      };
    }
    throw error;
  }

  return { ok: true };
}

class SetupRaceLost extends Error {
  constructor() {
    super('setup race lost');
    this.name = 'SetupRaceLost';
  }
}
