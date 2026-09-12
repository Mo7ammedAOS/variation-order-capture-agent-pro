import 'server-only';
import type { InstructionRoute, Notice, SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { todayUtc } from '@/lib/dates';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { formatConfirmationReference } from '@/lib/pc-number';
import { renderConfirmation, type ConfirmationFacts } from '@/lib/confirmation-template';
import { noticeLetterPdf } from '@/lib/notice-template';
import { renderDocumentPdf } from '@/lib/pdf';
import { recordAudit } from '@/services/audit-log.service';
import { assertProjectAccess } from '@/services/project-access.service';
import { storeNoticeDocument } from '@/services/document.service';

/**
 * Confirmation of a verbal instruction.
 *
 * ── The gap this closes ────────────────────────────────────────────────────
 * UAE Civil Code Article 887: on a lump-sum muqawala a contractor generally
 * cannot recover for extra work without the employer's written agreement to
 * the work and to its price. Site staff receive verbal instructions constantly
 * and they are worth close to nothing on their own.
 *
 * This system already captured HOW an instruction arrived -- the capture
 * conversation asks, and `instructionRoute` stores the answer -- and then did
 * absolutely nothing with it. A change instructed verbally was treated
 * identically to one carrying a signed site instruction. That was the largest
 * commercial gap in the product and the smallest one to close, because the
 * data and the letter machinery both already existed.
 *
 * ── Why it is not a notice, and not an approval gate ───────────────────────
 * A notice reserves a contractual position and starts a clock; two seats
 * approve its words because it commits the company. This letter does neither.
 * It records what was said and asks the other side to confirm it -- and its
 * value is almost entirely in being sent THE SAME DAY. Putting it behind two
 * approvals would mean the letter that has to be contemporaneous is the one
 * that waits for a director, so the person who knows about the instruction
 * drafts it and sends it.
 *
 * It shares the `Notice` table because it needs the same plumbing: versions, a
 * live draft, editing, issue, a filed PDF, delivery confirmation and
 * acknowledgement. `kind` keeps the two apart, and every query on that table
 * filters by it.
 */

/** Instruction routes that produce nothing you could show a tribunal. */
const UNWRITTEN_ROUTES: readonly InstructionRoute[] = ['verbal', 'meeting'];
const UNWRITTEN_SOURCES: readonly SourceType[] = ['verbal', 'meeting', 'meeting_online'];

/**
 * Does this change rest on an instruction nobody wrote down?
 *
 * `meeting` counts alongside `verbal`. Minutes are written afterwards by one
 * side, are routinely disputed, and are not an instruction — so a change
 * instructed in a progress meeting is in the same position as one instructed
 * on a site walk.
 *
 * WhatsApp deliberately does not count. It is written, it is timestamped, and
 * it is the normal instruction channel on a UAE fit-out job; treating it as
 * unwritten would raise a flag on most of the register and train everyone to
 * ignore it.
 */
export function restsOnVerbalInstruction(change: {
  instructionRoute: InstructionRoute | null;
  sourceType: SourceType;
}): boolean {
  if (change.instructionRoute) return UNWRITTEN_ROUTES.includes(change.instructionRoute);
  return UNWRITTEN_SOURCES.includes(change.sourceType);
}

export type ConfirmationState =
  | { required: false }
  | { required: true; stage: 'none' }
  | { required: true; stage: 'drafted'; letter: Notice }
  | { required: true; stage: 'sent'; letter: Notice }
  | { required: true; stage: 'confirmed'; letter: Notice };

/**
 * Where a change stands on written confirmation.
 *
 * `confirmed` only when the letter is ACKNOWLEDGED, not when it was sent.
 * Sending it is our act; the article asks for the employer's agreement, and
 * that is the acknowledgement. A screen that turned green on "sent" would tell
 * a QS the position was safe when it is merely recorded.
 */
export async function confirmationState(potentialChangeId: string): Promise<ConfirmationState> {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    select: { instructionRoute: true, sourceType: true },
  });
  if (!change) throw new NotFoundError('Potential Change not found');
  if (!restsOnVerbalInstruction(change)) return { required: false };

  const letter = await prisma.notice.findFirst({
    where: {
      potentialChangeId,
      kind: 'verbal_confirmation',
      status: { not: 'superseded' },
    },
    orderBy: { version: 'desc' },
  });

  if (!letter) return { required: true, stage: 'none' };
  if (letter.acknowledgedAt) return { required: true, stage: 'confirmed', letter };
  if (letter.status === 'sent' || letter.status === 'issued') {
    return { required: true, stage: 'sent', letter };
  }
  return { required: true, stage: 'drafted', letter };
}

