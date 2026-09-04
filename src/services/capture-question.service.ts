import 'server-only';
import type { CaptureQuestion, CaptureQuestionKind, Prisma, SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  dispatchNow,
  loadRecipients,
  recordDirectNotifications,
} from '@/services/notification.service';
import { codePattern, describeMatch, type ProjectMatch } from '@/lib/project-match';
import { briefOf, matchChangeByWords, matchChangeInText } from '@/lib/change-brief';
import {
  closingLine,
  isNewChangeRequest,
  isPleasantry,
  mentionsDocument,
  parseDocumentReference,
  parseAnswerForField,
  parseEventDate,
  parseWorkStatus,
} from '@/lib/reply-intent';
import { resolveSender } from '@/services/sender-identity.service';

/**
 * The conversation.
 *
 * ── Why the system asks instead of deciding ────────────────────────────────
 * A site engineer on four active jobs writes "client wants the wall moved" and
 * names none of them. There are three bad answers and one good one:
 *
 *   Guess           — a change filed against the wrong job LOOKS handled, so
 *                     nobody ever checks it again. The worst outcome, because
 *                     it is invisible.
 *   Park it         — the coordinator who opens the inbox knows LESS than the
 *                     reporter did. It moves the guess, it does not remove it.
 *   Drop it         — obviously not.
 *   Ask the person  — he is the only one who knows.
 *
 * ── Five shapes of question ────────────────────────────────────────────────
 * CHOOSE   — nothing named a project. Here is your list, pick.
 * CONFIRM  — the message named a code or the client, and one job fits.
 * ATTACH   — files arrived with no words. New change, or one of these?
 * DESCRIBE — they said "new", so ask for the one line we still need.
 * DETAIL   — asked AFTER filing: when did it happen, which drawing.
 *
 * The first three block: nothing is written until they answer. DETAIL never
 * blocks, and that ordering is the point. The notice clock starts the moment
 * the change exists, so the change is created first and improved second — a
 * follow-up question must never be the reason a deadline was missed.
 *
 * ── Why the candidates are frozen ──────────────────────────────────────────
 * The list is stored when the question is asked. Reading his memberships again
 * at answer time would mean "2" quietly pointing at a different project if he
 * were added to a job in between — and he would have no way of knowing.
 *
 * ── The first element of a CONFIRM question is the proposal ────────────────
 * `candidateProjectIds[0]` is what we are proposing; the rest are his other
 * live jobs, carried so that "no, it is DXB-002" resolves in one reply instead
 * of being read as a brand new report. Nothing else may reorder that array.
 */

/** Ambiguous characters are omitted: no O/0, no I/1. People retype these. */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 4;

/**
 * How long each shape of question stays answerable by its token.
 *
 * A parked report can wait a week, because nothing has been written and the
 * reporter is the only person who can unpark it. A follow-up on a change that
 * is already filed cannot: after two days the answer would be arriving into a
 * notice assessment that has already been made on the facts as they stood.
 */
const EXPIRES_AFTER_DAYS: Record<CaptureQuestionKind, number> = {
  choose: 7,
  confirm: 7,
  attach: 3,
  describe: 3,
  detail: 2,
  // The shortest of the lot. A read-back is only meaningful while the exchange
  // it summarises is still in the reporter's head.
  summary: 1,
};

/**
 * How long a token-less reply is still read as part of the conversation.
 *
 * A bare "2" only means "the thing you just asked me". After this long it is
 * far likelier to be a new report that starts with a number, and reading it as
 * an answer would throw that report away.
 *
 * Shorter for a follow-up, because a follow-up is competing with real reports:
 * anything arriving hours after a change was filed is much more likely to be
 * the next change than a belated answer about the last one.
 */
const CONVERSATION_WINDOW_MS: Record<CaptureQuestionKind, number> = {
  choose: 12 * 60 * 60 * 1000,
  confirm: 12 * 60 * 60 * 1000,
  attach: 12 * 60 * 60 * 1000,
  describe: 12 * 60 * 60 * 1000,
  detail: 6 * 60 * 60 * 1000,
  summary: 6 * 60 * 60 * 1000,
};

/** Whole-reply agreement. Every word has to be one of these, or it is not a yes. */
const AFFIRMATIVE = new Set([
  'YES', 'Y', 'YEP', 'YEAH', 'YUP', 'CORRECT', 'CONFIRM', 'CONFIRMED', 'RIGHT',
  'THATS', 'THAT', 'IS', 'OK', 'OKAY', 'SURE', 'TRUE', 'PLEASE', 'GO', 'AHEAD',
]);

const NEGATIVE = new Set([
  'NO', 'NOPE', 'NOT', 'WRONG', 'INCORRECT', 'NEGATIVE', 'THATS', 'THAT', 'IS', 'IT',
]);

/**
 * Closing the conversation without filing anything.
 *
 * A reporter who realises it is not a change needs a way to say so, or the
 * question sits open for seven days and the message sits in the inbox waiting
 * for a coordinator who will never know it was withdrawn.
 */
