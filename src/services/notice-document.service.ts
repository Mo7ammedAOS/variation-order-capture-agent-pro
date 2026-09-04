import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { formatNoticeReference } from '@/lib/pc-number';
import { noticeLetterPdf, renderNotice, type NoticeFacts } from '@/lib/notice-template';
import { renderDocumentPdf } from '@/lib/pdf';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess } from '@/services/project-access.service';
import { storeNoticeDocument } from '@/services/document.service';

/**
 * The notice document, from draft to served.
 *
 * ── The order this runs in, and why ────────────────────────────────────────
 *   assess "required"  ->  the system DRAFTS immediately
 *   a human edits the draft
 *   two seats approve THE TEXT
 *   approval issues it: the words are frozen, a PDF is filed, a message queued
 *   the courier reports back  ->  sent, with a message id, which is the proof
 *   a human records the client's acknowledgement
 *
 * The draft comes before the approval on purpose. A director approving "issue
 * a notice" is approving an intention; a director approving a page of text is
 * approving a contractual position. Only the second is worth two signatures.
 *
 * ── This module is deliberately not imported by approval.service's importers ─
 * notice.service imports openGate from approval.service. If approval.service
 * imported notice.service back, the two would form a cycle that ESM resolves
 * by handing one of them a half-initialised module — which fails at runtime,
 * in the one code path nobody exercises locally. Both sides import THIS module
 * instead, and this module imports neither of them.
 */

/* ─── Drafting ───────────────────────────────────────────────────────────── */

/**
 * Writes the first draft, inside the transaction that concluded a notice is
 * required. No network call: rendering is a pure function, and the PDF is not
 * produced until issue.
 *
 * Re-assessing does not stack up drafts: a live draft is returned as it is.
 * After a rejection there is no live draft — the rejected one was superseded —
 * so this writes version 2, and the rejected round is left untouched beside it.
 */
