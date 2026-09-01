'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import {
  clientResponseSchema,
  raiseVariationOrder,
  recordClientResponse,
  recordSubmission,
  voSubmissionSchema,
} from '@/services/variation-order.service';
import {
  applicationSchema,
  draftApplication,
  draftRetentionRelease,
  issueInvoice,
  issueInvoiceSchema,
  retentionReleaseSchema,
} from '@/services/invoice.service';
import {
  cancelCreditNote,
  cancelCreditNoteSchema,
  creditNoteSchema,
  draftCreditNote,
  issueCreditNote,
  issueCreditNoteSchema,
} from '@/services/credit-note.service';
import { paymentSchema, recordPayment } from '@/services/payment.service';

/**
 * The money end, as server actions.
 *
 * Kept in their own file rather than added to `actions.ts`, which is already
 * the longest file on this page. Nothing subtle: a file that does eight things
 * gets read by nobody.
 *
 * Every one of these revalidates the change page and the dashboard, because
 * every one of them moves a figure a director is looking at.
 */

export interface MoneyState {
  error?: string;
  ok?: string;
}

function refresh(potentialChangeId: FormDataEntryValue | null) {
  revalidatePath(`/variations/${potentialChangeId}`);
  revalidatePath('/dashboard');
  revalidatePath('/variations');
}

export async function raiseVoAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();
  const potentialChangeId = String(formData.get('potentialChangeId') ?? '');

  try {
    const vo = await raiseVariationOrder(user, potentialChangeId);
    refresh(potentialChangeId);
    return { ok: `${vo.voNumber} raised. Check the figure, then record the submission.` };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function recordSubmissionAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = voSubmissionSchema.safeParse({
    variationOrderId: formData.get('variationOrderId'),
    submittedOn: formData.get('submittedOn'),
    timeImpactDaysClaimed: formData.get('timeImpactDaysClaimed') || undefined,
    timeImpactBasis: formData.get('timeImpactBasis') || null,
    clientReference: formData.get('clientReference') || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give the date it went to the client' };
  }

  try {
    await recordSubmission(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return { ok: 'Recorded. The clock on the client response starts from that date.' };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function recordClientResponseAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = clientResponseSchema.safeParse({
    variationOrderId: formData.get('variationOrderId'),
    response: formData.get('response'),
    respondedOn: formData.get('respondedOn'),
    approvedValue: formData.get('approvedValue') || null,
    approvedTimeImpactDays: formData.get('approvedTimeImpactDays') || undefined,
    clientReference: formData.get('clientReference') || null,
    notes: formData.get('notes') || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Record what the client said' };
  }

  try {
    await recordClientResponse(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return {
      ok:
        parsed.data.response === 'rejected'
          ? 'Recorded. The rejection and the reason are on the file.'
          : 'Recorded. Somebody now has a task to apply for the money.',
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function draftApplicationAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = applicationSchema.safeParse({
    variationOrderId: formData.get('variationOrderId'),
    periodEnd: formData.get('periodEnd'),
    cumulativePercent: formData.get('cumulativePercent'),
    notes: formData.get('notes') || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give the period and the percentage' };
  }

  try {
    const invoice = await draftApplication(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return {
      ok: `${invoice.invoiceNumber} drafted for ${invoice.totalDue.toString()}. Check it, then issue it.`,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function issueInvoiceAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = issueInvoiceSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    issuedOn: formData.get('issuedOn'),
    clientReference: formData.get('clientReference') || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give the date it was issued' };
  }

  try {
    const invoice = await issueInvoice(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return { ok: `Issued. It falls due on ${invoice.dueAt?.toISOString().slice(0, 10)}.` };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function recordPaymentAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = paymentSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    amount: formData.get('amount'),
    receivedOn: formData.get('receivedOn'),
    reference: formData.get('reference') || null,
    method: formData.get('method') || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give the amount and the date' };
  }

  try {
    await recordPayment(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return { ok: 'Receipt recorded.' };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

/* ─── Putting a wrong figure right ───────────────────────────────────────── */

export async function draftCreditNoteAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = creditNoteSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    reason: formData.get('reason'),
    narrative: formData.get('narrative'),
    grossAmount: formData.get('grossAmount'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give the amount and say why' };
  }

  try {
    const note = await draftCreditNote(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return {
      ok:
        `${note.creditNoteNumber} drafted for ${note.totalCredited.toString()}. ` +
        'Nothing has moved yet — check it, then issue it.',
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function issueCreditNoteAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = issueCreditNoteSchema.safeParse({
    creditNoteId: formData.get('creditNoteId'),
    issuedOn: formData.get('issuedOn'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Give the date it was issued' };
  }

  try {
    const note = await issueCreditNote(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return {
      ok: `${note.creditNoteNumber} issued. It comes off what the client owes and off the retention held.`,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function cancelCreditNoteAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = cancelCreditNoteSchema.safeParse({
    creditNoteId: formData.get('creditNoteId'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Say why it is being cancelled' };
  }

  try {
    await cancelCreditNote(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return { ok: 'Cancelled. Nothing was credited.' };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

/* ─── Retention coming back ──────────────────────────────────────────────── */

export async function draftRetentionReleaseAction(
  _prev: MoneyState,
  formData: FormData,
): Promise<MoneyState> {
  const user = await requirePageUser();

  const parsed = retentionReleaseSchema.safeParse({
    variationOrderId: formData.get('variationOrderId'),
    stage: formData.get('stage'),
    periodEnd: formData.get('periodEnd'),
    amount: formData.get('amount') || null,
    notes: formData.get('notes') || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose the stage and the date' };
  }

  try {
    const invoice = await draftRetentionRelease(user, parsed.data);
    refresh(formData.get('potentialChangeId'));
    return {
      ok:
        `${invoice.invoiceNumber} drafted to release ${invoice.retentionReleased.toString()}. ` +
        'Issue it to ask the client for it.',
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
