import 'server-only';
import type { Prisma, SourceType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { loadRecipients, recordDirectNotifications } from '@/services/notification.service';

/**
 * "Which project did you mean?"
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
 * ── Why the candidates are frozen ──────────────────────────────────────────
 * The list is stored when the question is asked. Reading his memberships again
 * at answer time would mean "2" quietly pointing at a different project if he
 * were added to a job in between — and he would have no way of knowing.
 */

/** Ambiguous characters are omitted: no O/0, no I/1. People retype these. */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 4;
const EXPIRES_AFTER_DAYS = 7;

export interface AskInput {
  integrationEventId: string;
  userId: string;
  userName: string;
  channel: Extract<SourceType, 'whatsapp' | 'email'>;
  originalText: string;
  candidateProjectIds: string[];
}

export interface AnswerAttempt {
  senderIdentifier: string;
  channel: Extract<SourceType, 'whatsapp' | 'email'>;
  text: string;
}

export interface AnsweredQuestion {
  questionId: string;
  integrationEventId: string;
  userId: string;
  userName: string;
  projectId: string;
  originalText: string;
}

function newToken(): string {
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return out;
}

/**
 * Puts the question to the reporter on every channel we hold for them.
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

  const recipients = await loadRecipients([input.userId]);
  if (recipients.length === 0) return null;

  const token = newToken();
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + EXPIRES_AFTER_DAYS);

  // Ordered by project code and STORED in that order, so the number in the
  // message and the number in the answer mean the same thing.
  const ordered = projects.map((p) => p.id);

  const list = projects
    .map((p, i) => `${i + 1}. ${p.projectCode} — ${p.projectName}`)
    .join('\n');

  const excerpt =
    input.originalText.length > 160
      ? `${input.originalText.slice(0, 160).trimEnd()}…`
      : input.originalText;

  const body =
    `You reported:\n"${excerpt}"\n\n` +
    `You are on ${projects.length} live projects, so we could not tell which one this is.\n\n` +
    `${list}\n\n` +
    `Reply with the number — for example: ${token} 1\n` +
    `Or reply with the project code, e.g. ${token} ${projects[0]?.projectCode}.\n\n` +
    `Nothing is recorded against any project until you answer.`;

  await prisma.$transaction(async (tx) => {
    await tx.captureQuestion.create({
      data: {
        integrationEventId: input.integrationEventId,
        userId: input.userId,
        token,
        candidateProjectIds: ordered,
        askedText: input.originalText,
        expiresAt,
      },
    });

    await recordDirectNotifications(tx as Prisma.TransactionClient, {
      kind: 'capture_question',
      subject: `Which project? [${token}]`,
      body,
      recipients,
      dedupeSeed: `question:${token}`,
      on: new Date(),
    });
  });

  return { token };
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
): Promise<AnsweredQuestion | null> {
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

  const withoutToken = upper.replace(question.token, ' ').trim();

  // A project code is unambiguous and beats a number, in case someone writes
  // both. It also survives the list being read out of order.
  const byCode = projects.find((p) => new RegExp(`\\b${p.projectCode}\\b`).test(withoutToken));

  let chosenProjectId: string | null = byCode?.id ?? null;

  if (!chosenProjectId) {
    // Only a bare, short numeric answer counts. "2" is an answer; "moving 2
    // sockets on level 2" is a new report, and reading it as an answer would
    // throw the report away.
    const bare = withoutToken.match(/^#?(\d{1,2})$/);
    if (bare) {
      const index = Number(bare[1]) - 1;
      chosenProjectId = question.candidateProjectIds[index] ?? null;
    }
  }

  if (!chosenProjectId) return null;

  // Claim it atomically. Two replies racing — the email and the WhatsApp both
  // answered — must file one change, not two.
  const claimed = await prisma.captureQuestion.updateMany({
    where: { id: question.id, status: 'open' },
    data: { status: 'answered', answeredAt: new Date(), chosenProjectId },
  });
  if (claimed.count === 0) return null;

  return {
    questionId: question.id,
    integrationEventId: question.integrationEventId,
    userId: user.id,
    userName: user.fullName,
    projectId: chosenProjectId,
    originalText: question.askedText ?? '',
  };
}

/** Closes questions nobody answered, so a stale "2" cannot file anything. */
export async function expireStaleQuestions(now: Date = new Date()): Promise<{ expired: number }> {
  const result = await prisma.captureQuestion.updateMany({
    where: { status: 'open', expiresAt: { lte: now } },
    data: { status: 'expired' },
  });
  return { expired: result.count };
}
