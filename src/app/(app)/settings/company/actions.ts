'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import { companySettingsSchema, updateCompanySettings } from '@/services/company.service';

export interface CompanyFormState {
  error?: string;
  ok?: string;
}

export async function saveCompanySettingsAction(
  _prev: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const user = await requireUser();

  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  const parsed = companySettingsSchema.safeParse({
    legalCompanyName: formData.get('legalCompanyName'),
    displayCompanyName: formData.get('displayCompanyName'),
    defaultCurrency: text('defaultCurrency') ?? 'AED',
    timezone: text('timezone') ?? 'Asia/Dubai',
    workweekStartDay: formData.get('workweekStartDay'),
    workweekEndDay: formData.get('workweekEndDay'),
    riskAmberThresholdDays: formData.get('riskAmberThresholdDays'),
    defaultEmailSenderName: text('defaultEmailSenderName'),
    defaultEmailSenderAddress: text('defaultEmailSenderAddress'),
    whatsappBusinessNumber: text('whatsappBusinessNumber'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details' };
  }

  try {
    await updateCompanySettings(user, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  // The company name is in the sidebar and on the login page, so both need it.
  revalidatePath('/', 'layout');
  return { ok: 'Saved' };
}
