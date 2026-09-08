/**
 * Fill in the rest of the company: the remaining staff, the remaining
 * projects, their teams, their clients and their contract rules.
 *
 * ── Why this goes through the SERVICES and not through Prisma ─────────────
 * Because the point is to end up with data the application itself would have
 * produced. Every write here runs the same capability check, the same Zod
 * schema and the same audit write as the equivalent click, so what comes out
 * is a company that behaves like one somebody set up by hand — not a database
 * that merely looks like one until the first rule fires against it.
 *
 * ── Idempotent by design ──────────────────────────────────────────────────
 * Osman has already added three people and one project. Everything below
 * checks before it writes and reports what it skipped, so running it twice
 * costs nothing and adds nothing.
 *
 * ── No passwords ──────────────────────────────────────────────────────────
 * Accounts are created with no password and no email sent — his instruction,
 * and what `inviteUser` now does anyway. He sets each one from Settings →
 * Users when he is ready.
 *
 *     npx tsx --env-file=.env scripts/provision.ts
 */
import { PrismaClient } from '@prisma/client';
import type { AuthenticatedUser } from '../src/lib/auth/provider';
import { inviteUser } from '../src/services/user.service';
import { createProject, updateContractRules } from '../src/services/project.service';
import { assignMember } from '../src/services/project-member.service';
import { createContact } from '../src/services/contact.service';

const prisma = new PrismaClient();

// ── the cast, from TEST-PLAN.md ────────────────────────────────────────────
const STAFF = [
  { fullName: 'Abdelmoneim', email: 'osman.constructionsystems@hotmail.com', systemRole: 'standard_user' },
  { fullName: 'Hashim',      email: 'mohammedosman2400@outlook.com',        systemRole: 'standard_user' },
  { fullName: 'Ahmed',       email: 'org3700@gmail.com',                    systemRole: 'standard_user' },
  { fullName: 'Hassan',      email: 'mohammedossidahmed@gmail.com',         systemRole: 'standard_user' },
] as const;

const QS_EMAIL = 'guided369@gmail.com';

/**
 * Two clients, two projects each; each PM and each site engineer carries two.
 * That shape is deliberate — it is the smallest arrangement that can prove a
 * person on one project cannot reach another.
 *
 * The contract rules differ ON PURPOSE. Four projects with identical terms
 * would pass every test while proving only that one set of numbers works.
 */
const PROJECTS = [
  {
    projectCode: 'DXB-001', projectName: 'DIFC Gate Avenue Office Fit-Out',
    clientName: 'Mohammed Hassan', projectLocation: 'DIFC, Dubai',
    originalContractValue: 4_250_000, client: 1,
    pm: 'osman.constructionsystems@hotmail.com', se: 'org3700@gmail.com',
    rules: {},
  },
  {
    projectCode: 'DXB-002', projectName: 'Dubai Hills Mall Flagship Retail',
    clientName: 'Mohammed Hassan', projectLocation: 'Dubai Hills, Dubai',
    originalContractValue: 2_800_000, client: 1,
    pm: 'osman.constructionsystems@hotmail.com', se: 'org3700@gmail.com',
    // A 14-day notice period. Half the default, and the reason a deadline test
    // on this project must not pass by accident.
    rules: { noticePeriodDays: 14 },
  },
  {
    projectCode: 'AUH-003', projectName: 'Al Maryah Clinic Interior Works',
    clientName: 'Mohammed Yasseen', projectLocation: 'Al Maryah Island, Abu Dhabi',
    originalContractValue: 6_100_000, client: 2,
    pm: 'mohammedosman2400@outlook.com', se: 'mohammedossidahmed@gmail.com',
    rules: { voResponseDays: 21, clientFollowUpDays: 14 },
  },
  {
    projectCode: 'DXB-004', projectName: 'Business Bay Serviced Apartments',
    clientName: 'Mohammed Yasseen', projectLocation: 'Business Bay, Dubai',
    originalContractValue: 9_400_000, client: 2,
    pm: 'mohammedosman2400@outlook.com', se: 'mohammedossidahmed@gmail.com',
    // Chasing OFF. Some clients are chased by the commercial manager in person
    // and an automated email would embarrass him; the system has to be able to
    // stay quiet, and this project is how that is proved.
    rules: { clientFollowUpEnabled: false },
  },
] as const;