/**
 * Writes the letter, ready for a human to read and send.
 *
 * Drafting is idempotent: a live draft is returned as it is rather than a
 * second one being stacked on top, so pressing the button twice is harmless.
 */
export async function draftVerbalConfirmation(
  user: AuthenticatedUser,
  potentialChangeId: string,
) {
  const change = await prisma.potentialChange.findUnique({
    where: { id: potentialChangeId },
    include: {
      project: { include: { contractRules: true } },
    },
  });
  if (!change) throw new NotFoundError('Potential Change not found');

  await assertProjectAccess(user, change.projectId, 'notice.draft');

  if (!restsOnVerbalInstruction(change)) {
    throw new ValidationError(
      'This change was instructed in writing, so there is nothing to confirm.',
    );
  }

  const live = await prisma.notice.findFirst({
    where: {
      potentialChangeId,
      kind: 'verbal_confirmation',
      status: { not: 'superseded' },
    },
    orderBy: { version: 'desc' },
  });
  if (live) return live;

  const company = await prisma.companySettings.findFirst({ where: { singleton: true } });
  const rules = change.project.contractRules;

  return prisma.$transaction(async (tx) => {
    const latest = await tx.notice.findFirst({
      where: { potentialChangeId, kind: 'verbal_confirmation' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    // The same per-project counter the notices use, incremented the same
    // race-safe way. The CVI prefix is what keeps the two series apart.
    const [bumped] = await tx.$queryRaw<{ notice_sequence: number }[]>`
      UPDATE projects SET notice_sequence = notice_sequence + 1
      WHERE id = ${change.projectId}::uuid
      RETURNING notice_sequence
    `;
    if (!bumped) throw new NotFoundError('Project not found');

    const reference = formatConfirmationReference(
      change.project.projectCode,
      bumped.notice_sequence,
    );

    const facts: ConfirmationFacts = {
      companyName:
        company?.legalCompanyName ?? company?.displayCompanyName ?? 'The Contractor',
      projectCode: change.project.projectCode,
      projectName: change.project.projectName,
      contractNumber: change.project.contractNumber,
      clientName: change.project.clientName,
      recipientName: rules?.noticeRecipientName ?? null,
      recipientCompany: rules?.noticeRecipientCompany ?? change.project.clientName,

      reference,
      pcNumber: change.pcNumber,
      title: change.title,
      description: change.description,

      eventDate: change.eventDate,
      letterDate: todayUtc(),
      location: change.location,
      trade: change.trade,
      instructedBy: change.instructedBy,
      sourceLocation: change.sourceLocation,

      workStarted: change.workStatus === 'in_progress' || change.workStatus === 'completed',
      responseDays: rules?.voResponseDays ?? null,
    };

    const { subject, body } = renderConfirmation(facts);

    const created = await tx.notice.create({
      data: {
        projectId: change.projectId,
        potentialChangeId,
        kind: 'verbal_confirmation',
        reference,
        version: (latest?.version ?? 0) + 1,
        status: 'draft',
        subject,
        body,
        recipientName: rules?.noticeRecipientName ?? null,
        recipientCompany: rules?.noticeRecipientCompany ?? change.project.clientName,
        recipientEmail: rules?.noticeRecipientEmail ?? null,
        draftedByUserId: user.id,
      },
    });

    await recordAudit({
      db: tx,
      projectId: change.projectId,
      userId: user.id,
      recordType: 'notice',
      recordId: created.id,
      actionType: 'created',
      newValue: { kind: 'verbal_confirmation', reference, pcNumber: change.pcNumber },
    });

    return created;
  });
}

/**
 * Sends it, and files the PDF as evidence that it was sent.
 *
 * The PDF is rendered here rather than at draft time because the draft is
 * editable until this moment: filing a document that does not match the words
 * that went out would be worse than filing nothing.
 */
export async function issueVerbalConfirmation(
  user: AuthenticatedUser,
  letterId: string,
) {
  const letter = await prisma.notice.findUnique({
    where: { id: letterId },
    include: { project: { select: { projectCode: true } } },
  });
  if (!letter) throw new NotFoundError('Letter not found');
  if (letter.kind !== 'verbal_confirmation') {
    throw new ValidationError('That is a notice, not a confirmation letter');
  }
  if (letter.status !== 'draft') {
    throw new ValidationError('This letter has already been sent');
  }

  await assertProjectAccess(user, letter.projectId, 'notice.draft');

  const company = await prisma.companySettings.findFirst({ where: { singleton: true } });
  const companyName =
    company?.legalCompanyName ?? company?.displayCompanyName ?? 'The Contractor';

  const pdf = renderDocumentPdf(
    noticeLetterPdf(letter.body, {
      companyName,
      documentType: 'CONFIRMATION OF VERBAL INSTRUCTION',
      footer: `${letter.reference}   |   ${letter.project.projectCode}`,
    }),
  );

  // Outside the transaction: this crosses the network to Drive, and a storage
  // provider having a slow afternoon must not hold row locks open.
  const document = await storeNoticeDocument({
    projectId: letter.projectId,
    potentialChangeId: letter.potentialChangeId,
    reference: letter.reference,
    content: pdf,
    uploadedByUserId: user.id,
  });

  return prisma.$transaction(async (tx) => {
    const issued = await tx.notice.update({
      where: { id: letterId },
      data: {
        status: 'issued',
        issuedByUserId: user.id,
        issuedAt: new Date(),
        documentId: document.id,
      },
    });

    await recordAudit({
      db: tx,
      projectId: letter.projectId,
      userId: user.id,
      recordType: 'notice',
      recordId: letterId,
      actionType: 'status_changed',
      oldValue: { status: 'draft' },
      newValue: { status: 'issued', kind: 'verbal_confirmation', reference: letter.reference },
    });

    return issued;
  });
}

/**
 * Records that the other side confirmed it.
 *
 * This is the event Article 887 actually cares about, so it is a deliberate
 * human act with a reference attached rather than something inferred from an
 * inbound email.
 */
export async function recordConfirmationReceived(
  user: AuthenticatedUser,
  letterId: string,
  reference: string | null,
) {
  const letter = await prisma.notice.findUnique({ where: { id: letterId } });
  if (!letter) throw new NotFoundError('Letter not found');
  if (letter.kind !== 'verbal_confirmation') {
    throw new ValidationError('That is a notice, not a confirmation letter');
  }

  await assertProjectAccess(user, letter.projectId, 'notice.acknowledge');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.notice.update({
      where: { id: letterId },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedByUserId: user.id,
        acknowledgementReference: reference,
      },
    });

    await recordAudit({
      db: tx,
      projectId: letter.projectId,
      userId: user.id,
      recordType: 'notice',
      recordId: letterId,
      actionType: 'status_changed',
      oldValue: { status: letter.status },
      newValue: {
        status: 'acknowledged',
        kind: 'verbal_confirmation',
        acknowledgementReference: reference,
      },
    });

    return updated;
  });
}
