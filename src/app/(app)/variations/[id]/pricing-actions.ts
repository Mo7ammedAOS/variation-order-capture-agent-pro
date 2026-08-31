'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import {
  addLineItem,
  lineItemSchema,
  notAVariationSchema,
  pricingRatesSchema,
  recordNotAVariation,
  removeLineItem,
  setPricingRates,
  submitPricing,
} from '@/services/pricing.service';

export interface PricingState {
  error?: string;
  ok?: string;
}

function refresh(id: string) {
  revalidatePath(`/variations/${id}`);
  revalidatePath('/my-tasks');
  revalidatePath('/variations');
}

export async function addLineItemAction(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');

  const parsed = lineItemSchema.safeParse({
    description: formData.get('description'),
    quantity: formData.get('quantity'),
    unit: formData.get('unit') || 'no',
    rate: formData.get('rate'),
    rateSource: formData.get('rateSource'),
    category: formData.get('category') || 'other',
    boqReference: formData.get('boqReference') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the line and try again' };
  }

  try {
    await addLineItem(user, id, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
  refresh(id);
  return { ok: 'Line added.' };
}

export async function removeLineItemAction(formData: FormData): Promise<void> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');
  const lineItemId = String(formData.get('lineItemId') ?? '');
  await removeLineItem(user, id, lineItemId);
  refresh(id);
}

export async function setRatesAction(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');

  const parsed = pricingRatesSchema.safeParse({
    prelimsPercent: formData.get('prelimsPercent') || undefined,
    overheadProfitPercent: formData.get('overheadProfitPercent') || undefined,
    pricingNotes: formData.get('pricingNotes') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the percentages' };
  }

  try {
    await setPricingRates(user, id, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
  refresh(id);
  return { ok: 'Saved.' };
}

/**
 * Submitting hands the figure to two directors and freezes it. There is no
 * confirmation dialog: the button says what it does, and the price stays
 * visible beside it while they press.
 */
export async function submitPricingAction(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');

  try {
    const totals = await submitPricing(user, id);
    refresh(id);
    return {
      ok: `Submitted at ${totals.total}. It is now with the project manager and the managing director, and the figure is fixed.`,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

export async function notAVariationAction(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  const user = await requirePageUser();
  const id = String(formData.get('potentialChangeId') ?? '');

  const parsed = notAVariationSchema.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Say what covers it' };
  }

  try {
    await recordNotAVariation(user, id, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
  refresh(id);
  return { ok: 'Recorded as already covered by the contract. The change is closed, and the record stays.' };
}