const CANCEL = new Set([
  'CANCEL', 'CANCELLED', 'IGNORE', 'DISREGARD', 'FORGET', 'NEVERMIND', 'NEVER',
  'MIND', 'IT', 'STOP', 'DELETE', 'REMOVE', 'NOTHING', 'MISTAKE', 'SORRY',
  // Filler that carries no meaning of its own, so "my mistake" and "it was a
  // mistake" read the same as "cancel". None of these can cancel alone: the
  // rule is that EVERY word must be in this set, and a reply of just "was"
  // still has to get past the four word ceiling and mean something.
  'MY', 'WAS', 'A', 'THIS', 'THAT',
]);

/** Declining a follow-up, which is not the same as withdrawing a change. */
const SKIP = new Set([
  'SKIP', 'PASS', 'LATER', 'DONT', 'DO', 'NOT', 'KNOW', 'UNSURE', 'NA', 'N',
  'A', 'NO', 'IDEA', 'SURE', 'CANT', 'SAY', 'I', 'DONT',
]);

/**
 * Words that can sit in front of a number without changing its meaning.
 *
 * "2", "no 2", "project 2", "option 2", "#2" are the same answer. Anything
 * else in the reply and it stops being a bare answer and becomes a report,
 * which is the distinction the strict rule below exists to protect.
 */
const NUMBER_PREFIXES = new Set(['NO', 'NUMBER', 'PROJECT', 'OPTION', 'ITS', 'IT', 'IS', 'THE']);

/** Beyond this a follow-up reply is a new report, not an answer about the last one. */
const DETAIL_ANSWER_MAX_WORDS = 25;

/** Below this an unmatched reply to an ATTACH question is a typo, not a description. */
const DESCRIPTION_MIN_WORDS = 3;

export interface AskInput {
  integrationEventId: string;
  userId: string;
  userName: string;
  channel: Extract<SourceType, 'whatsapp' | 'email'>;
  originalText: string;
  candidateProjectIds: string[];
  /** The inbound message id, so the question goes back on its own thread. */
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
  /** Files that came with it, when the message was files and nothing else. */
  evidenceCount?: number;
  /**
   * The facts still missing, asked in the SAME message as the project.
   *
   * One message, one reply, one filing. Asking which project, waiting, filing,
   * then asking two more things is three exchanges for one report — and by the
   * third the man has moved on and the answer never comes.
   */
  fields?: DetailField[];
}

export interface ConfirmInput extends Omit<AskInput, 'candidateProjectIds'> {
  /** The project the text pointed at. */
  proposedProjectId: string;
  /** What in the text pointed at it. Quoted back so the person can judge it. */
  match: ProjectMatch;
  /** Their other live jobs, so "no, it is the other one" resolves in one reply. */
  otherProjectIds: string[];
}

export interface AnswerAttempt {
  senderIdentifier: string;
  channel: Extract<SourceType, 'whatsapp' | 'email'>;
  text: string;
}

export type ReplyOutcome =
  /** A project was settled, and the parked report can be filed. */
  | 'answered'
  /** Wrong project. The caller re-asks with the full list. */
  | 'rejected'
  /** Withdrawn. Nothing is filed. */
  | 'cancelled'
  /** These files belong to a change that already exists. */
  | 'attach_existing'
  /** These files are a new change, and we still need a line about it. */
  | 'attach_new'
  /** Here is that line. */
  | 'described'
  /** Here are the facts the follow-up asked for. */
  | 'detailed'
  /** They declined the follow-up. Nothing changes and the question closes. */
  | 'declined';

/**
 * What an incoming message turned out to be.
 *
 * One shape rather than a discriminated union, because callers read the same
 * fields either way and the only difference is which of them are populated.
 */
export interface QuestionReply {
  outcome: ReplyOutcome;
  kind: CaptureQuestionKind;
  questionId: string;
  integrationEventId: string;
  userId: string;
  userName: string;
  /** The settled project. Null when they told us we had the wrong one. */
  projectId: string | null;
  /** The change this reply is about, for an attach or a follow-up. */
  potentialChangeId: string | null;
  /** What was originally reported — the text the question was asked about. */
  originalText: string;
  /** What they just said. */
  replyText: string;
  /** Their live jobs as frozen when we asked, for the re-ask after a "no". */
  candidateProjectIds: string[];
  /** Which facts the follow-up asked for. */
  detailFields: string[];
  /** Carried so a re-ask stays on the same email thread as the first question. */
  sourceMessageId: string | null;
  sourceSubject: string | null;
}

function newToken(): string {
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return out;
}

