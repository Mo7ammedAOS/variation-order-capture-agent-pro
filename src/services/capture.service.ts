import 'server-only';
import type { IntegrationEventStatus, IntegrationSource, SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { todayUtc } from '@/lib/dates';
import { calculateNoticeDueDate } from '@/lib/dates';
import { calculateNoticeCountdown } from '@/lib/risk';
import { formatPcNumber } from '@/lib/pc-number';
import { recordAudit } from '@/services/audit-log.service';
import { pickResponsibleMember } from '@/services/permissions.service';
import { loadRecipients, recordTaskNotifications } from '@/services/notification.service';
import { NOTICE_ASSESSMENT_PREFERENCE } from '@/lib/rbac';
import { extractWithFallback } from '@/integrations/claude';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { assertCapability, assertProjectAccess } from '@/services/project-access.service';
import { closeEvent, listUnprocessedEvents } from '@/services/integration.service';
import {
  askWhichProject,
  confirmProject,
  tryAnswerQuestion,
} from '@/services/capture-question.service';
import { matchProjectsInText } from '@/lib/project-match';
import { storeCaptureEvidence, type CaptureAttachment } from '@/services/document.service';

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
 *   one active project             → use it
 *   several, and the text names one → propose it and ask them to confirm
 *   several, and it names none      → ask which, from their list
 *   names a project they are not on → park it, saying so
 *   none, or unknown sender         → park it for triage
 *
 * NEVER GUESS. A Potential Change filed against the wrong project is worse than
 * one sitting in a queue, because it looks handled.
 *
 * Reading the project out of the message is not a softening of that rule. The
 * matcher (`src/lib/project-match.ts`) proposes; it never decides. What it
 * saves is the reporter's time: instead of "here are your four jobs", he gets
 * "this is DXB-001, yes?" and answers in one word. The safety property is
 * unchanged, because nothing is written until he answers.
 */

export type CaptureOutcome =
  | { kind: 'created'; potentialChangeId: string; pcNumber: string; projectId: string }
  | { kind: 'needs_triage'; reason: string; candidateProjectIds: string[] };

export interface CaptureInput {
  channel: Extract<SourceType, 'whatsapp' | 'email'>;
  senderIdentifier: string;
  senderName?: string | null;
  text: string;
  externalMessageId: string;
  eventDate?: Date;
  projectCodeHint?: string | null;
  /** The subject line, for a reply that threads. Email only. */
  sourceSubject?: string | null;
  /** Photos, drawings, PDFs sent with the message. Filed as evidence. */
  attachments?: CaptureAttachment[];
}

export async function captureFromChannel(
  input: CaptureInput,
  /** The event this message was recorded as. Needed to hang a question off it. */
  integrationEventId?: string,
): Promise<CaptureOutcome> {
  // Is this an ANSWER to a question we already asked? Checked first, because
  // "2" from someone with a question outstanding is not a new change, and
  // treating it as one would file a Potential Change titled "2" and leave the
  // real report parked for ever.
  const answer = await tryAnswerQuestion({
    senderIdentifier: input.senderIdentifier,
    channel: input.channel,
    text: input.text,
  });

  if (answer?.outcome === 'answered' && answer.projectId) {
    // The attachments came with the ORIGINAL message, not with the word "yes".
    // Reading them off this reply alone would file the change and quietly lose
    // the photographs it was reported with.
    const original = await attachmentsForEvent(answer.integrationEventId);

    const outcome = await createChangeFromCapture({
      projectId: answer.projectId,
      reporterId: answer.userId,
      reporterName: answer.userName,
      input: {
        ...input,
        text: answer.originalText || input.text,
        attachments: mergeAttachments(original, input.attachments ?? []),
      },
    });

    if (outcome.kind === 'created') {
      await closeEvent(answer.integrationEventId, 'processed', {
        answeredBy: answer.userId,
        answeredAt: new Date().toISOString(),
        projectId: answer.projectId,
        pcNumber: outcome.pcNumber,
        via: input.channel,
      });
    }
    return outcome;
  }

  // "No, wrong project." Put the full list back to them on the same thread,
  // rather than leaving someone who answered correctly with nothing to do.
  if (answer?.outcome === 'rejected') {
    const reAsked =
      answer.candidateProjectIds.length >= 2
        ? await askWhichProject({
            integrationEventId: answer.integrationEventId,
            userId: answer.userId,
            userName: answer.userName,
            channel: input.channel,
            originalText: answer.originalText || input.text,
            candidateProjectIds: answer.candidateProjectIds,
            sourceMessageId: answer.sourceMessageId,
            sourceSubject: answer.sourceSubject,
          })
        : null;

    return {
      kind: 'needs_triage',
      reason: reAsked
        ? `${answer.userName} said that was the wrong project. Asked which of ${answer.candidateProjectIds.length} instead (${reAsked.token}).`
        : `${answer.userName} said that was the wrong project, and has no other live project to move it to.`,
      candidateProjectIds: answer.candidateProjectIds,
    };
  }

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
    select: {
      projectId: true,
      project: { select: { projectCode: true, projectName: true, clientName: true } },
    },
    distinct: ['projectId'],
  });

  if (memberships.length === 0) {
    return {
      kind: 'needs_triage',
      reason: `${sender.fullName} is not assigned to any active project`,
      candidateProjectIds: [],
    };
  }

  const memberProjectIds = memberships.map((m) => m.projectId);

  // A project code in the payload is a HINT from an external system — n8n may
  // have read it off a subject line. It is folded into the text and matched the
  // same way, so "DXB001" in a subject and "DXB-001" in a sentence behave
  // identically, and neither can ever widen the sender's real memberships.
  const searchText = [input.projectCodeHint, input.text].filter(Boolean).join('\n');

  // Named a job they are not on. This is the one case where being clever is
  // worth it: without it, the engineer is shown his OWN four projects, picks
  // one, and the change lands on the wrong job looking perfectly filed.
  // Restricted to project CODES — a code is an identifier, a client name is a
  // resemblance, and parking on a resemblance would park half the inbox.
  const foreign = await findForeignProjectByCode(searchText, memberProjectIds);
  if (foreign) {
    return {
      kind: 'needs_triage',
      reason:
        `${sender.fullName} named ${foreign.projectCode} (${foreign.projectName}), ` +
        `which they are not assigned to. Add them to it, or file it by hand.`,
      candidateProjectIds: [],
    };
  }

  // Only one live job: there is nothing to be wrong about.
  if (memberships.length === 1) {
    const only = memberships[0];
    if (!only) {
      return { kind: 'needs_triage', reason: 'No candidate project', candidateProjectIds: [] };
    }
    return createChangeFromCapture({
      projectId: only.projectId,
      reporterId: sender.id,
      reporterName: sender.fullName,
      input,
    });
  }

  const matches = matchProjectsInText(
    searchText,
    memberships.map((m) => ({
      id: m.projectId,
      projectCode: m.project.projectCode,
      projectName: m.project.projectName,
      clientName: m.project.clientName,
    })),
  );

  // The text pointed at exactly one of their jobs. Propose it and ask for one
  // word back, instead of making them read a list they already answered.
  const proposal = matches.length === 1 ? matches[0] : null;
  if (proposal && integrationEventId) {
    const confirmed = await confirmProject({
      integrationEventId,
      userId: sender.id,
      userName: sender.fullName,
      channel: input.channel,
      originalText: input.text,
      proposedProjectId: proposal.projectId,
      match: proposal,
      otherProjectIds: memberProjectIds,
      sourceMessageId: input.externalMessageId,
      sourceSubject: input.sourceSubject ?? null,
    });

    if (confirmed) {
      return {
        kind: 'needs_triage',
        reason:
          `Read this as ${proposal.matchedText} (${proposal.matchedOn}). ` +
          `Asked ${sender.fullName} to confirm (${confirmed.token}). Waiting for a reply.`,
        candidateProjectIds: [proposal.projectId],
      };
    }
  }

  // Either nothing was named, or several jobs were. Narrowing to the ones the
  // text could mean is still a shorter question than the full list.
  const candidateProjectIds =
    matches.length > 1 ? matches.map((m) => m.projectId) : memberProjectIds;

  // Ask the one person who knows. Parking it for a coordinator instead would
  // hand the decision to somebody with LESS context than the reporter had.
  const asked = integrationEventId
    ? await askWhichProject({
        integrationEventId,
        userId: sender.id,
        userName: sender.fullName,
        channel: input.channel,
        originalText: input.text,
        candidateProjectIds,
        sourceMessageId: input.externalMessageId,
        sourceSubject: input.sourceSubject ?? null,
      })
    : null;

  return {
    kind: 'needs_triage',
    reason: asked
      ? `Asked ${sender.fullName} which of ${candidateProjectIds.length} projects this is (${asked.token}). Waiting for a reply.`
      : `${sender.fullName} is on ${candidateProjectIds.length} active projects — cannot determine which`,
    candidateProjectIds,
  };
}

