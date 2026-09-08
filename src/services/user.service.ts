import 'server-only';
import { z } from 'zod';
import type { SystemRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ConflictError, IntegrationError, NotFoundError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertCapability } from '@/services/project-access.service';
import { createSupabaseAdminClient } from '@/lib/auth/supabase';

/**
 * User administration.
 *
 * There is NO PUBLIC SIGNUP. The app is on the public internet so that site
 * engineers and PMs can reach it from their phones, which means the only thing
 * standing between the internet and the commercial data is that accounts exist
 * solely because an admin created them.
 *
 * Invited people set their own password from a Supabase link — no one, this
 * application included, ever handles it.
 */

export const inviteSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(50).optional().nullable(),
  systemRole: z.enum([
    'company_owner', 'company_admin', 'managing_director', 'operations_director',
    'commercial_director', 'commercial_manager', 'contract_administrator',
    'finance_manager', 'procurement_manager', 'standard_user', 'viewer',
  ]).default('standard_user'),
  preferredLanguage: z.enum(['en', 'ar']).default('en'),
});

/**
 * What still points at a person, and therefore what deleting them would detach.
 *
 * ── Why deletion is conditional ───────────────────────────────────────────
 * Two different things get called "remove this person", and they need
 * different answers.
 *
 * An account added by mistake — the wrong address, the wrong person, the same
 * man typed twice — has done nothing at all. Leaving a permanent
 * "Deactivated" row for it clutters the list forever and teaches everyone to
 * stop reading the status column. Those should really go.
 *
 * Somebody who has worked here is not the same case. Their name is on changes
 * they reported, notices they issued, prices they submitted, approvals they
 * gave. Delete the row and every one of those columns quietly empties: the
 * work stays, the person who did it disappears, and a claim that used to say
 * who instructed what now says nobody. That is not tidying up, it is damaging
 * the record — the exact thing an audit trail exists to prevent, done from
 * inside the app.
 *
 * So: delete is for accounts, deactivate is for people. The service decides
 * which one it is looking at by counting, rather than asking an administrator
 * to know.
 *
 * Order matters. The refusal names the first few, so the commercial references
 * come before the catch-all.
 */
const HISTORY_RELATIONS = {
  reportedChanges: 'changes they reported',
  ownedChanges: 'changes they own',
  pricingSubmitted: 'prices they submitted',
  noticesDrafted: 'notices they drafted',
  noticesIssued: 'notices they issued',
  noticesAcknowledged: 'notices they acknowledged',
  vosSubmitted: 'variation orders they submitted',
  vosResponseRecorded: 'client responses they recorded',
  invoicesIssued: 'invoices they issued',
  creditNotesIssued: 'credit notes they issued',
  paymentsRecorded: 'payments they recorded',
  approvalsDecided: 'approvals they decided',
  approvalsAssigned: 'approvals waiting on them',
  assignedTasks: 'tasks assigned to them',
  delegatedTasks: 'tasks they gave out',
  uploadedDocuments: 'documents they uploaded',
  createdProjects: 'projects they created',
  blockingBottlenecks: 'blockers recorded against them',
  activityLogs: 'entries in the activity trail',
} as const;

type HistoryRelation = keyof typeof HISTORY_RELATIONS;

const HISTORY_COUNT_SELECT = Object.fromEntries(
  Object.keys(HISTORY_RELATIONS).map((relation) => [relation, true]),
) as Record<HistoryRelation, true>;

/**
 * Plain language for what a person is still attached to. Empty means the
 * account has no history and can safely be deleted outright.
 *
 * Exported because the Users page has to show the same answer the service will
 * give. A screen offering a button the service then refuses is worse than no
 * button, and a screen hiding one that would have worked is worse again.
 */
export function describeUserHistory(
  counts: Partial<Record<HistoryRelation, number>>,
): string[] {
  return (Object.keys(HISTORY_RELATIONS) as HistoryRelation[])
    .filter((relation) => (counts[relation] ?? 0) > 0)
    .map((relation) => `${counts[relation]} ${HISTORY_RELATIONS[relation]}`);
}