function excerptOf(text: string, limit = 160): string {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

/** "Re:" on the original subject, so it reads as a reply and not as a robot. */
function replySubject(sourceSubject: string | null | undefined, token: string): string {
  const base = (sourceSubject ?? '').trim();
  if (!base) return `Which project? [${token}]`;
  const stripped = base.replace(/^((re|fw|fwd)\s*:\s*)+/i, '');
  return `Re: ${stripped} [${token}]`;
}

/**
 * Writes the question and queues it, replacing any earlier question on the
 * same message.
 *
 * Replacing rather than adding: one inbound message is one open question. A
 * "no" to a confirmation re-asks on the SAME row, so the reporter never has two
 * live tokens for one report and cannot answer the dead one.
 */
/**
 * How many times one question may be put to the same person.
 *
 * Two. The first ask, and one more when a reply answered part of it. A third
 * is not persistence, it is nagging: nobody who ignored a question twice
 * answers it the third time, and the cost of asking is that he starts ignoring
 * the ones that matter. When the cap is reached the caller is told (null) and
 * proceeds on what it already has.
 */
const MAX_ASKS = 2;

async function putQuestion(input: {
  integrationEventId: string;
  userId: string;
  kind: CaptureQuestionKind;
  candidateProjectIds: string[];
  candidateChangeIds?: string[];
  projectId?: string | null;
  potentialChangeId?: string | null;
  detailFields?: string[];
  askedText: string;
  sourceMessageId: string | null;
  sourceSubject: string | null;
  subject: string;
  body: string;
  token: string;
}): Promise<boolean> {
  const recipients = await loadRecipients([input.userId]);
  if (recipients.length === 0) return false;

  // A re-ask lands on the same row, so the count is read from what is already
  // there rather than tracked in memory across two separate requests.
  const previous = await prisma.captureQuestion.findUnique({
    where: { integrationEventId: input.integrationEventId },
    select: { kind: true, askCount: true },
  });
  const repeat = previous?.kind === input.kind;
  const askCount = repeat ? previous.askCount + 1 : 1;
  if (askCount > MAX_ASKS) return false;

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + EXPIRES_AFTER_DAYS[input.kind]);

  await prisma.$transaction(async (tx) => {
    const data = {
      userId: input.userId,
      kind: input.kind,
      token: input.token,
      candidateProjectIds: input.candidateProjectIds,
      candidateChangeIds: input.candidateChangeIds ?? [],
      projectId: input.projectId ?? null,
      potentialChangeId: input.potentialChangeId ?? null,
      detailFields: input.detailFields ?? [],
      askedText: input.askedText,
      sourceMessageId: input.sourceMessageId,
      sourceSubject: input.sourceSubject,
      status: 'open' as const,
      chosenProjectId: null,
      answeredAt: null,
      askedAt: new Date(),
      askCount,
      expiresAt,
    };

    await tx.captureQuestion.upsert({
      where: { integrationEventId: input.integrationEventId },
      create: { integrationEventId: input.integrationEventId, ...data },
      update: data,
    });

    await recordDirectNotifications(tx as Prisma.TransactionClient, {
      kind: 'capture_question',
      subject: input.subject,
      body: input.body,
      recipients,
      dedupeSeed: `question:${input.token}`,
      on: new Date(),
      replyToMessageId: input.sourceMessageId,
      potentialChangeId: input.potentialChangeId ?? null,
    });
  });

  // Out of the door NOW, not on the next sweep. AFTER the transaction, because
  // this makes network calls and the transaction holds row locks — the same
  // rule that cost this project a duplicated Drive folder tree once already.
  await dispatchNow(`question:${input.token}`);
  return true;
}

/**
 * Puts the list to the reporter on every channel we hold for them.
 *
 * Deliberately BOTH email and WhatsApp, rather than the channel the message
 * arrived on. A site engineer who sent a WhatsApp from a basement with no
 * signal may next be at a desk; the answer is wanted from whichever he reaches
 * first, and the token makes either one resolve to the same question.
 */
export async function askWhichProject(input: AskInput): Promise<{ token: string } | null> {
  if (input.candidateProjectIds.length < 2) return null;

  const projects = await prisma.project.findMany({
    where: { id: { in: input.candidateProjectIds } },
    select: { id: true, projectCode: true, projectName: true },
    orderBy: { projectCode: 'asc' },
  });
  if (projects.length < 2) return null;

  const token = newToken();

  // Ordered by project code and STORED in that order, so the number in the
  // message and the number in the answer mean the same thing.
  const ordered = projects.map((p) => p.id);

  const list = projects
    .map((p, i) => `  ${i + 1}. ${p.projectCode} — ${p.projectName}`)
    .join('\n');

  const files = input.evidenceCount ?? 0;
  const opening =
    files > 0
      ? `${files} ${files === 1 ? 'file' : 'files'}, no message.\n\n`
      : `"${excerptOf(input.originalText, 100)}"\n\n`;

  // Nothing but the project. It is the only question that has to be settled
  // before anything else can be, and stacking "has the work started?"
  // underneath it produced replies answering one, the other, or both in an
  // order nothing could read.
  const body = opening + `Which project?\n${list}`;

  const sent = await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: 'choose',
    candidateProjectIds: ordered,
    detailFields: input.fields ?? [],
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return sent ? { token } : null;
}

/**
 * Puts back what we read out of their own message, for a yes or a no.
 *
 * The proposal is quoted with the REASON it was made — "you wrote DXB-001",
 * "you named the client, Emaar Properties" — because a person can only check
 * an inference they can see. A bare "is this DXB-001?" invites a reflexive yes.
 */
