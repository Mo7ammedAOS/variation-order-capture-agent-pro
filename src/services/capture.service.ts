import 'server-only';
import type {
  IntegrationEventStatus,
  IntegrationSource,
  Prisma,
  SourceType,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDate, todayUtc } from '@/lib/dates';
import { calculateNoticeDueDate } from '@/lib/dates';
import { calculateNoticeCountdown } from '@/lib/risk';
import { formatPcNumber } from '@/lib/pc-number';
import { recordAudit } from '@/services/audit-log.service';
import { pickResponsibleMember } from '@/services/permissions.service';
import {
  loadRecipients,
  recordDirectNotifications,
  recordTaskNotifications,
} from '@/services/notification.service';
import { listMembersWithCapability } from '@/services/permissions.service';
import { NOTICE_ASSESSMENT_PREFERENCE } from '@/lib/rbac';
import { extractWithFallback } from '@/integrations/claude';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { assertCapability, assertProjectAccess } from '@/services/project-access.service';
import { closeEvent, listUnprocessedEvents } from '@/services/integration.service';
import {
  acknowledgeCapture,
  askForDescription,
  askForDetail,
  askWhichChange,
  askWhichProject,
  confirmProject,
  hadRecentExchange,
  plannedDetailFields,
  tryAnswerQuestion,
  type QuestionReply,
} from '@/services/capture-question.service';
import { matchProjectsInText } from '@/lib/project-match';
import { cleanCapturedText } from '@/lib/email-cleanup';
import { briefOf } from '@/lib/change-brief';
import {
  isPleasantry,
  looksEvidenceOnly,
  parseDocumentReference,
  parseEventDate,
  parseWorkStatus,
} from '@/lib/reply-intent';
import {
  ambiguousSenderReason,
  resolveSender,
} from '@/services/sender-identity.service';
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
  /** Files landed on a change that already existed. Nothing new was opened. */
  | { kind: 'evidence_filed'; potentialChangeId: string; pcNumber: string; projectId: string; stored: number }
  /** A follow-up answer sharpened a change that was already on file. */
  | { kind: 'updated'; potentialChangeId: string; pcNumber: string; projectId: string; applied: string[] }
  | { kind: 'needs_triage'; reason: string; candidateProjectIds: string[] }
  /** The reporter withdrew it. Nothing was filed, and that was the right answer. */
  | { kind: 'cancelled'; reason: string }
  /** Courtesy, or a declined follow-up. There was never anything to file. */
  | { kind: 'closed'; reason: string };

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
  rawInput: CaptureInput,
  /** The event this message was recorded as. Needed to hang a question off it. */
  integrationEventId?: string,
): Promise<CaptureOutcome> {
  // Strip the email furniture FIRST, before anything reads the text.
  //
  // Not cosmetic. A signature reading "Site Engineer | Al Futtaim Contracting"
  // matches a client name, and the system would propose a project the message
  // was never about — a wrong answer delivered confidently. The same text also
  // becomes the description, which a notice prints verbatim.
  //
  // Deletion only. Nothing here rewrites a word the reporter wrote.
  const cleaned = cleanCapturedText(rawInput.text);
  const input: CaptureInput = { ...rawInput, text: cleaned.text };
  const attachments = input.attachments ?? [];

  // Is this an ANSWER to a question we already asked? Checked first, because
  // "2" from someone with a question outstanding is not a new change, and
  // treating it as one would file a Potential Change titled "2" and leave the
  // real report parked for ever.
  const answer = await tryAnswerQuestion({
    senderIdentifier: input.senderIdentifier,
    channel: input.channel,
    text: input.text,
  });

  if (answer) {
    const handled = await applyAnswer(answer, input, attachments);
    if (handled) return handled;
  }

  const identity = await resolveSender(input.channel, input.senderIdentifier);

  if (identity.kind === 'none') {
    return {
      kind: 'needs_triage',
      reason: `No active user matches ${input.channel} identifier ${input.senderIdentifier}`,
      candidateProjectIds: [],
    };
  }

  // Several people share this number. Picking one would put a colleague's name
  // on a claim they know nothing about, silently, and the audit trail would
  // agree with it. Park it and say why.
  if (identity.kind === 'ambiguous') {
    return {
      kind: 'needs_triage',
      reason: ambiguousSenderReason(identity, input.channel, input.senderIdentifier),
      candidateProjectIds: [],
    };
  }

  const sender = { id: identity.userId, fullName: identity.fullName };

  // "Thanks", "ok", "no that's all" — the end of an exchange, not the start of
  // a claim. Nothing here can ever be a change: a Potential Change titled
  // "thanks" is a junk record somebody has to close, and it used to be created
  // every single time anyone was polite to the system.
  //
  // Files override it. A photograph captioned "thanks" is still a photograph.
  if (attachments.length === 0 && isPleasantry(input.text)) {
    return closeCourteously(sender, input);
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

  // Files and nothing else. There is no report here to file, so the question
  // is not "which project" alone but "what are these of" — and the cheapest
  // form of that question is a list of what is already open on the job.
  const evidenceOnly = attachments.length > 0 && looksEvidenceOnly(input.text);

  // Only one live job: there is nothing to be wrong about.
  if (memberships.length === 1) {
    const only = memberships[0];
    if (!only) {
      return { kind: 'needs_triage', reason: 'No candidate project', candidateProjectIds: [] };
    }

    if (evidenceOnly && integrationEventId) {
      const asked = await askWhichChange({
        integrationEventId,
        userId: sender.id,
        projectId: only.projectId,
        channel: input.channel,
        evidenceCount: attachments.length,
        originalText: input.text,
        sourceMessageId: input.externalMessageId,
        sourceSubject: input.sourceSubject ?? null,
      });
      if (asked) {
        return {
          kind: 'needs_triage',
          reason:
            `${sender.fullName} sent ${attachments.length} file(s) with no message. ` +
            `Asked whether they belong to one of ${asked.offered} open changes on ` +
            `${only.project.projectCode} (${asked.token}).`,
          candidateProjectIds: [only.projectId],
        };
      }
    }

    return fileAndFollowUp({
      projectId: only.projectId,
      reporterId: sender.id,
      reporterName: sender.fullName,
      input,
      integrationEventId: integrationEventId ?? null,
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
  const proposal = !evidenceOnly && matches.length === 1 ? matches[0] : null;
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
        evidenceCount: evidenceOnly ? attachments.length : 0,
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

/* ─── Answers to questions we already asked ──────────────────────────────── */

/**
 * Acts on a reply, or hands the message back to be read as a new report.
 *
 * Returns null only when the reply settled nothing, which cannot currently
 * happen — `tryAnswerQuestion` returns null rather than an outcome it cannot
 * act on. The nullable return keeps that contract explicit rather than relying
 * on it.
 */
async function applyAnswer(
  answer: QuestionReply,
  input: CaptureInput,
  attachments: CaptureAttachment[],
): Promise<CaptureOutcome | null> {
  // "cancel", "ignore", "forget it" — the reporter closing their own loop.
  // Nothing is filed and the message leaves the inbox, because a withdrawn
  // report waiting on a coordinator is worse than no report at all: somebody
  // spends time on it and finds there was nothing there.
  if (answer.outcome === 'cancelled') {
    await closeEvent(answer.integrationEventId, 'ignored', {
      cancelledByUserId: answer.userId,
      cancelledAt: new Date().toISOString(),
      reason: 'Withdrawn by the reporter',
      via: input.channel,
    });

    await acknowledgeCapture({
      userId: answer.userId,
      token: ackToken(answer),
      text: 'Cancelled. Nothing has been recorded against any project.',
      sourceMessageId: answer.sourceMessageId,
      sourceSubject: answer.sourceSubject,
    });

    return { kind: 'cancelled', reason: `${answer.userName} withdrew it` };
  }

  // They declined the follow-up. The change stands exactly as it was; the only
  // thing that closes is the question.
  if (answer.outcome === 'declined') {
    await acknowledgeCapture({
      userId: answer.userId,
      token: ackToken(answer),
      text: 'No problem, leaving it as it is.',
      potentialChangeId: answer.potentialChangeId,
      sourceMessageId: answer.sourceMessageId,
      sourceSubject: answer.sourceSubject,
    });
    return { kind: 'closed', reason: `${answer.userName} skipped the follow-up` };
  }

  if (answer.outcome === 'detailed' && answer.potentialChangeId) {
    return applyCaptureDetails(answer, input, attachments);
  }

  // The files belong to a change that already exists. Nothing new is opened,
  // which is the whole reason the question was asked: a second Potential
  // Change for the same event splits the evidence across two claims and both
  // of them get priced short.
  if (answer.outcome === 'attach_existing' && answer.potentialChangeId && answer.projectId) {
    return attachEvidenceToChange(answer, input, attachments);
  }

  // "New one." We have the project and the files but still no statement of
  // what changed, and a Potential Change with photographs and no description
  // is not a claim, it is a puzzle.
  if (answer.outcome === 'attach_new' && answer.projectId) {
    const pending = await attachmentsForEvent(answer.integrationEventId);
    const asked = await askForDescription({
      integrationEventId: answer.integrationEventId,
      userId: answer.userId,
      projectId: answer.projectId,
      evidenceCount: pending.length || attachments.length,
      originalText: answer.originalText,
      sourceMessageId: answer.sourceMessageId,
      sourceSubject: answer.sourceSubject,
    });

    return {
      kind: 'needs_triage',
      reason: asked
        ? `${answer.userName} says the files are a new change. Asked what changed (${asked.token}).`
        : `${answer.userName} says the files are a new change, but we could not ask what changed.`,
      candidateProjectIds: answer.projectId ? [answer.projectId] : [],
    };
  }

  // The line we were waiting for. File it, with the files that were waiting
  // on it.
  if (answer.outcome === 'described' && answer.projectId) {
    const pending = await attachmentsForEvent(answer.integrationEventId);
    return fileAndFollowUp({
      projectId: answer.projectId,
      reporterId: answer.userId,
      reporterName: answer.userName,
      input: {
        ...input,
        text: answer.replyText,
        attachments: mergeAttachments(pending, attachments),
      },
      integrationEventId: answer.integrationEventId,
      closeEventId: answer.integrationEventId,
      sourceMessageId: answer.sourceMessageId,
      sourceSubject: answer.sourceSubject,
    });
  }

  if (answer.outcome === 'answered' && answer.projectId) {
    // The attachments came with the ORIGINAL message, not with the word "yes".
    // Reading them off this reply alone would file the change and quietly lose
    // the photographs it was reported with.
    const original = await attachmentsForEvent(answer.integrationEventId);
    const carried = mergeAttachments(original, attachments);

    // The project is settled, but the original message was files and nothing
    // else — so there is still no report to file. Ask what they are of.
    if (looksEvidenceOnly(answer.originalText) && carried.length > 0) {
      const asked = await askWhichChange({
        integrationEventId: answer.integrationEventId,
        userId: answer.userId,
        projectId: answer.projectId,
        channel: input.channel,
        evidenceCount: carried.length,
        originalText: answer.originalText,
        sourceMessageId: answer.sourceMessageId,
        sourceSubject: answer.sourceSubject,
      });

      return {
        kind: 'needs_triage',
        reason: asked
          ? `Project settled. Asked ${answer.userName} what the ${carried.length} file(s) are of (${asked.token}).`
          : `Project settled, but we could not ask what the files are of.`,
        candidateProjectIds: [answer.projectId],
      };
    }

    return fileAndFollowUp({
      projectId: answer.projectId,
      reporterId: answer.userId,
      reporterName: answer.userName,
      input: {
        ...input,
        text: answer.originalText || input.text,
        attachments: carried,
      },
      integrationEventId: answer.integrationEventId,
      closeEventId: answer.integrationEventId,
      sourceMessageId: answer.sourceMessageId,
      sourceSubject: answer.sourceSubject,
    });
  }

  // "No, wrong project." Put the full list back to them on the same thread,
  // rather than leaving someone who answered correctly with nothing to do.
  if (answer.outcome === 'rejected') {
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

  return null;
}

/** Unique per question, so a retried delivery writes one acknowledgement. */
function ackToken(answer: QuestionReply): string {
  return answer.questionId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * Files the change, tells the reporter, then asks for what is still missing.
 *
 * The order is the whole design. The change exists — and the notice clock with
 * it — before any follow-up is sent, so an unanswered question can never be
 * the reason a deadline passed. Everything after the filing is improvement.
 */
async function fileAndFollowUp(args: {
  projectId: string;
  reporterId: string;
  reporterName: string;
  input: CaptureInput;
  integrationEventId: string | null;
  closeEventId?: string;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
}): Promise<CaptureOutcome> {
  const outcome = await createChangeFromCapture({
    projectId: args.projectId,
    reporterId: args.reporterId,
    reporterName: args.reporterName,
    input: args.input,
  });

  if (outcome.kind !== 'created') return outcome;

  if (args.closeEventId) {
    await closeEvent(args.closeEventId, 'processed', {
      answeredBy: args.reporterId,
      answeredAt: new Date().toISOString(),
      projectId: args.projectId,
      pcNumber: outcome.pcNumber,
      via: args.input.channel,
    });
  }

  // Tell them it landed, and where. Without this the exchange just stops, and
  // a reporter who is not told assumes he was not heard.
  //
  // QUOTES THE REPORT IT FILED, and that is load bearing. A token-less reply
  // is applied to the most recent open question, which is right almost always
  // and wrong occasionally; this line is what makes the occasional case
  // survivable. The reporter reads back his own words and knows within seconds
  // whether the right thing was filed.
  const filed = args.input.text.trim();
  const excerpt = filed.length > 100 ? `${filed.slice(0, 100).trimEnd()}…` : filed;
  const files = args.input.attachments?.length ?? 0;
  const evidenceLine = files > 0 ? `\n${files} ${files === 1 ? 'file' : 'files'} attached as evidence.` : '';

  await acknowledgeCapture({
    userId: args.reporterId,
    token: outcome.pcNumber,
    potentialChangeId: outcome.potentialChangeId,
    text:
      `Filed as ${outcome.pcNumber}.\n\n"${excerpt}"\n${evidenceLine}\n` +
      `A notice assessment has been raised and the contractual clock is ` +
      `running from the date of the event. Reply CANCEL if that is the wrong report.`,
    sourceMessageId: args.sourceMessageId ?? args.input.externalMessageId,
    sourceSubject: args.sourceSubject ?? args.input.sourceSubject ?? null,
    // The follow-up below carries the invitation instead, so the reporter is
    // not asked two different questions in two messages seconds apart.
    invite: false,
  });

  // What is still missing, and worth one more message.
  const fields = plannedDetailFields({
    text: args.input.text,
    eventDateKnown: parseEventDate(args.input.text, todayUtc()) !== null,
    documentReferenceKnown: parseDocumentReference(args.input.text) !== null,
    workStatusKnown: parseWorkStatus(args.input.text) !== null,
  });

  if (fields.length > 0 && args.integrationEventId) {
    await askForDetail({
      integrationEventId: args.integrationEventId,
      userId: args.reporterId,
      projectId: args.projectId,
      potentialChangeId: outcome.potentialChangeId,
      pcNumber: outcome.pcNumber,
      fields,
      originalText: args.input.text,
      sourceMessageId: args.sourceMessageId ?? args.input.externalMessageId,
      sourceSubject: args.sourceSubject ?? args.input.sourceSubject ?? null,
    });
  }

  return outcome;
}

/**
 * Files new evidence on a change that already exists.
 *
 * No new Potential Change, deliberately. Two changes describing one event is
 * the failure this question exists to prevent: the evidence splits across
 * them, each is priced on half the story, and the duplicate is closed months
 * later by somebody who cannot tell which one the client actually saw.
 */
async function attachEvidenceToChange(
  answer: QuestionReply,
  input: CaptureInput,
  attachments: CaptureAttachment[],
): Promise<CaptureOutcome> {
  const change = await prisma.potentialChange.findUnique({
    where: { id: answer.potentialChangeId! },
    select: { id: true, pcNumber: true, projectId: true, title: true, summary: true, description: true },
  });
  if (!change) {
    return {
      kind: 'needs_triage',
      reason: 'The change those files were for no longer exists',
      candidateProjectIds: answer.projectId ? [answer.projectId] : [],
    };
  }

  const pending = await attachmentsForEvent(answer.integrationEventId);
  const all = mergeAttachments(pending, attachments);

  const filed = await storeCaptureEvidence({
    projectId: change.projectId,
    potentialChangeId: change.id,
    uploadedByUserId: answer.userId,
    channel: input.channel,
    attachments: all,
  });

  await recordAudit({
    db: prisma,
    projectId: change.projectId,
    userId: answer.userId,
    recordType: 'potential_change',
    recordId: change.id,
    actionType: 'uploaded',
    newValue: { attachments: all.length, stored: filed.stored },
    source: input.channel === 'whatsapp' ? 'whatsapp' : 'email',
    // What did NOT stick, and why. A silent skip is how a claim arrives at
    // adjudication with the one photograph that proved it simply absent.
    metadata: { skipped: filed.skipped, attachedByReply: true },
  });

  await closeEvent(answer.integrationEventId, 'processed', {
    attachedToPotentialChangeId: change.id,
    pcNumber: change.pcNumber,
    stored: filed.stored,
    answeredBy: answer.userId,
    answeredAt: new Date().toISOString(),
  });

  const noun = filed.stored === 1 ? 'file' : 'files';
  await acknowledgeCapture({
    userId: answer.userId,
    token: ackToken(answer),
    potentialChangeId: change.id,
    text:
      `${filed.stored} ${noun} added to ${change.pcNumber} — ${briefOf(change)}.` +
      (filed.skipped.length > 0
        ? `\n\n${filed.skipped.length} could not be stored: ${filed.skipped.map((s) => s.fileName).join(', ')}.`
        : ''),
    sourceMessageId: answer.sourceMessageId,
    sourceSubject: answer.sourceSubject,
  });

  return {
    kind: 'evidence_filed',
    potentialChangeId: change.id,
    pcNumber: change.pcNumber,
    projectId: change.projectId,
    stored: filed.stored,
  };
}

/**
 * Applies a follow-up answer to a change that is already on file.
 *
 * The event date is the one that matters. It is not a tidy-up field: the
 * notice deadline is the event date plus the contract's notice period, so
 * moving it moves the deadline and the risk colour with it. A change reported
 * nine days after it happened has nineteen days left and not twenty eight, and
 * a system that never asks quietly tells the commercial manager otherwise.
 *
 * The reply is also appended to the description verbatim, whether or not
 * anything parsed out of it. The description is the reporter's own words and
 * this is more of them; dropping the half we could not read would lose the
 * sentence that turns out to matter.
 */
async function applyCaptureDetails(
  answer: QuestionReply,
  input: CaptureInput,
  attachments: CaptureAttachment[],
): Promise<CaptureOutcome> {
  const change = await prisma.potentialChange.findUnique({
    where: { id: answer.potentialChangeId! },
    select: {
      id: true,
      pcNumber: true,
      projectId: true,
      description: true,
      eventDate: true,
      sourceReference: true,
      workStatus: true,
      project: { select: { projectCode: true, contractRules: { select: { noticePeriodDays: true } } } },
    },
  });
  if (!change) {
    return {
      kind: 'needs_triage',
      reason: 'The change that follow-up was about no longer exists',
      candidateProjectIds: answer.projectId ? [answer.projectId] : [],
    };
  }

  const reply = answer.replyText.trim();
  const applied: string[] = [];
  const data: Prisma.PotentialChangeUpdateInput = {};

  const dated = parseEventDate(reply, todayUtc());
  if (dated && dated.date.getTime() !== change.eventDate.getTime()) {
    const noticePeriodDays = change.project.contractRules?.noticePeriodDays ?? 28;
    const noticeDueDate = calculateNoticeDueDate(dated.date, noticePeriodDays);
    data.eventDate = dated.date;
    data.noticeDueDate = noticeDueDate;
    data.riskLevel = calculateNoticeCountdown(noticeDueDate).riskLevel;
    // Echoed as "28 Aug 2026", never as digits. This project has already had
    // one document misread day-for-month, and the only defence that works is
    // showing the reader a date that cannot be read two ways.
    applied.push(`event date ${formatDate(dated.date)}, notice due ${formatDate(noticeDueDate)}`);
  }

  const reference = parseDocumentReference(reply, [change.project.projectCode]);
  if (reference && reference !== change.sourceReference) {
    data.sourceReference = reference;
    applied.push(`reference ${reference}`);
  }

  const work = parseWorkStatus(reply);
  if (work && work !== change.workStatus) {
    data.workStatus = work;
    applied.push(`work ${work.replace(/_/g, ' ')}`);
  }

  data.description = `${change.description}\n\nFollow-up from ${answer.userName}: ${reply}`;

  await prisma.potentialChange.update({ where: { id: change.id }, data });

  await recordAudit({
    db: prisma,
    projectId: change.projectId,
    userId: answer.userId,
    recordType: 'potential_change',
    recordId: change.id,
    actionType: 'updated',
    oldValue: {
      eventDate: change.eventDate,
      sourceReference: change.sourceReference,
      workStatus: change.workStatus,
    },
    newValue: { reply, applied },
    source: input.channel === 'whatsapp' ? 'whatsapp' : 'email',
    metadata: { askedFor: answer.detailFields },
  });

  // Files sent with the follow-up are evidence on the same change — a drawing
  // sent in answer to "which drawing?" is exactly the document the claim needs.
  let stored = 0;
  if (attachments.length > 0) {
    const evidence = await storeCaptureEvidence({
      projectId: change.projectId,
      potentialChangeId: change.id,
      uploadedByUserId: answer.userId,
      channel: input.channel,
      attachments,
    });
    stored = evidence.stored;
  }

  const filesLine = stored > 0 ? ` ${stored} ${stored === 1 ? 'file' : 'files'} attached.` : '';
  await acknowledgeCapture({
    userId: answer.userId,
    token: ackToken(answer),
    potentialChangeId: change.id,
    text:
      applied.length > 0
        ? `${change.pcNumber} updated: ${applied.join('; ')}.${filesLine}`
        : `Noted on ${change.pcNumber}.${filesLine}`,
    sourceMessageId: answer.sourceMessageId,
    sourceSubject: answer.sourceSubject,
  });

  return {
    kind: 'updated',
    potentialChangeId: change.id,
    pcNumber: change.pcNumber,
    projectId: change.projectId,
    applied,
  };
}

/**
 * Answers courtesy with courtesy, and files nothing.
 *
 * Two shapes, because "thanks" means different things depending on whether
 * anything just happened. Mid-conversation it is the end of one, and the right
 * reply invites the next report. Out of the blue it is more likely somebody
 * testing whether the number is alive, and the right reply tells them what it
 * is for.
 */
async function closeCourteously(
  sender: { id: string; fullName: string },
  input: CaptureInput,
): Promise<CaptureOutcome> {
  const recent = await hadRecentExchange(sender.id);
  const token = `HI${input.externalMessageId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`;

  await acknowledgeCapture({
    userId: sender.id,
    token,
    text: recent
      ? 'Any time.'
      : 'Nothing to file from that. Send a line about what changed, or a photo, and I will log it.',
    sourceMessageId: input.externalMessageId,
    sourceSubject: input.sourceSubject ?? null,
    invite: recent,
  });

  return { kind: 'closed', reason: `${sender.fullName} sent a courtesy reply — nothing to file` };
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
  const { projectId, reporterId, reporterName } = args;

  // Cleaned again here, not only in `captureFromChannel`. This function is
  // also the triage path — a coordinator filing a parked message by hand — and
  // a change filed by hand must come out identical to one filed by reply,
  // signature stripping included. Cleaning already clean text is a no-op.
  const cleanedReport = cleanCapturedText(args.input.text);
  const input: CaptureInput = { ...args.input, text: cleanedReport.text };
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

  // When it HAPPENED, if the report says so — not when the message arrived.
  //
  // The notice deadline counts from this date, so a change reported nine days
  // late has nineteen days left and not twenty eight. Reading "yesterday" out
  // of the message costs nothing and is right far more often than assuming
  // today, and where it cannot be read the follow-up asks.
  const reportedDate = parseEventDate(input.text, todayUtc());
  const eventDate = reportedDate?.date ?? input.eventDate ?? todayUtc();

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

  // The PM and the MD hear about it the moment it lands, before anybody has
  // assessed anything.
  //
  // Osman's call, 2026-09-02. The reasoning: the notice decision is theirs to
  // make and the clock is already running, so waiting for a coordinator to
  // notice a task in a list spends the only thing that cannot be recovered.
  //
  // Resolved through the permission matrix, never by role name. Routing by
  // role once put a notice assessment on a project manager the app then
  // refused, with no button and no explanation.
  const [projectManagers, managingDirectors] = await Promise.all([
    listMembersWithCapability(projectId, 'approval.projectManager'),
    listMembersWithCapability(projectId, 'approval.managingDirector'),
  ]);
  const watchers = [
    ...new Set([...projectManagers, ...managingDirectors].map((member) => member.userId)),
  ].filter((id) => id !== noticeOwner);
  const watcherRecipients = await loadRecipients(watchers);

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
        // The reporter's own words. A notice prints this verbatim.
        description: input.text,
        // The model's tidy restatement, beside it and never instead of it.
        // Dropped when it adds nothing — the keyword fallback simply echoes
        // the message back, and storing that would dress up a copy as a
        // reading, which is the one thing an AI field must never do.
        summary: standardisedSummary(extraction.extractedData.changeDescription, input.text),
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
        // The drawing, RFI or site instruction the change hangs off, when the
        // report names one. Excluded from matching against the project's own
        // code, because "AR-201" and "DXB-001" are the same shape and a
        // plausible wrong reference on a claim is worse than none.
        sourceReference: parseDocumentReference(input.text, [project.projectCode]),
        // Work already under way on an uninstructed change is the expensive
        // case, and it changes how the assessment is read.
        workStatus: parseWorkStatus(input.text) ?? 'not_started',
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

    // Told, not tasked. They are not being asked to assess it — that task
    // belongs to one person and stays there. This is so nobody senior first
    // hears about a change when the notice period is half gone.
    if (watcherRecipients.length > 0) {
      await recordDirectNotifications(tx, {
        kind: 'task_assigned',
        potentialChangeId: change.id,
        subject: `New potential change — ${pcNumber}`,
        body:
          `${input.senderName ?? reporterName} reported this on ${project.projectCode}:\n\n` +
          `"${input.text.length > 200 ? `${input.text.slice(0, 200).trimEnd()}…` : input.text}"\n\n` +
          `Filed as ${pcNumber}. Notice due ${formatDate(noticeDueDate)}. ` +
          `The assessment is with the commercial team.`,
        recipients: watcherRecipients,
        dedupeSeed: `raised:${change.id}`,
        on: new Date(),
      });
    }

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

/**
 * The model's restatement, or nothing.
 *
 * Returns null when the "summary" is really just the message again. The
 * keyword fallback echoes the text verbatim by design, and a field labelled as
 * a reading that contains a copy is worse than an empty one: it tells a
 * commercial manager the system understood something when it did not.
 */
function standardisedSummary(candidate: string, reported: string): string | null {
  const summary = candidate?.trim();
  if (!summary) return null;

  const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalise(summary) === normalise(reported)) return null;

  return summary;
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
  // Ambiguous resolves to null here rather than to a guess, so a shared number
  // attributes the change to whoever FILED it — a fact — instead of to one of
  // several people who might have sent it. The audit trail then says a
  // coordinator filed it, which is true and checkable.
  const identity = senderIdentifier ? await resolveSender(channel, senderIdentifier) : null;
  const originalSender = identity?.kind === 'one'
    ? { id: identity.userId, fullName: identity.fullName }
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
    const why = 'reason' in outcome ? outcome.reason : `it came back as ${outcome.kind}`;
    throw new ValidationError(`Could not file it: ${why}`);
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