/**
 * A project named by CODE in the text that the sender has no business filing
 * against.
 *
 * Deliberately a separate query over every live project, and deliberately code
 * only. It exists to REFUSE, never to select: nothing here can ever put a
 * change on a project the sender is not a member of.
 */
async function findForeignProjectByCode(
  text: string,
  memberProjectIds: string[],
): Promise<{ id: string; projectCode: string; projectName: string } | null> {
  if (!text.trim()) return null;

  const outside = await prisma.project.findMany({
    where: {
      projectStatus: { in: ['active', 'awarded'] },
      id: { notIn: memberProjectIds },
    },
    select: { id: true, projectCode: true, projectName: true, clientName: true },
  });
  if (outside.length === 0) return null;

  const named = matchProjectsInText(text, outside.map((p) => ({ ...p })))
    .filter((m) => m.matchedOn === 'code');
  if (named.length === 0) return null;

  return outside.find((p) => p.id === named[0]?.projectId) ?? null;
}

/**
 * Turns a captured message into a Potential Change on a NAMED project.
 *
 * Split out of `captureFromChannel` because there are two ways a project gets
 * chosen and only one of them is automatic. The channel path picks the project
 * when the sender is on exactly one; the triage path has a human pick it. Both
 * must then create the change identically — same PC number allocation, same
 * notice clock, same owner by capability, same audit trail — or a change filed
 * by hand would quietly differ from one filed by WhatsApp, and only the second
 * would have a notice deadline.
 */