export async function confirmProject(input: ConfirmInput): Promise<{ token: string } | null> {
  const others = input.otherProjectIds.filter((id) => id !== input.proposedProjectId);

  const projects = await prisma.project.findMany({
    where: { id: { in: [input.proposedProjectId, ...others] } },
    select: { id: true, projectCode: true, projectName: true, clientName: true },
  });

  const proposed = projects.find((p) => p.id === input.proposedProjectId);
  if (!proposed) return null;

  const token = newToken();

  // The proposal FIRST. `tryAnswerQuestion` reads a "yes" as element zero, and
  // nothing else may reorder this array.
  const ordered = [
    proposed.id,
    ...projects.filter((p) => p.id !== proposed.id).map((p) => p.id),
  ];

  const alternatives = projects
    .filter((p) => p.id !== proposed.id)
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));

  // The other jobs, on one line. Carried so "no, it is DXB-002" resolves in a
  // single reply — but as a footnote, not as a second list to read.
  const otherLine =
    alternatives.length > 0
      ? `\n\nOr: ${alternatives.map((p) => p.projectCode).join(', ')}`
      : '';

  // The inference is quoted — "you wrote DXB-002" — because a person can only
  // check a guess he can see, and a bare "is this DXB-002?" invites a
  // reflexive yes. Four words is enough to show the working.
  const body =
    `${capitalise(describeMatch(input.match))} — is this ` +
    `${proposed.projectCode}, ${proposed.projectName}?` +
    otherLine;

  const sent = await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: 'confirm',
    candidateProjectIds: ordered,
    detailFields: input.fields ?? [],
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return sent ? { token } : null;
}

/** First letter up, for a sentence that starts with a quoted inference. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "These photos: a new change, or one of these?"
 *
 * Asked when files arrive with no words of their own, once the project is
 * settled. Files with a caption never reach here — a caption is a statement of
 * what happened, and asking a man who has just told you what a photo is to
 * tell you again is how a system teaches people to stop replying to it.
 *
 * Each option carries a few words of what that change is about, because
 * `PC-DXB-001-0002` means nothing to the person who reported it three weeks
 * ago, and a list of references is a list nobody can answer.
 */
export async function askWhichChange(input: {
  integrationEventId: string;
  userId: string;
  projectId: string;
  channel: Extract<SourceType, 'whatsapp' | 'email'>;
  evidenceCount: number;
  originalText: string;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
  limit?: number;
  fields?: DetailField[];
}): Promise<{ token: string; offered: number } | null> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { projectCode: true, projectName: true },
  });
  if (!project) return null;

  // Live changes only, newest first. A change already found to be within the
  // contract, or withdrawn, does not want new evidence quietly appearing on it
  // months later — and offering it would invite somebody to reopen a decision
  // by attaching a photograph to it.
  const changes = await prisma.potentialChange.findMany({
    where: {
      projectId: input.projectId,
      currentStatus: { notIn: ['included_scope', 'cancelled'] },
    },
    select: { id: true, pcNumber: true, title: true, summary: true, description: true },
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 5,
  });

  const token = newToken();
  const files = input.evidenceCount;
  const noun = files === 1 ? 'file' : 'files';

  const list = changes
    .map((c, i) => `  ${i + 1}. ${c.pcNumber} — ${briefOf(c)}`)
    .join('\n');

  const body =
    changes.length > 0
      ? `${files} ${noun} on ${project.projectCode} — ${project.projectName}.\n\n` +
        `New change, or one of these?\n${list}`
      : `${files} ${noun} on ${project.projectCode} — ${project.projectName}.\n\n` +
        `What changed?`;

  const sent = await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: changes.length > 0 ? 'attach' : 'describe',
    candidateProjectIds: [input.projectId],
    candidateChangeIds: changes.map((c) => c.id),
    projectId: input.projectId,
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return sent ? { token, offered: changes.length } : null;
}

/** "Tell me in a line what changed." Asked after they say the files are new. */
export async function askForDescription(input: {
  integrationEventId: string;
  userId: string;
  projectId: string;
  evidenceCount: number;
  originalText: string;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
  fields?: DetailField[];
}): Promise<{ token: string } | null> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { projectCode: true, projectName: true },
  });
  if (!project) return null;

  const token = newToken();

  const body =
    `${project.projectCode} — ${project.projectName}.\n\nWhat changed?`;

  const sent = await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: 'describe',
    candidateProjectIds: [input.projectId],
    projectId: input.projectId,
    detailFields: input.fields ?? [],
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return sent ? { token } : null;
}

export type DetailField = 'event_date' | 'document_reference' | 'work_status';

