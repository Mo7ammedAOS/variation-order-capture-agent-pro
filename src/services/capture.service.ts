import 'server-only';
import type { SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { todayUtc } from '@/lib/dates';
import { calculateNoticeDueDate } from '@/lib/dates';
import { calculateNoticeCountdown } from '@/lib/risk';
import { formatPcNumber } from '@/lib/pc-number';
import { recordAudit } from '@/services/audit-log.service';
import { getAiProvider } from '@/integrations/claude';

/**
 * Capture from an external channel.
 *
 * This path has no signed-in user, so it cannot use the normal service entry
 * points — the caller is n8n, proving itself with an HMAC, and the *subject* is
 * whoever sent the WhatsApp message. Identity is resolved from their phone or
 * email to a real user record, and their project memberships decide where the
 * change may land.
 *
 * PROJECT IDENTIFICATION, and the rule that matters:
 *
 *   one active project   → use it
 *   several              → do not choose. Park it for triage.
 *   none, or unknown     → park it for triage.
 *
 * NEVER GUESS. A Potential Change filed against the wrong project is worse than
 * one sitting in a queue, because it looks handled.
 */

export type CaptureOutcome =
  | { kind: 'created'; potentialChangeId: string; pcNumber: string; projectId: string }
  | { kind: 'needs_triage'; reason: string; candidateProjectIds: string[] };

export async function captureFromChannel(input: {
  channel: Extract<SourceType, 'whatsapp' | 'email'>;
  senderIdentifier: string;
  senderName?: string | null;
  text: string;
  externalMessageId: string;
  eventDate?: Date;
  projectCodeHint?: string | null;
}): Promise<CaptureOutcome> {
  const sender = await prisma.user.findFirst({
    where: {
      active: true,
      ...(input.channel === 'whatsapp'
        ? { phone: input.senderIdentifier }
        : { email: input.senderIdentifier.toLowerCase() }),
    },
    select: { id: true, fullName: true },
  });

  if (!sender) {
    return {
      kind: 'needs_triage',
      reason: `No active user matches ${input.channel} identifier ${input.senderIdentifier}`,
      candidateProjectIds: [],
    };
  }

  const memberships = await prisma.projectMember.findMany({
    where: { userId: sender.id, active: true, project: { projectStatus: { in: ['active', 'awarded'] } } },
    select: { projectId: true, project: { select: { projectCode: true } } },
    distinct: ['projectId'],
  });

  if (memberships.length === 0) {
    return {
      kind: 'needs_triage',
      reason: `${sender.fullName} is not assigned to any active project`,
      candidateProjectIds: [],
    };
  }

  // A project code in the payload is a HINT from an external system. It only
  // ever narrows the sender's real memberships; it can never widen them.
  let candidates = memberships;
  if (input.projectCodeHint) {
    const hinted = memberships.filter(
      (m) => m.project.projectCode.toUpperCase() === input.projectCodeHint?.toUpperCase(),
    );
    if (hinted.length === 1) candidates = hinted;
  }

  if (candidates.length > 1) {
    return {
      kind: 'needs_triage',
      reason: `${sender.fullName} is on ${candidates.length} active projects — cannot determine which`,
      candidateProjectIds: candidates.map((m) => m.projectId),
    };
  }

  const target = candidates[0];
  if (!target) {
    return { kind: 'needs_triage', reason: 'No candidate project', candidateProjectIds: [] };
  }

  // AI reads the message and proposes structure. It does not decide anything:
  // the change is created either way, and the extraction only fills fields in.
  const extraction = await getAiProvider().extractPotentialChange({
    text: input.text,
    sourceType: input.channel,
    senderName: input.senderName ?? sender.fullName,
  });

  const eventDate = input.eventDate ?? todayUtc();

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: target.projectId },
      include: { contractRules: true },
    });
    if (!project) {
      return { kind: 'needs_triage', reason: 'Project disappeared', candidateProjectIds: [] };
    }

    const [bumped] = await tx.$queryRaw<{ pc_sequence: number }[]>`
      UPDATE projects SET pc_sequence = pc_sequence + 1
      WHERE id = ${target.projectId}::uuid
      RETURNING pc_sequence
    `;
    if (!bumped) {
      return { kind: 'needs_triage', reason: 'Could not allocate a PC number', candidateProjectIds: [] };
    }

    const pcNumber = formatPcNumber(project.projectCode, bumped.pc_sequence);
    const noticePeriodDays = project.contractRules?.noticePeriodDays ?? 28;
    const noticeDueDate = calculateNoticeDueDate(eventDate, noticePeriodDays);

    const cm = await tx.projectMember.findFirst({
      where: { projectId: target.projectId, active: true, projectRole: 'commercial_manager' },
      select: { userId: true },
    });

    const dueDays = project.contractRules?.pmScopeReviewDueDays ?? 3;
    const nextActionDue = new Date(todayUtc());
    nextActionDue.setUTCDate(nextActionDue.getUTCDate() + dueDays);

    const change = await tx.potentialChange.create({
      data: {
        projectId: target.projectId,
        pcNumber,
        title: extraction.extractedData.suggestedTitle,
        description: input.text,
        eventDate,
        sourceType: input.channel,
        sourceMessageId: input.externalMessageId,
        sourceSenderName: input.senderName ?? sender.fullName,
        sourceSenderPhoneOrEmail: input.senderIdentifier,
        sourceSenderAuthorityStatus: 'unknown',
        reportedByUserId: sender.id,
        trade: extraction.extractedData.affectedTrade[0] ?? null,
        potentialTimeImpact: extraction.extractedData.possibleTimeImpact,
        currentStatus: 'notice_assessment',
        currentOwnerUserId: cm?.userId ?? null,
        waitingFor: 'Notice assessment',
        nextAction: 'Assess whether a contractual notice is required',
        nextActionDueDate: nextActionDue,
        noticeDueDate,
        noticeStatus: 'not_assessed',
        riskLevel: calculateNoticeCountdown(noticeDueDate).riskLevel,
      },
    });

    await tx.task.create({
      data: {
        projectId: target.projectId,
        potentialChangeId: change.id,
        taskType: 'notice_assessment',
        title: `Notice assessment — ${pcNumber}`,
        assignedToUserId: cm?.userId ?? null,
        dueDate: nextActionDue,
      },
    });

    await recordAudit({
      db: tx,
      projectId: target.projectId,
      userId: sender.id,
      recordType: 'potential_change',
      recordId: change.id,
      actionType: 'created',
      newValue: { pcNumber, title: change.title, source: input.channel },
      source: input.channel === 'whatsapp' ? 'whatsapp' : 'email',
      metadata: {
        externalMessageId: input.externalMessageId,
        aiConfidence: extraction.confidenceScore,
        aiMissingInformation: extraction.missingInformation,
      },
    });

    // The extraction is recorded as a suggestion in its own right, so a human
    // can see what the model thought and disagree with it.
    await recordAudit({
      db: tx,
      projectId: target.projectId,
      userId: null,
      recordType: 'potential_change',
      recordId: change.id,
      actionType: 'ai_suggested',
      newValue: extraction.extractedData,
      source: 'system',
      metadata: {
        confidenceScore: extraction.confidenceScore,
        missingInformation: extraction.missingInformation,
        suggestedNextAction: extraction.suggestedNextAction,
      },
    });

    return {
      kind: 'created' as const,
      potentialChangeId: change.id,
      pcNumber,
      projectId: target.projectId,
    };
  });
}