export async function createChangeFromCapture(args: {
  projectId: string;
  reporterId: string;
  reporterName: string;
  input: CaptureInput;
}): Promise<CaptureOutcome> {
  const { projectId, reporterId, reporterName, input } = args;
  // AI reads the message and proposes structure. It does not decide anything:
  // the change is created either way, and the extraction only fills fields in.
  //
  // `extractWithFallback` cannot throw for a provider reason — if Claude is
  // down, rate limited, or declines the message, the keyword reader answers
  // instead and says so. A site engineer's report must never be lost because
  // a third party is having a bad afternoon.
  const { envelope: extraction, provider: readBy, degraded } = await extractWithFallback({
    text: input.text,
    sourceType: input.channel,
    senderName: input.senderName ?? reporterName,
  });

  const eventDate = input.eventDate ?? todayUtc();

  // Asked as a capability, and asked out here rather than inside the
  // transaction, which holds a row lock on the project's PC counter.
  // Null means nobody on this project may assess a notice, and the change is
  // deliberately created unowned so it surfaces as a bottleneck instead of
  // sitting on someone who cannot act on it.
  const noticeOwner = await pickResponsibleMember(
    projectId,
    'potentialChange.assessNotice',
    NOTICE_ASSESSMENT_PREFERENCE,
  );
  const noticeRecipients = await loadRecipients([noticeOwner]);

  const outcome = await prisma.$transaction(async (tx): Promise<CaptureOutcome> => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { contractRules: true },
    });
    if (!project) {
      return { kind: 'needs_triage', reason: 'Project disappeared', candidateProjectIds: [] };
    }

    const [bumped] = await tx.$queryRaw<{ pc_sequence: number }[]>`
      UPDATE projects SET pc_sequence = pc_sequence + 1
      WHERE id = ${projectId}::uuid
      RETURNING pc_sequence
    `;
    if (!bumped) {
      return { kind: 'needs_triage', reason: 'Could not allocate a PC number', candidateProjectIds: [] };
    }

    const pcNumber = formatPcNumber(project.projectCode, bumped.pc_sequence);
    const noticePeriodDays = project.contractRules?.noticePeriodDays ?? 28;
    const noticeDueDate = calculateNoticeDueDate(eventDate, noticePeriodDays);


    const dueDays = project.contractRules?.pmScopeReviewDueDays ?? 3;
    const nextActionDue = new Date(todayUtc());
    nextActionDue.setUTCDate(nextActionDue.getUTCDate() + dueDays);

    const change = await tx.potentialChange.create({
      data: {
        projectId: projectId,
        pcNumber,
        title: extraction.extractedData.suggestedTitle,
        description: input.text,
        eventDate,
        sourceType: input.channel,
        sourceMessageId: input.externalMessageId,
        sourceSenderName: input.senderName ?? reporterName,
        sourceSenderPhoneOrEmail: input.senderIdentifier,
        sourceSenderAuthorityStatus: 'unknown',
        reportedByUserId: reporterId,
        // Taken from the message when it says so. It used to be dropped on the
        // floor: the model was asked for the location, answered, and nothing
        // read the answer — so a change that named "Reception, Level 2" arrived
        // with no location at all.
        location: extraction.extractedData.location,
        trade: extraction.extractedData.affectedTrade[0] ?? null,
        potentialTimeImpact: extraction.extractedData.possibleTimeImpact,
        currentStatus: 'notice_assessment',
        currentOwnerUserId: noticeOwner,
        waitingFor: 'Notice assessment',
        nextAction: 'Assess whether a contractual notice is required',
        nextActionDueDate: nextActionDue,
        noticeDueDate,
        noticeStatus: 'not_assessed',
        riskLevel: calculateNoticeCountdown(noticeDueDate).riskLevel,
      },
    });

    const assessmentTask = await tx.task.create({
      data: {
        projectId: projectId,
        potentialChangeId: change.id,
        taskType: 'notice_assessment',
        title: `Notice assessment — ${pcNumber}`,
        assignedToUserId: noticeOwner,
        dueDate: nextActionDue,
      },
    });

    await recordTaskNotifications(tx, {
      taskId: assessmentTask.id,
      potentialChangeId: change.id,
      kind: 'task_assigned',
      subject: `Notice assessment needed — ${pcNumber}`,
      body: `Captured from ${input.channel}: ${change.title}. Decide whether a contractual notice is required.`,
      on: todayUtc(),
      recipients: noticeRecipients,
    });

    await recordAudit({
      db: tx,
      projectId: projectId,
      userId: reporterId,
      recordType: 'potential_change',
      recordId: change.id,
      actionType: 'created',
      newValue: { pcNumber, title: change.title, source: input.channel },
      source: input.channel === 'whatsapp' ? 'whatsapp' : 'email',
      metadata: {
        externalMessageId: input.externalMessageId,
        aiConfidence: extraction.confidenceScore,
        aiMissingInformation: extraction.missingInformation,
        readBy,
      },
    });

    // The extraction is recorded as a suggestion in its own right, so a human
    // can see what the model thought and disagree with it.
    await recordAudit({
      db: tx,
      projectId: projectId,
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
        // WHICH reader produced this. A suggestion attributed to a model that
        // never ran would be a lie in the one record that has to be true.
        readBy,
        degraded,
      },
    });

    return {
      kind: 'created' as const,
      potentialChangeId: change.id,
      pcNumber,
      projectId: projectId,
    };
  });

  // ── Attachments become evidence ─────────────────────────────────────────
  // AFTER the transaction, never inside it. Uploading to Drive takes seconds
  // and Prisma's interactive transaction budget is five of them; a photo would
  // roll back the whole Potential Change, which is the record that matters.
  //
  // `storeCaptureEvidence` does not throw. A rejected file loses the file, not
  // the change — the notice clock is already running on it.
  const attachments = input.attachments ?? [];
  if (outcome.kind === 'created' && attachments.length > 0) {
    const filed = await storeCaptureEvidence({
      projectId: outcome.projectId,
      potentialChangeId: outcome.potentialChangeId,
      uploadedByUserId: reporterId,
      channel: input.channel,
      attachments,
    });

    await recordAudit({
      db: prisma,
      projectId: outcome.projectId,
      userId: reporterId,
      recordType: 'potential_change',
      recordId: outcome.potentialChangeId,
      actionType: 'uploaded',
      newValue: { attachments: attachments.length, stored: filed.stored },
      source: input.channel === 'whatsapp' ? 'whatsapp' : 'email',
      // What did NOT stick, and why. A silent skip is how a claim arrives at
      // adjudication with the one photograph that proved it simply absent.
      metadata: { skipped: filed.skipped },
    });
  }

  return outcome;
}