export async function listUsers(user: AuthenticatedUser) {
  await assertCapability(user, 'user.manage');
  return prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { fullName: 'asc' }],
    include: {
      memberships: {
        where: { active: true },
        select: { projectRole: true, project: { select: { id: true, projectCode: true } } },
      },
      // So the page can say, per row, whether Delete is honest here.
      _count: { select: HISTORY_COUNT_SELECT },
    },
  });
}

export async function inviteUser(actor: AuthenticatedUser, input: z.infer<typeof inviteSchema>) {
  await assertCapability(actor, 'user.manage');

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('A user with that email already exists');

  const supabase = createSupabaseAdminClient();

  /*
    Create the identity WITHOUT sending anything.

    This was `inviteUserByEmail`, which sends an invitation — and Supabase's
    built-in mailer is rate limited to a handful of messages an hour on every
    project that has not been given its own SMTP. Adding a team of seven in one
    sitting therefore failed partway through with "email rate limit exceeded",
    and the account was not created at all: the limit is enforced before the
    identity is written, so the failure is total rather than partial.

    Worse, the email was on the critical path for something it was not needed
    for. An administrator adding people is sitting at the screen. Whether a
    message leaves at that moment has nothing to do with whether the account
    should exist.

    So creation and credentials are now two separate steps, and only the second
    one can involve email:

      1. here — the account exists, confirmed, with no password and nothing sent
      2. Settings → Users → Set password  (instant, no email)
         or  Email a reset link           (email, and may be rate limited)

    `email_confirm: true` because there is no invitation to click. Supabase
    refuses password sign-in for an unconfirmed address, which is exactly the
    fault fixed on 2026-09-08; an account created here and given a password
    would otherwise be unusable in the same way.
  */
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (error || !data.user) {
    throw new IntegrationError(`Could not create the identity: ${error?.message ?? 'unknown error'}`);
  }

  // The Supabase identity and our profile row share an id. If this insert
  // fails the identity is orphaned, so it is created immediately and the
  // failure surfaces rather than being swallowed.
  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id: data.user!.id,
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        systemRole: input.systemRole,
        preferredLanguage: input.preferredLanguage,
        active: true,
      },
    });

    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: created.id,
      actionType: 'invited',
      newValue: { email: created.email, systemRole: created.systemRole },
    });

    return created;
  });
}

/**
 * The shortest password an administrator may set on somebody's behalf.
 *
 * Twelve, not eight. A password set by one person for another gets read aloud
 * across a site office and typed into a phone, so it will be shared whatever
 * the policy says — the only defence is that it is long enough to survive
 * being guessed by somebody who heard half of it.
 */
/*
  Osman's call, 2026-09-08: no length rule of our own.

  This was 12, which is a good password and a bad rule for this product. The
  people being given accounts are site engineers and project managers who are
  handed a password by an administrator standing next to them, and a rule they
  cannot satisfy is answered by writing something down, not by choosing better.

  The floor that remains is Supabase's, set in the project's Auth settings and
  6 characters by default. It cannot be turned off from here and this deliberately
  does not try — a password that our schema accepts and the provider then rejects
  is the worst of the three options, because the administrator sees a failure
  with no rule attached to it.
*/
const MIN_PASSWORD_LENGTH = 1;

export const passwordResetSchema = z.object({
  userId: z.string().uuid(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, 'Enter a password')
    .max(72, 'Too long — 72 characters is the limit'),
});

