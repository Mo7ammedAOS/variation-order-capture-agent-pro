import 'server-only';
import type { CaptureQuestionKind, Prisma, SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { loadRecipients, recordDirectNotifications } from '@/services/notification.service';
import { describeMatch, type ProjectMatch } from '@/lib/project-match';

/**
 * "Which project did you mean?" — and, when we think we already know,
 * "this is DXB-001, correct?"
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
 * So we ask, on both channels we can reach him on, and the message stays parked
 * until he answers. Triage remains for the cases asking cannot solve: an
 * unknown sender, or someone on no active project at all.
 *
 * ── Two shapes of question ─────────────────────────────────────────────────
 * CHOOSE  — nothing in the message named a project. Here is your list, pick.
 * CONFIRM — the message named a project code or the client, and exactly one of
 *           your jobs fits. One word back and it is filed.
 *
 * A confirmation is not a formality. Reading "Emaar" out of a message and
 * filing on the strength of it is still a guess; the difference is that this
 * guess is shown to the one person who can tell it is wrong, before anything
 * is written. That is what makes it safe to be clever about matching.
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
const EXPIRES_AFTER_DAYS = 7;

/** Whole-reply agreement. Every word has to be one of these, or it is not a yes. */
const AFFIRMATIVE = new Set([
  'YES', 'Y', 'YEP', 'YEAH', 'YUP', 'CORRECT', 'CONFIRM', 'CONFIRMED', 'RIGHT',
  'THATS', 'THAT', 'IS', 'OK', 'OKAY', 'SURE', 'TRUE', 'PLEASE', 'GO', 'AHEAD',
]);

const NEGATIVE = new Set([
  'NO', 'NOPE', 'NOT', 'WRONG', 'INCORRECT', 'NEGATIVE', 'THATS', 'THAT', 'IS', 'IT',
]);

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

/**
 * What an incoming message turned out to be.
 *
 * One shape rather than a discriminated union, because callers read the same
 * fields either way and the only difference is whether a project was settled.
 */
export interface QuestionReply {
  outcome: 'answered' | 'rejected';
  questionId: string;
  integrationEventId: string;
  userId: string;
  userName: string;
  /** Null when they told us we had the wrong project. */
  projectId: string | null;
  originalText: string;
  /** Their live jobs as frozen when we asked, for the re-ask after a "no". */
  candidateProjectIds: string[];
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

function excerptOf(text: string): string {
  return text.length > 160 ? `${text.slice(0, 160).trimEnd()}…` : text;
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
async function putQuestion(input: {
  integrationEventId: string;
  userId: string;
  kind: CaptureQuestionKind;
  candidateProjectIds: string[];
  askedText: string;
  sourceMessageId: string | null;
  sourceSubject: string | null;
  subject: string;
  body: string;
  token: string;
}): Promise<void> {
  const recipients = await loadRecipients([input.userId]);
  if (recipients.length === 0) return;

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + EXPIRES_AFTER_DAYS);

  await prisma.$transaction(async (tx) => {
    const data = {
      userId: input.userId,
      kind: input.kind,
      token: input.token,
      candidateProjectIds: input.candidateProjectIds,
      askedText: input.askedText,
      sourceMessageId: input.sourceMessageId,
      sourceSubject: input.sourceSubject,
      status: 'open' as const,
      chosenProjectId: null,
      answeredAt: null,
      askedAt: new Date(),
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
    });
  });
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
    .map((p, i) => `${i + 1}. ${p.projectCode} — ${p.projectName}`)
    .join('\n');

  const body =
    `You reported:\n"${excerptOf(input.originalText)}"\n\n` +
    `You are on ${projects.length} live projects, so we could not tell which one this is.\n\n` +
    `${list}\n\n` +
    `Reply with the number — for example: ${token} 1\n` +
    `Or reply with the project code, e.g. ${token} ${projects[0]?.projectCode}.\n\n` +
    `Nothing is recorded against any project until you answer.`;

  await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: 'choose',
    candidateProjectIds: ordered,
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return { token };
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

  const otherLine =
    alternatives.length > 0
      ? `\nIf not, reply with the right code instead:\n` +
        alternatives.map((p) => `  ${token} ${p.projectCode} — ${p.projectName}`).join('\n') +
        '\n'
      : '';

  const body =
    `You reported:\n"${excerptOf(input.originalText)}"\n\n` +
    `This looks like ${proposed.projectCode} — ${proposed.projectName} ` +
    `(${proposed.clientName}), because ${describeMatch(input.match)}.\n\n` +
    `Reply YES to file it there — for example: ${token} YES\n` +
    otherLine +
    `\nNothing is recorded against any project until you answer.`;

  await putQuestion({
    integrationEventId: input.integrationEventId,
    userId: input.userId,
    kind: 'confirm',
    candidateProjectIds: ordered,
    askedText: input.originalText,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceSubject: input.sourceSubject ?? null,
    subject: replySubject(input.sourceSubject, token),
    body,
    token,
  });

  return { token };
}

/** True when EVERY word of the reply is in `vocabulary`. A partial is not an answer. */
function isWholly(text: string, vocabulary: Set<string>): boolean {
  // Digits are split out as their own words and are in neither vocabulary, so
  // "YES 2" is not a yes. Two different answers in one reply is not an answer.
  const words = text.split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((word) => vocabulary.has(word));
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

  const user = await prisma.user.findFirst({
    where:
      attempt.channel === 'whatsapp'
        ? { phone: identifier, active: true }
        : { email: identifier.toLowerCase(), active: true },
    select: { id: true, fullName: true },
  });
  if (!user) return null;

  const open = await prisma.captureQuestion.findMany({
    where: { userId: user.id, status: 'open', expiresAt: { gt: new Date() } },
    orderBy: { askedAt: 'desc' },
  });
  if (open.length === 0) return null;

  const text = attempt.text.trim();
  const upper = text.toUpperCase();

  // A token in the text names the question outright. Without one, an answer is
  // only safe to apply when exactly one question is outstanding.
  const byToken = open.find((q) => new RegExp(`\\b${q.token}\\b`).test(upper));
  const question = byToken ?? (open.length === 1 ? open[0] : null);
  if (!question) return null;

  const projects = await prisma.project.findMany({
    where: { id: { in: question.candidateProjectIds } },
    select: { id: true, projectCode: true },
  });

  // An email reply quotes the message it answers, and the quoted text contains
  // every project code we listed. Reading past the first quote line would let
  // our own question answer itself.
  const withoutToken = firstReplyBlock(upper).replace(question.token, ' ').trim();

  // A project code is unambiguous and beats everything else, in case someone
  // writes both. It also survives the list being read out of order.
  const byCode = projects.find((p) => new RegExp(`\\b${p.projectCode}\\b`).test(withoutToken));

  let chosenProjectId: string | null = byCode?.id ?? null;
  let rejected = false;

  if (!chosenProjectId && question.kind === 'confirm') {
    // Element zero is the proposal — see the header note.
    if (isWholly(withoutToken, AFFIRMATIVE)) {
      chosenProjectId = question.candidateProjectIds[0] ?? null;
    } else if (isWholly(withoutToken, NEGATIVE)) {
      rejected = true;
    }
    // A bare number is NOT read here. No numbered list was ever sent for a
    // confirmation, so a "2" in the reply means something we cannot see.
  }

  if (!chosenProjectId && !rejected && question.kind === 'choose') {
    // Only a bare, short numeric answer counts. "2" is an answer; "moving 2
    // sockets on level 2" is a new report, and reading it as an answer would
    // throw the report away.
    const bare = withoutToken.match(/^#?(\d{1,2})$/);
    if (bare) {
      const index = Number(bare[1]) - 1;
      chosenProjectId = question.candidateProjectIds[index] ?? null;
    }
  }

  if (!chosenProjectId && !rejected) return null;

  // Claim it atomically. Two replies racing — the email and the WhatsApp both
  // answered — must file one change, not two.
  const claimed = await prisma.captureQuestion.updateMany({
    where: { id: question.id, status: 'open' },
    // A rejection CANCELS the question. The caller then re-asks, which reopens
    // this same row with a fresh token — so a second "no" arriving from the
    // other channel finds nothing open and does not re-ask twice.
    data: rejected
      ? { status: 'cancelled', answeredAt: new Date() }
      : { status: 'answered', answeredAt: new Date(), chosenProjectId },
  });
  if (claimed.count === 0) return null;

  return {
    outcome: rejected ? 'rejected' : 'answered',
    questionId: question.id,
    integrationEventId: question.integrationEventId,
    userId: user.id,
    userName: user.fullName,
    projectId: chosenProjectId,
    originalText: question.askedText ?? '',
    candidateProjectIds: question.candidateProjectIds,
    sourceMessageId: question.sourceMessageId,
    sourceSubject: question.sourceSubject,
  };
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

/** Closes questions nobody answered, so a stale "2" cannot file anything. */
export async function expireStaleQuestions(now: Date = new Date()): Promise<{ expired: number }> {
  const result = await prisma.captureQuestion.updateMany({
    where: { status: 'open', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });
  return { expired: result.count };
}