/* ─── Attachments carried on a parked message ────────────────────────────── */

/**
 * Reads the attachments back off a stored integration event.
 *
 * They are held in `payload_json` exactly as n8n sent them, base64 and all, so
 * a message parked for two days waiting on "which project?" still has its
 * photographs when the answer arrives. Storing only their names would mean the
 * evidence existed for as long as it took someone to reply.
 */
export function attachmentsFromPayload(payload: unknown): CaptureAttachment[] {
  const root = asRecord(payload);
  const message = asRecord(root.message);
  const raw = Array.isArray(root.attachments)
    ? root.attachments
    : Array.isArray(message.media)
      ? message.media
      : [];

  return raw.flatMap((entry): CaptureAttachment[] => {
    const item = asRecord(entry);
    const externalId = str(item.external_id) ?? str(item.file_name);
    const mimeType = str(item.mime_type);
    if (!externalId || !mimeType) return [];
    return [
      {
        externalId,
        fileName: str(item.file_name) ?? externalId,
        mimeType,
        contentBase64: str(item.content_base64) ?? undefined,
        url: str(item.url) ?? undefined,
      },
    ];
  });
}

async function attachmentsForEvent(eventId: string): Promise<CaptureAttachment[]> {
  const event = await prisma.integrationEvent.findUnique({
    where: { id: eventId },
    select: { payloadJson: true },
  });
  return event ? attachmentsFromPayload(event.payloadJson) : [];
}