/**
 * An administrator setting a new password for a member of staff.
 *
 * ── Why "set", and never "show" ────────────────────────────────────────────
 * Osman asked to see existing passwords. There is nothing to see: Supabase
 * stores a one-way hash, so the plaintext does not exist anywhere in this
 * system or in the identity provider, and no permission could reveal it. That
 * is a property worth keeping rather than a gap to close — a system that CAN
 * show a password is a system where one leaked administrator account exposes
 * every account at once. Setting a new one solves the real problem, which is
 * a man locked out on a Friday afternoon, without creating that one.
 *
 * ── What is recorded ───────────────────────────────────────────────────────
 * That it happened, by whom, to whom, and when. Never the password, not in the
 * audit trail, not in a log line, not in the value returned to the caller. The
 * audit row is what makes this safe to hand to an administrator: the authority
 * to reset an account is also the authority to impersonate its owner, so every
 * use of it has to be visible to the person it was used on.
 */
export async function resetUserPassword(
  actor: AuthenticatedUser,
  input: z.infer<typeof passwordResetSchema>,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, fullName: true, active: true },
  });
  if (!target) throw new NotFoundError('User not found');

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(target.id, {
    password: input.password,
    /*
      Confirm the address in the same call, and this is the whole fix for a
      fault that made every invited account unusable.

      `inviteUserByEmail` creates an identity that is NOT confirmed; it becomes
      confirmed when the person clicks the link in the invitation. Supabase
      refuses `signInWithPassword` for an unconfirmed address. So an
      administrator who set a password here — the documented remedy when the
      email is slow, and Supabase's own mailer is rate limited to a handful an
      hour — produced an account with a valid password that could not sign in.
      Worse, the login screen answers "those details do not match an account"
      for every failure, so it read as a mistyped password and sent people
      hunting the wrong thing.

      Setting it here is correct rather than a shortcut: an administrator
      typing somebody's password IS the out-of-band verification that the
      confirmation email exists to perform. They created the account, they know
      who the person is, and they are handing the password over in person or by
      a channel they already trust. There is nothing left for the email to
      prove.
    */
    email_confirm: true,
  });

  if (error) {
    /*
      Say what the provider actually objected to.

      This used to answer every failure with "check it meets the provider
      policy", on the reasoning that the message might quote the password back.
      That was defensible while we had a rule of our own to state up front; now
      that Supabase's setting is the ONLY rule, a refusal with no reason
      attached leaves an administrator guessing at a number they were never
      told — and the commonest one, "Password should be at least 6 characters",
      is exactly the sentence they need.

      The password is stripped from the message before it goes anywhere, which
      costs nothing and removes the original objection.
    */
    const detail = error.message.split(input.password).join('•••');
    throw new IntegrationError(`Could not set the password. ${detail}`);
  }

  await recordAudit({
    db: prisma,
    userId: actor.id,
    recordType: 'user',
    recordId: target.id,
    actionType: 'updated',
    // Deliberately no `oldValue`/`newValue` carrying anything about the
    // secret. The fact and the actor are the record.
    newValue: { passwordReset: true, email: target.email },
  });

  return { email: target.email, fullName: target.fullName };
}

/**
 * Sending somebody the link to set their own password.
 *
 * The better of the two whenever the person is reachable: the administrator
 * never learns the password, so there is nothing to be overheard, written on a
 * whiteboard, or reused on the man's personal email.
 */