/**
 * Which facts are worth one more message, and which are not.
 *
 * Ordered by what they are worth. The event date comes first because it is the
 * only one that moves a deadline: the notice period runs from the day the
 * thing happened, so a change reported a week late has twenty one days left
 * and not twenty eight, and a system that silently assumes today tells the
 * commercial manager he has a week he does not have.
 *
 * A drawing reference is asked for only when the report is already talking
 * about a drawing. Asking every reporter for a drawing number teaches them
 * that most of the questions do not apply to them, and then they stop reading
 * the ones that do.
 *
 * Two at most, in one message. This is a man on a ladder with one hand free.
 */
export function plannedDetailFields(input: {
  text: string;
  eventDateKnown: boolean;
  documentReferenceKnown: boolean;
  workStatusKnown: boolean;
}): DetailField[] {
  const fields: DetailField[] = [];
  // Work status leads. Whether the work has already been done is what decides
  // what this change IS — an instruction to price, or a cost already incurred
  // that has to be recovered — and it is the one answer nobody can reconstruct
  // later from a photograph.
  if (!input.workStatusKnown) fields.push('work_status');
  if (!input.eventDateKnown) fields.push('event_date');
  if (!input.documentReferenceKnown && mentionsDocument(input.text)) {
    fields.push('document_reference');
  }
  // The full list of what is still missing. The CALLER asks one of these at a
  // time — see `askForDetail`. Two questions in one message came back from
  // site on 2026-09-04 answered as "No / Yesterday", which is two answers to
  // two questions in one line and reads as one sentence to a parser. One
  // question, one answer, no ambiguity.
  return fields;
}

const DETAIL_PROMPTS: Record<DetailField, string> = {
  work_status: 'Has the work started on site?',
  event_date: 'When did this happen?',
  document_reference: 'Which drawing or RFI is it from?',
};


/**
 * The outstanding questions, asked on their own.
 *
 * Reached two ways, and the difference is `potentialChangeId`.
 *
 * BEFORE FILING (null) — the project is settled and something the record needs
 * is still missing. Nothing has been written; the answer completes the report
 * and the answer is what files it. Osman's rule, 2026-09-04: a change is not
 * opened on half a story.
 *
 * AFTER FILING (set) — the change exists and this only sharpens it. Reached
 * when the questions were asked twice and the reporter answered enough of them
 * to file, or when a detail is wanted on a change that was filed by hand.
 *
 * The tension is real and worth naming: not filing means the contractual clock
 * is not running on a change that has been reported. That is why `MAX_ASKS`
 * exists — after two asks the caller files with what it has, so an unanswered
 * question can delay a record but can never swallow one.
 */
export async function askForDetail(input: {
  integrationEventId: string;
  userId: string;
  projectId: string;
  potentialChangeId?: string | null;
  pcNumber?: string | null;
  fields: DetailField[];
  originalText: string;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
}): Promise<{ token: string } | null> {
  if (input.fields.length === 0) return null;

  const token = newToken();
  const filed = Boolean(input.potentialChangeId);

  // ONE question. The rest stay in `detailFields` and are asked in turn as
  // each is answered, because a man on a ladder answers the last thing he read
  // and the answers to two questions in one reply cannot be told apart.
  const asking = input.fields[0]!;
  const body = filed
    ? `${input.pcNumber} is on file.\n\n${DETAIL_PROMPTS[asking]}`
    : DETAIL_PROMPTS[asking];

  const sent = await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: 'detail',
    candidateProjectIds: [input.projectId],
    projectId: input.projectId,
    potentialChangeId: input.potentialChangeId ?? null,
    detailFields: input.fields,
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return sent ? { token } : null;
}

/**
 * The last message in the exchange.
 *
 * A conversation that ends without a reply does not feel finished, and a
 * reporter who is never told his change was filed has no way to know whether
 * the system heard him — so he tells his PM again, by hand, which is the
 * behaviour this product exists to replace.
 *
 * Sent on the same request, like the question itself. Best effort: failing to
 * say "filed" must never unfile anything.
 */
export async function acknowledgeCapture(input: {
  userId: string;
  token: string;
  text: string;
  potentialChangeId?: string | null;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
  /** Appends "anything else?", varied by token so it does not read like a bot. */
  invite?: boolean;
}): Promise<void> {
  const recipients = await loadRecipients([input.userId]);
  if (recipients.length === 0) return;

  const seed = `ack:${input.token}`;
  const body = input.invite === false ? input.text : `${input.text}\n\n${closingLine(input.token)}`;

  await prisma.$transaction(async (tx) => {
    await recordDirectNotifications(tx as Prisma.TransactionClient, {
      kind: 'capture_question',
      subject: replySubject(input.sourceSubject, input.token),
      body,
      recipients,
      dedupeSeed: seed,
      on: new Date(),
      replyToMessageId: input.sourceMessageId ?? null,
      potentialChangeId: input.potentialChangeId ?? null,
    });
  });

  await dispatchNow(seed);
}

/** True when EVERY word of the reply is in `vocabulary`. A partial is not an answer. */
function isWholly(text: string, vocabulary: Set<string>, maxWords = 4): boolean {
  // Digits are split out as their own words and are in neither vocabulary, so
  // "YES 2" is not a yes. Two different answers in one reply is not an answer.
  const words = text.split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0 || words.length > maxWords) return false;
  return words.every((word) => vocabulary.has(word));
}