/** Same file sent twice is one piece of evidence, not two. */
function mergeAttachments(
  first: CaptureAttachment[],
  second: CaptureAttachment[],
): CaptureAttachment[] {
  const byId = new Map<string, CaptureAttachment>();
  for (const attachment of [...first, ...second]) {
    if (!byId.has(attachment.externalId)) byId.set(attachment.externalId, attachment);
  }
  return [...byId.values()];
}

/* ─── Triage: the messages the system refused to guess about ─────────────── */

export interface TriageItem {
  eventId: string;
  source: IntegrationSource;
  receivedAt: Date;
  status: IntegrationEventStatus;
  reason: string;
  senderName: string | null;
  senderIdentifier: string | null;
  text: string;
  /** Projects the ORIGINAL sender is on. Empty when they are on none. */
  candidateProjectIds: string[];
  errorMessage: string | null;
}

/**
 * The inbox of captured messages waiting on a person.
 *
 * Scoped after the fact rather than in the query, because an event that could
 * not be placed on a project has no project to scope BY — that is the whole
 * reason it is here. So the list is drawn for people who can see everything
 * (the capability check in the page), and the act of filing one is what gets
 * checked against a specific project.
 */
export async function listTriageQueue(limit = 50): Promise<TriageItem[]> {
  const events = await listUnprocessedEvents(limit);

  return events.map((event) => {
    const payload = asRecord(event.payloadJson);
    const result = asRecord(event.resultJson);
    const sender = asRecord(payload.sender);
    const from = asRecord(payload.from);
    const message = asRecord(payload.message);

    return {
      eventId: event.id,
      source: event.source,
      receivedAt: event.receivedAt,
      status: event.status,
      reason: str(result.reason) ?? event.errorMessage ?? 'Waiting to be filed',
      senderName: str(sender.display_name) ?? str(from.name) ?? null,
      senderIdentifier: str(sender.phone) ?? str(from.address) ?? null,
      text:
        str(message.text) ??
        str(message.caption) ??
        str(payload.body_text) ??
        str(payload.subject) ??
        '[no text]',
      candidateProjectIds: Array.isArray(result.candidateProjectIds)
        ? (result.candidateProjectIds as string[])
        : [],
      errorMessage: event.errorMessage,
    };
  });
}