const CLIENTS = {
  1: { fullName: 'Mohammed Hassan',  email: 'mo@mohammedosman.studio',      companyName: 'Hassan Holdings' },
  2: { fullName: 'Mohammed Yasseen', email: 'mohammed@osmansidahmed.com',   companyName: 'Yasseen Developments' },
} as const;

async function main() {
  const owner = await prisma.user.findFirst({ where: { systemRole: 'company_owner', active: true } });
  if (!owner) throw new Error('No active company owner. Run the set-up first.');

  const actor: AuthenticatedUser = {
    id: owner.id, email: owner.email, fullName: owner.fullName,
    systemRole: owner.systemRole, canAdministerCompany: owner.canAdministerCompany,
    active: owner.active, preferredLanguage: owner.preferredLanguage,
  };
  console.log(`acting as ${actor.fullName} <${actor.email}>\n`);

  // ── people ───────────────────────────────────────────────────────────────
  console.log('── staff');
  for (const person of STAFF) {
    const existing = await prisma.user.findUnique({ where: { email: person.email } });
    if (existing) { console.log(`   skip   ${person.fullName} — already there`); continue; }
    await inviteUser(actor, { ...person, preferredLanguage: 'en' } as never);
    console.log(`   added  ${person.fullName.padEnd(14)} ${person.email}`);
  }

  const byEmail = new Map(
    (await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
  );
  const qsId = byEmail.get(QS_EMAIL);

  // ── projects, teams, clients, rules ──────────────────────────────────────
  for (const p of PROJECTS) {
    console.log(`\n── ${p.projectCode}  ${p.projectName}`);

    let project = await prisma.project.findUnique({ where: { projectCode: p.projectCode } });
    if (project) {
      console.log('   skip   project — already there');
    } else {
      project = await createProject(actor, {
        projectCode: p.projectCode, projectName: p.projectName, clientName: p.clientName,
        projectLocation: p.projectLocation, originalContractValue: p.originalContractValue,
        currency: 'AED', projectStatus: 'active',
      } as never);
      console.log('   added  project');
    }

    // team
    const team: [string | undefined, string][] = [
      [byEmail.get(p.pm), 'project_manager'],
      [byEmail.get(p.se), 'site_engineer'],
      [qsId, 'quantity_surveyor'],
    ];
    for (const [userId, projectRole] of team) {
      if (!userId) { console.log(`   MISS   no user for ${projectRole}`); continue; }
      const already = await prisma.projectMember.findFirst({
        where: { projectId: project.id, userId, active: true },
      });
      if (already) { console.log(`   skip   ${projectRole} — already on`); continue; }
      // The PM and the site engineer are told when a change lands. The QS is
      // not: he is pulled in when there is something to price, by a task.
      await assignMember(actor, {
        projectId: project.id, userId, projectRole,
        notifyOnChange: projectRole !== 'quantity_surveyor',
      } as never);
      console.log(`   added  ${projectRole}`);
    }

    // the client contact
    const c = CLIENTS[p.client];
    const hasContact = await prisma.contact.findFirst({
      where: { projectId: project.id, email: c.email },
    });
    if (hasContact) {
      console.log('   skip   client contact — already there');
    } else {
      await createContact(actor, {
        projectId: project.id, fullName: c.fullName, email: c.email,
        companyName: c.companyName, jobTitle: 'Client Representative',
        contactType: 'client',
        /*
          Authority, stated rather than assumed. He may ask for a change and
          approve both cost and time, because he is the client. He may NOT
          issue a technical instruction — that is the consultant's to give —
          and every one of these is a claim somebody will test in a dispute.
        */
        authorityVerified: true,
        canRequestChange: true, canInstructWork: true,
        canApproveCost: true, canApproveTime: true, canSignFinalVo: true,
        canIssueTechnicalInstruction: false,
      } as never);
      console.log(`   added  client contact ${c.fullName}`);
    }

    // contract rules — only where this project differs from the defaults
    if (Object.keys(p.rules).length > 0) {
      await updateContractRules(actor, project.id, p.rules as never);
      console.log(`   set    rules ${JSON.stringify(p.rules)}`);
    }
  }

  console.log('\nDone. Passwords are yours to set: Settings → Users → Set password.');
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