export async function sendPasswordResetLink(actor: AuthenticatedUser, userId: string) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true },
  });
  if (!target) throw new NotFoundError('User not found');

  const supabase = createSupabaseAdminClient();
  const env = getEnv();

  const { error } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${env.APP_URL}/set-password`,
  });
  if (error) throw new IntegrationError(`Could not send the link: ${error.message}`);

  await recordAudit({
    db: prisma,
    userId: actor.id,
    recordType: 'user',
    recordId: target.id,
    actionType: 'updated',
    newValue: { passwordResetLinkSent: true, email: target.email },
  });

  return { email: target.email, fullName: target.fullName };
}

export async function setUserActive(
  actor: AuthenticatedUser,
  userId: string,
  active: boolean,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  // Locking yourself out of the only admin account is a support call, not a
  // feature. The check is cheap.
  if (!active && userId === actor.id) {
    throw new ConflictError('You cannot deactivate your own account');
  }
  if (!active && target.canAdministerCompany) {
    await assertAnotherAdminRemains(userId);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: { active } });
    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: active ? 'activated' : 'deactivated',
      oldValue: { active: target.active },
      newValue: { active },
    });
    return updated;
  });
}

/**
 * Removing an account from the company for good.
 *
 * ── The order of the two deletes is the whole safety argument ─────────────
 * A person exists in two places: a Supabase Auth identity, which is what can
 * sign in, and our `users` row, which is what the app knows about them.
 * Deleting them in the wrong order has already bricked this deployment once —
 * a row removed while its identity survived left somebody who could
 * authenticate but had no profile, and every page they touched died on the
 * missing record, including the ones an administrator needed to fix it.
 *
 * So the sign-in goes first. If the second half then fails, what is left is a
 * profile row that can no longer sign in — inert, visible in this list, and
 * removable by pressing the button again. That is the survivable direction,
 * and it is why this is not one transaction: a network call to Supabase does
 * not belong inside a database transaction, and rolling back Postgres would
 * not bring the identity back anyway.
 *
 * ── What it refuses ───────────────────────────────────────────────────────
 * Yourself, the last administrator, and anyone the commercial record still
 * points at — see HISTORY_RELATIONS above for why that last one is a refusal
 * rather than a warning. Deactivation is the answer in that case and the
 * message says so.
 */
export async function deleteUser(actor: AuthenticatedUser, userId: string) {
  await assertCapability(actor, 'user.manage');

  if (userId === actor.id) {
    throw new ConflictError('You cannot delete your own account');
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: { _count: { select: HISTORY_COUNT_SELECT } },
  });
  if (!target) throw new NotFoundError('User not found');

  if (target.canAdministerCompany) await assertAnotherAdminRemains(userId);

  const history = describeUserHistory(target._count);
  if (history.length > 0) {
    throw new ConflictError(
      `${target.fullName} has worked on this system — ${history.join(', ')}. ` +
        'Deleting the account would take their name off all of it. Deactivate them ' +
        'instead: they lose access immediately and the record still says who did what.',
    );
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error && !/not.?found/i.test(error.message)) {
    // Already gone is not a failure — that is the half-finished state this
    // ordering is designed to let an administrator finish.
    throw new IntegrationError(`Could not remove the sign-in: ${error.message}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id: userId } });

    // Written AFTER the row is gone, and attributed to the administrator, so
    // the trail outlives the account. `recordId` keeps the id, which is what
    // ties this to the row that created it.
    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: 'deleted',
      oldValue: {
        email: target.email,
        fullName: target.fullName,
        systemRole: target.systemRole,
      },
    });
  });

  return { fullName: target.fullName, email: target.email };
}

/**
 * Moving a WhatsApp number from one person to another.
 *
 * ── Why it has to be doable from the app ──────────────────────────────────
 * A number was only settable at invite. When the handset changed hands — the
 * site phone passed to a new engineer, a demo number moved onto somebody
 * else's account — the only way to follow it was a database query, so in
 * practice nobody did, and every WhatsApp report went on being filed under the
 * name of whoever held the number first. Osman, 2026-09-05.
 *
 * ── Why it is not simply a text field ─────────────────────────────────────
 * The number IS the identity on WhatsApp. Everything that arrives from that
 * handset is filed under whoever holds it, so two people holding the same one
 * is not a duplicate record, it is a wrong name on a claim.
 *
 * The capture path already refuses to guess between them — an ambiguous number
 * parks the message instead of picking a colleague at random — but that is a
 * safety net, and a safety net that catches everything means nothing works. So
 * the number is TAKEN, not copied: moving it onto somebody clears it from the
 * person who had it, in one transaction, and both halves are audited.
 */