/**
 * Files a parked message against a project a human has chosen.
 *
 * Authority is checked against THAT project, not against the inbox. Being able
 * to see the queue is not the same as being able to put work on a job you have
 * nothing to do with, and the two are separate checks on purpose.
 *
 * The change is attributed to the ORIGINAL SENDER where they are a known user,
 * not to whoever filed it. The site engineer who saw the wall come down is the
 * person who reported it; the coordinator who moved it out of the inbox did
 * clerical work. Recording the clerk as the reporter would put their name on a
 * claim they know nothing about, and it is the reporter who gets asked to
 * explain it six months later.
 */
export async function fileTriagedEvent(
  user: AuthenticatedUser,
  input: { eventId: string; projectId: string },
): Promise<{ potentialChangeId: string; pcNumber: string }> {
  await assertProjectAccess(user, input.projectId, 'potentialChange.create');

  const event = await prisma.integrationEvent.findUnique({ where: { id: input.eventId } });
  if (!event) throw new NotFoundError('That captured message no longer exists');

  if (event.status === 'processed' || event.status === 'ignored') {
    throw new ValidationError('That message has already been dealt with');
  }

  const payload = asRecord(event.payloadJson);
  const sender = asRecord(payload.sender);
  const from = asRecord(payload.from);
  const message = asRecord(payload.message);

  const channel = event.source === 'whatsapp' ? 'whatsapp' : 'email';
  const senderIdentifier = str(sender.phone) ?? str(from.address) ?? '';
  const senderName = str(sender.display_name) ?? str(from.name) ?? null;

  const text =
    str(message.text) ??
    str(message.caption) ??
    str(payload.body_text) ??
    str(payload.subject) ??
    '[media only]';

  // Falls back to the person filing it only when the sender is not a user we
  // hold — an outside email, say. Attribution never silently becomes "nobody".
  const originalSender = senderIdentifier
    ? await prisma.user.findFirst({
        where:
          channel === 'whatsapp'
            ? { phone: senderIdentifier, active: true }
            : { email: senderIdentifier.toLowerCase(), active: true },
        select: { id: true, fullName: true },
      })
    : null;

  const outcome = await createChangeFromCapture({
    projectId: input.projectId,
    reporterId: originalSender?.id ?? user.id,
    reporterName: originalSender?.fullName ?? senderName ?? user.fullName,
    input: {
      channel,
      senderIdentifier: senderIdentifier || user.email,
      senderName,
      text,
      externalMessageId: event.externalId,
      eventDate: event.receivedAt,
      projectCodeHint: null,
      sourceSubject: str(payload.subject),
      // The photographs the message arrived with. Filing by hand must produce
      // the same record as filing by reply, evidence included — otherwise the
      // changes that needed a human are the ones missing their proof.
      attachments: attachmentsFromPayload(event.payloadJson),
    },
  });

  if (outcome.kind !== 'created') {
    throw new ValidationError(`Could not file it: ${outcome.reason}`);
  }

  await closeEvent(event.id, 'processed', {
    filedByUserId: user.id,
    filedAt: new Date().toISOString(),
    projectId: input.projectId,
    pcNumber: outcome.pcNumber,
    attributedToUserId: originalSender?.id ?? user.id,
  });

  return { potentialChangeId: outcome.potentialChangeId, pcNumber: outcome.pcNumber };
}

/**
 * Discards a captured message that is not a change at all.
 *
 * The event row stays, with the reason and who decided. Deleting it would make
 * "why did nothing happen when I sent that?" unanswerable, and that question
 * gets asked about the one message that mattered.
 */
export async function dismissTriagedEvent(
  user: AuthenticatedUser,
  input: { eventId: string; reason: string },
): Promise<void> {
  await assertCapability(user, 'potentialChange.create');

  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new ValidationError('Say why this is not a change. Somebody sent it for a reason.');
  }

  const event = await prisma.integrationEvent.findUnique({
    where: { id: input.eventId },
    select: { id: true, status: true },
  });
  if (!event) throw new NotFoundError('That captured message no longer exists');
  if (event.status === 'processed' || event.status === 'ignored') {
    throw new ValidationError('That message has already been dealt with');
  }

  await closeEvent(event.id, 'ignored', {
    dismissedByUserId: user.id,
    dismissedAt: new Date().toISOString(),
    reason,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