export async function draftNotice(
  tx: Prisma.TransactionClient,
  input: {
    potentialChangeId: string;
    projectId: string;
    actorUserId: string;
    /**
     * Professional wording for the account of what happened, drafted by the
     * model BEFORE this transaction opened.
     *
     * It arrives as an argument rather than being fetched here, and that is
     * not tidiness: this runs inside a Prisma interactive transaction holding
     * row locks, with a five second budget. An API call in here would hold
     * those locks across somebody else's network, and a slow afternoon at the
     * provider would start rolling back notice assessments.
     */
    narrative?: string | null;
  },
): Promise<{ id: string; reference: string } | null> {
  const live = await tx.notice.findFirst({
    where: { potentialChangeId: input.potentialChangeId, status: { not: 'superseded' } },
    orderBy: { version: 'desc' },
    select: { id: true, reference: true },
  });
  if (live) return live;

  const latest = await tx.notice.findFirst({
    where: { potentialChangeId: input.potentialChangeId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;

  const change = await tx.potentialChange.findUnique({
    where: { id: input.potentialChangeId },
    include: {
      project: { include: { contractRules: true } },
      requestedByContact: { select: { fullName: true, companyName: true } },
      reportedBy: { select: { fullName: true } },
    },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  const company = await tx.companySettings.findFirst({ where: { singleton: true } });
  const rules = change.project.contractRules;

  // Its own counter, incremented the same race-safe way as the PC number.
  const [bumped] = await tx.$queryRaw<{ notice_sequence: number }[]>`
    UPDATE projects SET notice_sequence = notice_sequence + 1
    WHERE id = ${input.projectId}::uuid
    RETURNING notice_sequence
  `;
  if (!bumped) throw new NotFoundError('Project not found');

  const reference = formatNoticeReference(change.project.projectCode, bumped.notice_sequence);

  const facts: NoticeFacts = {
    companyName: company?.legalCompanyName ?? company?.displayCompanyName ?? 'The Contractor',
    projectCode: change.project.projectCode,
    projectName: change.project.projectName,
    contractNumber: change.project.contractNumber,
    clientName: change.project.clientName,
    recipientName: rules?.noticeRecipientName ?? null,
    recipientCompany: rules?.noticeRecipientCompany ?? change.project.clientName,
    clauseReference: rules?.contractClauseReference ?? null,
    noticePeriodDays: rules?.noticePeriodDays ?? 28,
    pcNumber: change.pcNumber,
    reference,
    title: change.title,
    description: change.description,
    eventDate: change.eventDate,
    location: change.location,
    trade: change.trade,
    instructedBy:
      change.requestedByContact?.fullName ??
      change.sourceSenderName ??
      change.reportedBy?.fullName ??
      null,
    instructionSource: describeSource(change.sourceType, change.sourceLocation),
    potentialTimeImpact: change.potentialTimeImpact,
    noticeDate: todayUtc(),
    narrative: input.narrative ?? null,
  };

  const rendered = renderNotice(facts);

  const notice = await tx.notice.create({
    data: {
      projectId: input.projectId,
      potentialChangeId: input.potentialChangeId,
      reference,
      version,
      status: 'draft',
      subject: rendered.subject,
      body: rendered.body,
      recipientName: facts.recipientName,
      recipientCompany: facts.recipientCompany,
      recipientEmail: rules?.noticeRecipientEmail ?? null,
      clauseReference: facts.clauseReference,
      draftedByUserId: input.actorUserId,
    },
    select: { id: true, reference: true },
  });

  await tx.potentialChange.update({
    where: { id: input.potentialChangeId },
    data: { noticeStatus: 'drafted' },
  });

  await recordAudit({
    db: tx,
    projectId: input.projectId,
    userId: input.actorUserId,
    recordType: 'notice',
    recordId: notice.id,
    actionType: 'drafted',
    newValue: { reference, version },
  });

  return notice;
}

function describeSource(sourceType: string, sourceLocation: string | null): string | null {
  const labels: Record<string, string> = {
    mobile_form: 'reported on site',
    whatsapp: 'WhatsApp message',
    email: 'email',
    document_upload: 'document issued to us',
    meeting: 'meeting',
    meeting_online: 'online meeting',
    site_instruction: 'site instruction',
    verbal: 'verbal instruction',
    other: 'correspondence',
  };
  const label = labels[sourceType] ?? 'correspondence';
  return sourceLocation ? `${label} (${sourceLocation})` : label;
}

/* ─── Reading and editing ────────────────────────────────────────────────── */

export async function getCurrentNotice(potentialChangeId: string) {
  return prisma.notice.findFirst({
    where: { potentialChangeId, status: { not: 'superseded' } },
    orderBy: { version: 'desc' },
    include: {
      draftedBy: { select: { fullName: true } },
      issuedBy: { select: { fullName: true } },
      acknowledgedBy: { select: { fullName: true } },
      document: { select: { id: true, documentName: true } },
      notification: { select: { id: true, status: true, recipient: true, failureReason: true } },
    },
  });
}

export async function listNotices(projectId: string) {
  return prisma.notice.findMany({
    where: { projectId },
    orderBy: [{ reference: 'asc' }],
    include: {
      potentialChange: { select: { id: true, pcNumber: true, title: true } },
      document: { select: { id: true } },
    },
  });
}

export const noticeDraftSchema = z.object({
  noticeId: z.string().uuid(),
  subject: z.string().trim().min(5).max(300),
  body: z.string().trim().min(50).max(20000),
  recipientName: z.string().trim().max(200).optional().nullable(),
  recipientEmail: z.string().trim().email().max(320).optional().nullable().or(z.literal('')),
});

export type NoticeDraftInput = z.infer<typeof noticeDraftSchema>;

/**
 * Editing the words. Only while it is a draft.
 *
 * Once two seats have approved, the text they approved is the text that goes
 * out. Allowing an edit after approval would mean the signatures sit under
 * something nobody read, which is worse than having no gate at all.
 */
export async function updateNoticeDraft(user: AuthenticatedUser, input: NoticeDraftInput) {
  const parsed = noticeDraftSchema.parse(input);

  const notice = await prisma.notice.findUnique({ where: { id: parsed.noticeId } });
  if (!notice) throw new NotFoundError('Notice not found');

  await assertProjectAccess(user, notice.projectId, 'notice.draft');

  if (notice.status !== 'draft') {
    throw new ValidationError(
      'This notice has already been approved. Its wording is fixed. Reject the approval to redraft it.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.notice.update({
      where: { id: parsed.noticeId },
      data: {
        subject: parsed.subject,
        body: parsed.body,
        recipientName: parsed.recipientName || null,
        recipientEmail: parsed.recipientEmail || null,
      },
    });

    await recordAudit({
      db: tx,
      projectId: notice.projectId,
      userId: user.id,
      recordType: 'notice',
      recordId: notice.id,
      actionType: 'updated',
      oldValue: { subject: notice.subject, body: notice.body },
      newValue: { subject: updated.subject, body: updated.body },
    });

    return updated;
  });
}

/* ─── Issuing ────────────────────────────────────────────────────────────── */

/**
 * Called from inside the approval transaction, the moment both seats agree.
 *
 * Everything here is a database write. The PDF and the Drive upload happen in
 * `fileNoticeDocument` AFTER the transaction commits, because a five second
 * Prisma transaction timeout and a nine second Drive call already destroyed a
 * folder tree once on this project.
 *
 * The message is written `pending`. It is not sent here, and asking for it to
 * be sent is not evidence that it was.
 */
export async function issueNotice(
  tx: Prisma.TransactionClient,
  input: { potentialChangeId: string; projectId: string; actorUserId: string },
): Promise<{ id: string; reference: string } | null> {
  const notice = await tx.notice.findFirst({
    where: { potentialChangeId: input.potentialChangeId, status: 'draft' },
    orderBy: { version: 'desc' },
  });
  if (!notice) return null;

  let notificationId: string | null = null;

  if (notice.recipientEmail) {
    const message = await tx.notificationLog.create({
      data: {
        potentialChangeId: input.potentialChangeId,
        // No `userId`: the addressee is the client, not one of our people. A
        // notice must never appear in a staff member's notification bell as
        // though it were their task.
        kind: 'notice_issued',
        channel: 'email',
        recipient: notice.recipientEmail,
        subject: notice.subject,
        body: notice.body,
        payloadSummary: notice.reference,
        status: 'pending',
        // Stable, so a retried issue cannot serve the same notice twice.
        dedupeKey: `notice:${notice.id}:v${notice.version}:email:${notice.recipientEmail}`,
      },
      select: { id: true },
    });
    notificationId = message.id;
  }

  const issued = await tx.notice.update({
    where: { id: notice.id },
    data: {
      status: 'issued',
      issuedAt: new Date(),
      issuedByUserId: input.actorUserId,
      notificationId,
    },
    select: { id: true, reference: true },
  });

  await recordAudit({
    db: tx,
    projectId: input.projectId,
    userId: input.actorUserId,
    recordType: 'notice',
    recordId: notice.id,
    actionType: 'issued',
    newValue: {
      reference: notice.reference,
      recipient: notice.recipientEmail,
      queued: notificationId !== null,
    },
  });

  return issued;
}

/**
 * Renders the approved text to a PDF and files it in `08 Notices`.
 *
 * Safe to call again: it does nothing once a document is attached. Called
 * after the approval transaction commits, and again by the sweep if the first
 * attempt failed — a Drive outage must delay the filing, never the issue.
 */
export async function fileNoticeDocument(noticeId: string): Promise<{ documentId: string } | null> {
  const notice = await prisma.notice.findUnique({
    where: { id: noticeId },
    select: {
      id: true, projectId: true, potentialChangeId: true, reference: true,
      subject: true, body: true, documentId: true, issuedByUserId: true, status: true,
    },
  });
  if (!notice) throw new NotFoundError('Notice not found');
  if (notice.documentId) return { documentId: notice.documentId };
  if (notice.status === 'draft') return null;

  // The company name and the reference come off the record, not the body —
  // a letterhead reconstructed by parsing the letter would go wrong the first
  // time somebody edited the top of it.
  const [project, company] = await Promise.all([
    prisma.project.findUnique({
      where: { id: notice.projectId },
      select: { projectCode: true },
    }),
    prisma.companySettings.findFirst({ where: { singleton: true } }),
  ]);

  const pdf = renderDocumentPdf(
    noticeLetterPdf(notice.body, {
      companyName:
        company?.legalCompanyName ?? company?.displayCompanyName ?? 'The Contractor',
      footer: `${notice.reference}   |   ${project?.projectCode ?? ''}`,
    }),
  );

  const document = await storeNoticeDocument({
    projectId: notice.projectId,
    potentialChangeId: notice.potentialChangeId,
    reference: notice.reference,
    content: pdf,
    uploadedByUserId: notice.issuedByUserId,
  });

  // Conditional, so two concurrent filings cannot both claim the slot. The
  // loser's file is an orphan in Drive; the database still points at one PDF.
  const claimed = await prisma.notice.updateMany({
    where: { id: noticeId, documentId: null },
    data: { documentId: document.id },
  });
  if (claimed.count !== 1) {
    const winner = await prisma.notice.findUnique({
      where: { id: noticeId },
      select: { documentId: true },
    });
    return winner?.documentId ? { documentId: winner.documentId } : null;
  }

  return { documentId: document.id };
}

/** Notices that were issued but whose PDF never made it to storage. */
export async function fileUnfiledNotices(limit = 25): Promise<{ filed: number; failed: number }> {
  const pending = await prisma.notice.findMany({
    where: { documentId: null, status: { in: ['issued', 'sent', 'acknowledged'] } },
    orderBy: { issuedAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let filed = 0;
  let failed = 0;
  for (const notice of pending) {
    try {
      await fileNoticeDocument(notice.id);
      filed += 1;
    } catch {
      // Storage is down or the credential expired. Counted, not thrown: one
      // unfilable notice must not stop the other twenty-four.
      failed += 1;
    }
  }
  return { filed, failed };
}

/* ─── Served ─────────────────────────────────────────────────────────────── */

/**
 * The courier reported back. This is the ONLY thing that makes a notice sent.
 *
 * Called from recordDeliveryResult, so it runs whether the callback arrives
 * for a notice or for a routine reminder — the notification id is what links
 * them, and a notification that is not a notice simply matches nothing.
 */
export async function markNoticeDelivered(input: {
  notificationId: string;
  externalMessageId: string | null;
  succeeded: boolean;
}): Promise<void> {
  const notice = await prisma.notice.findUnique({
    where: { notificationId: input.notificationId },
    select: { id: true, projectId: true, potentialChangeId: true, status: true },
  });
  if (!notice) return;
  if (!input.succeeded) return;
  if (notice.status !== 'issued') return;

  await prisma.$transaction(async (tx) => {
    await tx.notice.update({
      where: { id: notice.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        externalMessageId: input.externalMessageId,
      },
    });
    await tx.potentialChange.update({
      where: { id: notice.potentialChangeId },
      data: { noticeStatus: 'sent' },
    });
    await recordAudit({
      db: tx,
      projectId: notice.projectId,
      userId: null,
      recordType: 'notice',
      recordId: notice.id,
      actionType: 'sent',
      newValue: { externalMessageId: input.externalMessageId },
    });
  });
}

export const acknowledgementSchema = z.object({
  noticeId: z.string().uuid(),
  acknowledgedOn: z.coerce.date(),
  reference: z.string().trim().max(200).optional(),
});

export type AcknowledgementInput = z.infer<typeof acknowledgementSchema>;

/**
 * A human records that the client acknowledged it.
 *
 * Not inferred from a reply landing in the capture mailbox. An acknowledgement
 * is a contractual fact, and the difference between "they replied" and "they
 * acknowledged the notice" is a judgement no classifier should be making.
 */
export async function acknowledgeNotice(user: AuthenticatedUser, input: AcknowledgementInput) {
  const parsed = acknowledgementSchema.parse(input);

  const notice = await prisma.notice.findUnique({ where: { id: parsed.noticeId } });
  if (!notice) throw new NotFoundError('Notice not found');

  await assertProjectAccess(user, notice.projectId, 'notice.acknowledge');

  if (notice.status === 'draft') {
    throw new ValidationError('That notice has not been issued yet.');
  }
  // Compared against the end of today in Dubai, not against the instant.
  // A date input hands back midnight UTC, so a person in the UAE recording
  // "today" at 09:00 local submits a timestamp two hours ahead of the clock
  // this container runs on, and a naive `> Date.now()` refuses them all
  // morning.
  const endOfToday = new Date(todayUtc());
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
  if (parsed.acknowledgedOn.getTime() >= endOfToday.getTime()) {
    throw new ValidationError('An acknowledgement cannot be dated in the future.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.notice.update({
      where: { id: parsed.noticeId },
      data: {
        status: 'acknowledged',
        acknowledgedAt: parsed.acknowledgedOn,
        acknowledgedByUserId: user.id,
        acknowledgementReference: parsed.reference ?? null,
      },
    });

    await tx.potentialChange.update({
      where: { id: notice.potentialChangeId },
      data: { noticeStatus: 'acknowledged' },
    });

    await recordAudit({
      db: tx,
      projectId: notice.projectId,
      userId: user.id,
      recordType: 'notice',
      recordId: notice.id,
      actionType: 'acknowledged',
      newValue: {
        acknowledgedAt: parsed.acknowledgedOn.toISOString(),
        reference: parsed.reference ?? null,
      },
    });

    return updated;
  });
}

/**
 * A rejected notice is retired, not rewritten, and a fresh draft opens as
 * version 2. Called when the notice gate is rejected.
 */
export async function supersedeDraft(
  tx: Prisma.TransactionClient,
  input: { potentialChangeId: string; projectId: string; actorUserId: string },
): Promise<void> {
  const current = await tx.notice.findFirst({
    where: { potentialChangeId: input.potentialChangeId, status: 'draft' },
    orderBy: { version: 'desc' },
  });
  if (!current) return;

  await tx.notice.update({ where: { id: current.id }, data: { status: 'superseded' } });

  await tx.potentialChange.update({
    where: { id: input.potentialChangeId },
    data: { noticeStatus: 'required' },
  });

  await recordAudit({
    db: tx,
    projectId: input.projectId,
    userId: input.actorUserId,
    recordType: 'notice',
    recordId: current.id,
    actionType: 'superseded',
    newValue: { version: current.version },
  });
}