export const phoneSchema = z.object({
  // Digits, spaces and the punctuation people actually type. Deliberately not
  // a strict E.164 rule: a number typed as "+971 50 123 4567" is the same
  // number, and rejecting it teaches the administrator that the field is
  // fussy rather than that the number is wrong.
  phone: z
    .string()
    .trim()
    .max(50)
    .regex(/^[+()\d\s.-]*$/, 'Digits, spaces, + ( ) - and . only')
    .transform((value) => value.replace(/[^+\d]/g, ''))
    .refine((value) => value === '' || /^\+?\d{7,15}$/.test(value), 'That is not a phone number'),
});

export async function setUserPhone(
  actor: AuthenticatedUser,
  userId: string,
  rawPhone: string,
) {
  await assertCapability(actor, 'user.manage');

  const { phone } = phoneSchema.parse({ phone: rawPhone });
  const value = phone === '' ? null : phone;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  return prisma.$transaction(async (tx) => {
    // Taken from whoever else holds it, in the same transaction as the grant.
    // Two people on one number means every WhatsApp from it is parked as
    // ambiguous, and a number that works for nobody is worse than either
    // person having it.
    const takenFrom = value
      ? await tx.user.findMany({
          where: { phone: value, id: { not: userId } },
          select: { id: true, fullName: true },
        })
      : [];

    if (takenFrom.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: takenFrom.map((user) => user.id) } },
        data: { phone: null },
      });
      for (const previous of takenFrom) {
        await recordAudit({
          db: tx,
          userId: actor.id,
          recordType: 'user',
          recordId: previous.id,
          actionType: 'updated',
          oldValue: { phone: value },
          newValue: { phone: null },
          metadata: { movedTo: userId },
        });
      }
    }

    const updated = await tx.user.update({ where: { id: userId }, data: { phone: value } });

    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: 'updated',
      oldValue: { phone: target.phone },
      newValue: { phone: value },
      metadata: takenFrom.length > 0 ? { takenFrom: takenFrom.map((u) => u.fullName) } : undefined,
    });

    return { user: updated, takenFrom: takenFrom.map((user) => user.fullName) };
  });
}

export async function setSystemRole(
  actor: AuthenticatedUser,
  userId: string,
  systemRole: SystemRole,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: { systemRole } });
    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: 'updated',
      oldValue: { systemRole: target.systemRole },
      newValue: { systemRole },
    });
    return updated;
  });
}

/** Company-wide user list for assignment pickers. Not the admin view. */
export async function listAssignableUsers() {
  return prisma.user.findMany({
    where: { active: true },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, email: true, systemRole: true },
  });
}

/**
 * Company administration, granted and revoked as a flag.
 *
 * Deliberately not a system role. Whoever administers the app is chosen by the
 * company and their job is usually something else — often the Finance Manager.
 * Folding the two together forced a false choice between recording what someone
 * does and recording that they hold the keys.
 */
export async function setCompanyAdmin(
  actor: AuthenticatedUser,
  userId: string,
  canAdministerCompany: boolean,
) {
  await assertCapability(actor, 'user.manage');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError('User not found');

  if (!canAdministerCompany) await assertAnotherAdminRemains(userId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { canAdministerCompany },
    });
    await recordAudit({
      db: tx,
      userId: actor.id,
      recordType: 'user',
      recordId: userId,
      actionType: 'updated',
      oldValue: { canAdministerCompany: target.canAdministerCompany },
      newValue: { canAdministerCompany },
    });
    return updated;
  });
}

/**
 * A company with no administrator cannot invite anyone, cannot change a
 * permission, and cannot recover without a database client and someone who
 * knows what a UUID is. There is no undo, so the check is a refusal.
 */
async function assertAnotherAdminRemains(excludingUserId: string): Promise<void> {
  const others = await prisma.user.count({
    where: { canAdministerCompany: true, active: true, id: { not: excludingUserId } },
  });
  if (others === 0) {
    throw new ConflictError(
      'This is the only company administrator. Give someone else administration first.',
    );
  }
}