/**
 * The list position somebody meant, or null.
 *
 * Accepts a number surrounded only by permitted filler. Returns null the moment
 * a word appears that is not filler, because at that point the reply is prose
 * and prose is a report.
 */
function bareNumber(text: string): number | null {
  const words = text.split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;

  let found: number | null = null;
  for (const word of words) {
    if (/^\d{1,2}$/.test(word)) {
      // Two numbers is not an answer, it is a sentence.
      if (found !== null) return null;
      found = Number(word);
      continue;
    }
    if (!NUMBER_PREFIXES.has(word)) return null;
  }
  return found;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** What a single open question makes of a reply, or null if it makes nothing. */
interface Interpretation {
  outcome: ReplyOutcome;
  projectId: string | null;
  potentialChangeId: string | null;
}

/**
 * Reads an incoming message as a possible answer.
 *
 * Returns null when it is not one, and the caller then treats it as a new
 * change — which is the safe default. Mistaking a genuine report for an answer
 * would silently discard the report.
 */
export async function tryAnswerQuestion(
  attempt: AnswerAttempt,
): Promise<QuestionReply | null> {
  const identifier = attempt.senderIdentifier.trim();
  if (!identifier) return null;

  // Ambiguous is treated as "not an answer". If several people share the
  // number we cannot know whose question this settles, and settling the wrong
  // one files a change against a project nobody chose.
  const identity = await resolveSender(attempt.channel, identifier);
  if (identity.kind !== 'one') return null;
  const user = { id: identity.userId, fullName: identity.fullName };

  const open = await prisma.captureQuestion.findMany({
    where: { userId: user.id, status: 'open', expiresAt: { gt: new Date() } },
    orderBy: { askedAt: 'desc' },
  });
  if (open.length === 0) return null;

  const text = attempt.text.trim();
  const upper = text.toUpperCase();
  const now = Date.now();

  // A token in the text names the question outright.
  //
  // Without one, the reply is offered to each open question NEWEST FIRST, and
  // the first one that can make sense of it takes it — which is how a
  // conversation works: you answer the last thing you were asked, and if that
  // makes no sense you must have meant the one before.
  //
  // What makes the loose rule acceptable is that a mistake is now VISIBLE
  // within seconds: every acknowledgement quotes what it acted on, so a reply
  // landing on the wrong question is something the reporter sees immediately
  // and can correct, instead of a silent wrong filing nobody looks at again.
  const byToken = open.find((q) => new RegExp(`\\b${q.token}\\b`).test(upper));
  const tryable = byToken
    ? [byToken]
    : open.filter((q) => now - q.askedAt.getTime() < CONVERSATION_WINDOW_MS[q.kind]);

  for (const question of tryable) {
    // An email reply quotes the message it answers, and the quoted text
    // contains every project code and reference we listed. Reading past the
    // first quote line would let our own question answer itself.
    const body = firstReplyBlock(upper).replace(question.token, ' ').trim();

    const reading = await interpret(question, body, text);
    if (!reading) continue;

    // Claim it atomically. Two replies racing — the email and the WhatsApp both
    // answered — must settle one question, not two.
    const settled =
      reading.outcome === 'rejected' || reading.outcome === 'cancelled'
        // A rejection CANCELS the question. The caller then re-asks, which
        // reopens this same row with a fresh token — so a second "no" arriving
        // from the other channel finds nothing open and does not re-ask twice.
        ? { status: 'cancelled' as const, answeredAt: new Date() }
        : {
            status: 'answered' as const,
            answeredAt: new Date(),
            chosenProjectId: reading.projectId,
          };

    const claimed = await prisma.captureQuestion.updateMany({
      where: { id: question.id, status: 'open' },
      data: settled,
    });
    if (claimed.count === 0) continue;

    return {
      outcome: reading.outcome,
      kind: question.kind,
      questionId: question.id,
      integrationEventId: question.integrationEventId,
      userId: user.id,
      userName: user.fullName,
      projectId: reading.projectId,
      potentialChangeId: reading.potentialChangeId,
      originalText: question.askedText ?? '',
      replyText: text,
      candidateProjectIds: question.candidateProjectIds,
      detailFields: question.detailFields,
      sourceMessageId: question.sourceMessageId,
      sourceSubject: question.sourceSubject,
    };
  }

  return null;
}

async function interpret(
  question: CaptureQuestion,
  body: string,
  rawText: string,
): Promise<Interpretation | null> {
  const none: Pick<Interpretation, 'projectId' | 'potentialChangeId'> = {
    projectId: question.projectId,
    potentialChangeId: question.potentialChangeId,
  };

  if (question.kind === 'summary') {
    // The read-back. A yes files it; anything else is a correction, and a
    // correction is the whole point of having asked.
    if (isWholly(body, CANCEL)) return { outcome: 'cancelled', ...none };
    if (isWholly(body, AFFIRMATIVE, 5)) return { outcome: 'answered', ...none };
    // Not a yes. He is telling us what we got wrong, and that text becomes the
    // report — the alternative is filing something he has just said is wrong.
    if (wordCount(rawText) > 0) return { outcome: 'described', ...none };
    return null;
  }

  if (question.kind === 'detail') {
    // A follow-up competes with real reports, so it is the strictest of the
    // five. Anything long, or anything that yields no fact at all, is a new
    // report — and treating a new report as a follow-up answer would swallow
    // it whole.
    if (isWholly(body, SKIP, 6) || isPleasantry(rawText)) {
      return { outcome: 'declined', ...none };
    }
    if (wordCount(rawText) > DETAIL_ANSWER_MAX_WORDS) return null;

    // Read in the light of the question that was asked. "No" answers "has the
    // work started?" and answers nothing else — without this, a bare yes or no
    // yielded no fact at all, the reply was taken for a new report, and the
    // exchange started again from "which project?". It did exactly that four
    // times in a row on 2026-09-04.
    const asked = question.detailFields[0];
    const answered =
      asked === 'work_status' || asked === 'event_date' || asked === 'document_reference'
        ? parseAnswerForField(asked, rawText) !== null
        : false;

    const yieldsFact =
      answered ||
      parseEventDate(rawText, new Date()) !== null ||
      parseDocumentReference(rawText) !== null ||
      parseWorkStatus(rawText) !== null;
    if (!yieldsFact) return null;

    return { outcome: 'detailed', ...none };
  }

  if (question.kind === 'describe') {
    if (isWholly(body, CANCEL)) return { outcome: 'cancelled', ...none };
    if (wordCount(rawText) === 0) return null;
    return { outcome: 'described', ...none };
  }

  if (question.kind === 'attach') {
    if (isWholly(body, CANCEL)) return { outcome: 'cancelled', ...none };

    const changes = await prisma.potentialChange.findMany({
      where: { id: { in: question.candidateChangeIds } },
      select: { id: true, pcNumber: true, title: true, summary: true },
    });
    // Restored to the order they were offered in, so "2" means the second line
    // of the message they are looking at.
    type Offered = { id: string; pcNumber: string; title: string; summary: string | null };
    const ordered = question.candidateChangeIds
      .map((id) => changes.find((c) => c.id === id))
      .filter((c): c is Offered => Boolean(c));

    const named = matchChangeInText(body, ordered);
    if (named) {
      return { outcome: 'attach_existing', projectId: question.projectId, potentialChangeId: named.id };
    }

    const index = bareNumber(body);
    if (index !== null) {
      const picked = ordered[index - 1];
      if (picked) {
        return {
          outcome: 'attach_existing',
          projectId: question.projectId,
          potentialChangeId: picked.id,
        };
      }
    }

    if (isNewChangeRequest(body)) return { outcome: 'attach_new', ...none };

    // "the ceiling one", "reception marble" — how anybody actually answers a
    // list on a phone. A reference is what the database calls it; this is what
    // the reporter calls it. Only answers when a distinctive word lands on
    // exactly one option, so a reply that narrows nothing narrows nothing.
    const described = matchChangeByWords(body, ordered);
    if (described) {
      return {
        outcome: 'attach_existing',
        projectId: question.projectId,
        potentialChangeId: described.id,
      };
    }

    // Prose while files are waiting is the description of what they are of.
    // That is what a person would do — send the photos, then say what they
    // show — and reading it as a separate report would file a change with no
    // evidence and leave the evidence attached to nothing.
    if (wordCount(rawText) >= DESCRIPTION_MIN_WORDS) return { outcome: 'described', ...none };

    return null;
  }

  // choose / confirm — the project questions.
  const projects = await prisma.project.findMany({
    where: { id: { in: question.candidateProjectIds } },
    select: { id: true, projectCode: true },
  });

  // A project code is unambiguous and beats everything else, in case someone
  // writes both. It also survives the list being read out of order.
  //
  // Matched with the SAME tolerance used to read a code out of a report:
  // `DXB-004`, `dxb004`, `dxb 004` and `DXB - 004` are one answer. Requiring
  // the exact punctuation of the list would park a conversation the reporter
  // had already settled, which is the most irritating possible way to fail.
  const byCode = projects.find((p) => codePattern(p.projectCode).test(body));
  if (byCode) {
    return { outcome: 'answered', projectId: byCode.id, potentialChangeId: null };
  }

  // "cancel", "ignore", "forget it" — the reporter closing their own loop.
  // Checked after a code, because someone who names a project has plainly not
  // withdrawn it.
  if (isWholly(body, CANCEL)) return { outcome: 'cancelled', projectId: null, potentialChangeId: null };

  if (question.kind === 'confirm') {
    // Element zero is the proposal — see the header note.
    if (isWholly(body, AFFIRMATIVE)) {
      const chosen = question.candidateProjectIds[0] ?? null;
      return chosen ? { outcome: 'answered', projectId: chosen, potentialChangeId: null } : null;
    }
    if (isWholly(body, NEGATIVE)) {
      return { outcome: 'rejected', projectId: null, potentialChangeId: null };
    }
    // A bare number is NOT read here. No numbered list was ever sent for a
    // confirmation, so a "2" in the reply means something we cannot see.
    return null;
  }

  // A number, with or without the small words people put in front of it.
  // "2", "no 2", "project 2", "#2", "its 2" are one answer.
  //
  // Still deliberately strict about everything else: "moving 2 sockets on
  // level 2" is a REPORT, and reading it as an answer files it against a
  // project nobody chose and throws the report away. That is the one failure
  // here worth being pedantic about, so every other word in the reply has to
  // be a permitted filler.
  const index = bareNumber(body);
  if (index !== null) {
    const chosen = question.candidateProjectIds[index - 1] ?? null;
    if (chosen) return { outcome: 'answered', projectId: chosen, potentialChangeId: null };
  }

  return null;
}

/**
 * The part of an email reply the person actually typed.
 *
 * Everything from the quote marker down is OUR OWN question coming back, and it
 * contains every project code we listed. Without this, "YES" quoting a message
 * that mentions DXB-002 resolves to DXB-002 — the system answering itself with
 * the wrong project, which is the exact failure the confirmation exists to
 * prevent.
 */
function firstReplyBlock(upperText: string): string {
  const markers = [
    /^\s*ON .* WROTE:\s*$/m,
    /^\s*-{2,}\s*ORIGINAL MESSAGE\s*-{2,}\s*$/m,
    /^\s*FROM:\s.*$/m,
    /^\s*>/m,
    /^\s*YOU REPORTED:\s*$/m,
  ];

  let cut = upperText.length;
  for (const marker of markers) {
    const found = upperText.match(marker);
    if (found?.index !== undefined && found.index < cut) cut = found.index;
  }
  return upperText.slice(0, cut).trim();
}

/**
 * Whether this person was mid-conversation a moment ago.
 *
 * Decides how "thanks" is answered: warmly, as the end of an exchange, or with
 * a nudge about what the number is for. Both are better than filing a
 * Potential Change titled "thanks", which is what used to happen.
 */
export async function hadRecentExchange(
  userId: string,
  withinMs = CONVERSATION_WINDOW_MS.choose,
): Promise<boolean> {
  const last = await prisma.captureQuestion.findFirst({
    where: { userId, answeredAt: { not: null } },
    orderBy: { answeredAt: 'desc' },
    select: { answeredAt: true },
  });
  if (!last?.answeredAt) return false;
  return Date.now() - last.answeredAt.getTime() < withinMs;
}

/** Closes questions nobody answered, so a stale "2" cannot file anything. */
export async function expireStaleQuestions(now: Date = new Date()): Promise<{ expired: number }> {
  const result = await prisma.captureQuestion.updateMany({
    where: { status: 'open', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });
  return { expired: result.count };
}

/* ─────────────────────────── the read-back ───────────────────────────────── */

export interface CaptureSummary {
  projectLabel: string;
  description: string;
  eventDate: string | null;
  workStatus: string | null;
  documentReference: string | null;
  evidenceCount: number;
}

/**
 * Everything understood, put back to the reporter before anything is written.
 *
 * ── Why this is worth an extra message ────────────────────────────────────
 * Osman's call, 2026-09-04. The exchange used to file whatever it had made of
 * the conversation and TELL him afterwards. When the parse was wrong he found
 * out from an acknowledgement that already said his change was on file, and
 * the only way to fix it was to open the app — which is the thing he was
 * avoiding by using WhatsApp in the first place.
 *
 * Reading it back first turns every misunderstanding into one word instead of
 * a support conversation. It costs one message and it is the last cheap moment
 * to be wrong: after this a PC number exists, a notice clock is running, and
 * two people have been told.
 *
 * ── Why it is a plain list and not a sentence ─────────────────────────────
 * He is checking four facts, not reading prose. A list is scanned in two
 * seconds; a paragraph restating the same four facts is skimmed and confirmed
 * without being read, which would make the whole step theatre.
 */
export async function askToConfirmCapture(input: {
  integrationEventId: string;
  userId: string;
  projectId: string;
  summary: CaptureSummary;
  originalText: string;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
}): Promise<{ token: string } | null> {
  const token = newToken();
  const s = input.summary;

  const rows = [
    `Project: ${s.projectLabel}`,
    `Change: ${s.description}`,
    s.eventDate ? `Happened: ${s.eventDate}` : null,
    s.workStatus ? `Work: ${s.workStatus}` : null,
    s.documentReference ? `Reference: ${s.documentReference}` : null,
    s.evidenceCount > 0
      ? `Evidence: ${s.evidenceCount} ${s.evidenceCount === 1 ? 'file' : 'files'}`
      : null,
  ].filter((row): row is string => row !== null);

  const body =
    `Here is what I have:\n\n${rows.join('\n')}\n\n` +
    `Reply OK to file it. Or tell me what to change.`;

  const sent = await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: 'summary',
    candidateProjectIds: [input.projectId],
    projectId: input.projectId,
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return sent ? { token } : null;
}
