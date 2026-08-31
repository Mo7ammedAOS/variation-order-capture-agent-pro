import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { CHANGES, COMPANY, CONTACTS, DOCUMENT_TEMPLATES, PROJECTS, USERS } from './seed-data';

/**
 * Seeds one UAE fit-out deployment: ABC Fit-Out.
 *
 * Idempotent — safe to re-run. Everything is upserted on a natural key, so a
 * second run updates rather than duplicating.
 *
 * Supabase identities are created when a service role key is present. Without
 * one the profile rows are still seeded with generated ids, so the data is
 * browsable, but nobody can sign in. That is stated loudly at the end rather
 * than left to be discovered at the login screen.
 */

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2026';

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes('placeholder') || key.includes('placeholder')) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function main() {
  console.log('Seeding ABC Fit-Out…\n');

  await prisma.companySettings.upsert({
    where: { singleton: true },
    create: { singleton: true, ...COMPANY },
    update: COMPANY,
  });
  console.log(`  company    ${COMPANY.displayCompanyName}`);

  // ── users ────────────────────────────────────────────────────────────────
  const admin = supabaseAdmin();
  const userIds = new Map<string, string>();

  for (const user of USERS) {
    let id: string | undefined;

    if (admin) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: user.fullName },
      });

      if (data?.user) {
        id = data.user.id;
      } else if (error) {
        // Already there from a previous run — find them rather than failing.
        const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
        id = list?.users.find((u) => u.email === user.email)?.id;
        if (!id) throw new Error(`Could not create or find ${user.email}: ${error.message}`);
      }
    }

    const existing = await prisma.user.findUnique({ where: { email: user.email } });
    id ??= existing?.id ?? randomUUID();

    await prisma.user.upsert({
      where: { email: user.email },
      create: {
        id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        systemRole: user.systemRole,
        canAdministerCompany: user.canAdministerCompany ?? false,
        active: true,
      },
      update: {
        fullName: user.fullName,
        phone: user.phone,
        systemRole: user.systemRole,
        canAdministerCompany: user.canAdministerCompany ?? false,
      },
    });

    userIds.set(user.key, id);
  }
  console.log(`  users      ${USERS.length}`);

  // ── projects, rules, members ─────────────────────────────────────────────
  const projectIds = new Map<string, string>();

  for (const project of PROJECTS) {
    const record = await prisma.project.upsert({
      where: { projectCode: project.code },
      create: {
        projectCode: project.code,
        projectName: project.name,
        clientName: project.client,
        consultantName: project.consultant,
        projectLocation: project.location,
        contractNumber: project.contractNumber,
        contractStartDate: daysAgo(180),
        contractCompletionDate: addDays(new Date(), 180),
        originalContractValue: project.value,
        currency: 'AED',
        projectStatus: 'active',
        createdByUserId: userIds.get('md') ?? null,
      },
      update: { projectName: project.name, clientName: project.client },
    });
    projectIds.set(project.code, record.id);

    await prisma.projectContractRule.upsert({
      where: { projectId: record.id },
      create: {
        projectId: record.id,
        contractType: 'FIDIC Red Book 1999 (amended)',
        contractClauseReference: 'Clause 20.1',
        noticePeriodDays: project.noticePeriodDays,
        detailedClaimPeriodDays: project.noticePeriodDays + 14,
        noticeDeliveryMethod: 'Email with acknowledgement',
        noticeRecipientCompany: project.consultant,
        eotAssessmentRequired: true,
        approvalThresholdPm: 50_000,
        approvalThresholdCm: 250_000,
        approvalThresholdCommercialDirector: 750_000,
        approvalThresholdManagingDirector: 2_000_000,
        highRiskVoValue: 500_000,
      },
      update: { noticePeriodDays: project.noticePeriodDays },
    });

    for (const member of project.members) {
      const userId = userIds.get(member.userKey);
      if (!userId) continue;
      await prisma.projectMember.upsert({
        where: {
          projectId_userId_projectRole: {
            projectId: record.id,
            userId,
            projectRole: member.role,
          },
        },
        create: { projectId: record.id, userId, projectRole: member.role, active: true },
        update: { active: true },
      });
    }
  }
  console.log(`  projects   ${PROJECTS.length}`);

  // ── sample content ───────────────────────────────────────────────────────
  //
  // Everything below is EXAMPLE DATA: invented client contacts, twenty
  // variations that never happened, tasks nobody was really given. It is off by
  // default.
  //
  // A brand-new deployment wants the configuration — the company, the people,
  // the projects, who is on what — and nothing else. Fictional changes in a
  // commercial register are worse than an empty one: they train people to
  // ignore what is on the screen, and the first real variation arrives into a
  // list they have already learned to scroll past.
  //
  //     npm run db:seed                        configuration only
  //     SEED_SAMPLE_CONTENT=true npm run db:seed   plus the examples
  if (process.env.SEED_SAMPLE_CONTENT === 'true') {
    // ── contacts ─────────────────────────────────────────────────────────────
    for (const contact of CONTACTS) {
      const projectId = projectIds.get(contact.projectCode);
      if (!projectId) continue;

      const exists = await prisma.contact.findFirst({
        where: { projectId, fullName: contact.fullName },
      });
      const data = {
        projectId,
        fullName: contact.fullName,
        companyName: contact.companyName,
        jobTitle: contact.jobTitle,
        contactType: contact.contactType,
        authorityVerified: contact.verified,
        canRequestChange: contact.canRequest,
        canIssueTechnicalInstruction: contact.canInstruct,
        canInstructWork: contact.canInstruct,
        canApproveCost: contact.canApproveCost,
        canApproveTime: contact.canApproveCost,
        canSignFinalVo: contact.canSign,
      };
      if (exists) await prisma.contact.update({ where: { id: exists.id }, data });
      else await prisma.contact.create({ data });
    }
    console.log(`  contacts   ${CONTACTS.length}`);

    // ── documents ────────────────────────────────────────────────────────────
    let documentCount = 0;
    for (const project of PROJECTS.slice(0, 3)) {
      const projectId = projectIds.get(project.code);
      if (!projectId) continue;

      for (const template of DOCUMENT_TEMPLATES) {
        const name = `${project.code} — ${template.name}`;
        const exists = await prisma.projectDocument.findFirst({ where: { projectId, documentName: name } });
        if (exists) { documentCount += 1; continue; }

        await prisma.projectDocument.create({
          data: {
            projectId,
            documentType: template.type,
            documentName: name,
            documentNumber: template.number,
            revisionNumber: template.revision,
            issueDate: daysAgo(120),
            // Registered by reference. No bytes are invented — a seeded file that
            // 404s on click is worse than an honest link-only record.
            sourceUrl: `https://drive.example.com/${project.code}/${template.number ?? 'doc'}`,
            uploadedByUserId: userIds.get('md') ?? null,
            sourceChannel: 'document_upload',
          },
        });
        documentCount += 1;
      }
    }
    console.log(`  documents  ${documentCount}`);

    // ── potential changes, tasks ─────────────────────────────────────────────
    let changeCount = 0;
    let taskCount = 0;

    for (const change of CHANGES) {
      const projectId = projectIds.get(change.projectCode);
      const project = PROJECTS.find((p) => p.code === change.projectCode);
      if (!projectId || !project) continue;

      const existing = await prisma.potentialChange.findFirst({
        where: { projectId, title: change.title },
      });
      if (existing) { changeCount += 1; continue; }

      const [bumped] = await prisma.$queryRaw<{ pc_sequence: number }[]>`
        UPDATE projects SET pc_sequence = pc_sequence + 1
        WHERE id = ${projectId}::uuid RETURNING pc_sequence
      `;
      const sequence = bumped?.pc_sequence ?? 1;
      const pcNumber = `PC-${project.code}-${String(sequence).padStart(4, '0')}`;

      const eventDate = daysAgo(change.daysAgo);
      const noticeDueDate = addDays(eventDate, project.noticePeriodDays);
      const daysRemaining = Math.round((noticeDueDate.getTime() - Date.now()) / 86_400_000);
      const riskLevel = daysRemaining < 0 ? 'red' : daysRemaining <= 7 ? 'amber' : 'green';

      const cm = project.members.find((m) => m.role === 'commercial_manager');
      const pm = project.members.find((m) => m.role === 'project_manager');
      const qs = project.members.find((m) => m.role === 'quantity_surveyor');
      const se = project.members.find((m) => m.role === 'site_engineer');

      const ownerKey = cm?.userKey ?? pm?.userKey;
      const ownerId = ownerKey ? (userIds.get(ownerKey) ?? null) : null;

      // A spread of stages, so the dashboards and the bottleneck sweep have
      // something realistic to work with rather than twenty identical rows.
      const assessed = change.daysAgo > 20;
      const contact = CONTACTS.find((c) => c.projectCode === change.projectCode);
      const contactRecord = contact
        ? await prisma.contact.findFirst({ where: { projectId, fullName: contact.fullName } })
        : null;

      const created = await prisma.potentialChange.create({
        data: {
          projectId,
          pcNumber,
          title: change.title,
          description: change.description,
          eventDate,
          captureDate: addDays(eventDate, 1),
          location: change.location,
          trade: change.trade,
          workStatus: change.workStarted ? 'in_progress' : 'not_started',
          estimatedValue: change.estimatedValue,
          potentialTimeImpact: change.timeImpact,
          sourceType: change.source,
          sourceSenderName: contact?.fullName ?? null,
          sourceSenderAuthorityStatus: contact?.verified ? 'authorised' : 'unknown',
          requestedByContactId: contactRecord?.id ?? null,
          reportedByUserId: se ? (userIds.get(se.userKey) ?? null) : ownerId,
          currentStatus: assessed ? 'qs_pricing' : 'notice_assessment',
          currentOwnerUserId: assessed && qs ? (userIds.get(qs.userKey) ?? ownerId) : ownerId,
          waitingFor: assessed ? 'QS pricing' : 'Notice assessment',
          nextAction: assessed
            ? 'Price the change'
            : 'Assess whether a contractual notice is required',
          nextActionDueDate: addDays(eventDate, assessed ? 10 : 3),
          noticeDueDate,
          noticeStatus: assessed ? 'not_required' : 'not_assessed',
          noticeRequired: false,
          noticeAssessedAt: assessed ? addDays(eventDate, 2) : null,
          noticeAssessedByUserId: assessed && ownerId ? ownerId : null,
          riskLevel,
        },
      });
      changeCount += 1;

      const taskAssignee = assessed && qs ? userIds.get(qs.userKey) : ownerId;
      await prisma.task.create({
        data: {
          projectId,
          potentialChangeId: created.id,
          taskType: assessed ? 'qs_pricing' : 'notice_assessment',
          title: `${assessed ? 'QS pricing' : 'Notice assessment'} — ${pcNumber}`,
          assignedToUserId: taskAssignee ?? null,
          dueDate: addDays(eventDate, assessed ? 10 : 3),
          priority: change.estimatedValue && change.estimatedValue > 300_000 ? 'high' : 'normal',
          status: 'open',
        },
      });
      taskCount += 1;

      if (change.workStarted) {
        await prisma.task.create({
          data: {
            projectId,
            potentialChangeId: created.id,
            taskType: 'evidence_collection',
            title: `Record labour and materials — ${pcNumber}`,
            description: 'Work has started. Capture daywork sheets and photographs now.',
            assignedToUserId: se ? (userIds.get(se.userKey) ?? null) : null,
            dueDate: addDays(new Date(), 2),
            priority: 'high',
            status: 'open',
          },
        });
        taskCount += 1;
      }

      await prisma.activityLog.create({
        data: {
          projectId,
          userId: created.reportedByUserId,
          recordType: 'potential_change',
          recordId: created.id,
          actionType: 'created',
          newValueJson: { pcNumber, title: change.title, noticeDueDate: noticeDueDate.toISOString() } as Prisma.InputJsonValue,
          source: 'seed',
        },
      });

      if (assessed) {
        await prisma.activityLog.create({
          data: {
            projectId,
            userId: ownerId,
            recordType: 'potential_change',
            recordId: created.id,
            actionType: 'notice_not_required',
            newValueJson: { noticeStatus: 'not_required' } as Prisma.InputJsonValue,
            source: 'seed',
          },
        });
      }
    }
    console.log(`  changes    ${changeCount}`);
    console.log(`  tasks      ${taskCount}`);

    // ── bottlenecks ──────────────────────────────────────────────────────────
    const { runDetectionSweep } = await import('../src/services/bottleneck.service');
    const { detected } = await runDetectionSweep();
    console.log(`  bottleneck ${detected} detected by the real sweep`);

    const activityTotal = await prisma.activityLog.count();
    console.log(`  activity   ${activityTotal}`);

    // ── embeddings ───────────────────────────────────────────────────────────
    try {
      const { indexPotentialChange } = await import('../src/services/search.service');
      const changes = await prisma.potentialChange.findMany({ select: { id: true } });
      for (const change of changes) await indexPotentialChange(change.id);
      console.log(`  embeddings ${changes.length}`);
    } catch (error) {
      console.log(
        `  embeddings SKIPPED — ${error instanceof Error ? error.message : String(error)}`,
      );
      console.log('             Run prisma/sql/001_vector.sql first, then re-run the seed.');
    }

  }

  console.log('\nDone.');
  if (admin) {
    console.log(`\nSign in as any seeded user with the password: ${DEFAULT_PASSWORD}`);
    const who = (key: string) => USERS.find((u) => u.key === key)?.email ?? '(missing)';
    console.log(`  Administrator  ${who('md')}   adds projects, people and permissions`);
    console.log(`  Director       ${who('md')}   approves, and sees every project`);
    console.log(`  QS             ${who('qs1')}   prices, on all four projects`);
    console.log(`  PM             ${who('pm1')}   DXB-001 and AUH-003`);
    console.log(`  PM             ${who('pm2')}   DXB-002 and DXB-004`);
    console.log(`  Site engineer  ${who('se1')}   DXB-001 and DXB-002 only`);
    console.log(`  Site engineer  ${who('se2')}   AUH-003 and DXB-004 only`);
  } else {
    console.log('\n  !! NO SUPABASE SERVICE ROLE KEY — identities were not created.');
    console.log('     The data is seeded but NOBODY CAN SIGN IN. Set the Supabase');
    console.log('     variables in .env and re-run: npm run db:seed');
  }
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
