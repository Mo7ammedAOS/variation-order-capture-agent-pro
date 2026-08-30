'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { inviteSchema, inviteUser, setCompanyAdmin, setUserActive } from '@/services/user.service';
import { isAppError } from '@/lib/errors';

export interface InviteState {
  error?: string;
  ok?: string;
}

export async function inviteUserAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requireUser();

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    fullName: formData.get('fullName'),
    phone: formData.get('phone') || null,
    systemRole: formData.get('systemRole') || 'standard_user',
    preferredLanguage: formData.get('preferredLanguage') || 'en',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details' };
  }

  try {
    await inviteUser(actor, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath('/settings/users');
  return { ok: `Invitation sent to ${parsed.data.email}` };
}

export async function toggleUserActiveAction(formData: FormData) {
  const actor = await requireUser();
  const userId = String(formData.get('userId') ?? '');
  const active = formData.get('active') === 'true';

  await setUserActive(actor, userId, active);
  revalidatePath('/settings/users');
}

/**
 * Administration is a flag, not a role.
 *
 * The company chooses who runs the app and it is usually not a director — often
 * the Finance Manager. The service refuses to leave the company with none.
 */
export async function toggleCompanyAdminAction(formData: FormData) {
  const actor = await requireUser();
  const userId = String(formData.get('userId') ?? '');
  const canAdminister = formData.get('canAdminister') === 'true';

  await setCompanyAdmin(actor, userId, canAdminister);
  revalidatePath('/settings/users');
}
