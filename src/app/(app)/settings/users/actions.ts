'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import {
  inviteSchema,
  inviteUser,
  passwordResetSchema,
  resetUserPassword,
  sendPasswordResetLink,
  setCompanyAdmin,
  setUserActive,
} from '@/services/user.service';
import { isAppError } from '@/lib/errors';

export interface InviteState {
  error?: string;
  ok?: string;
}

export async function inviteUserAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requirePageUser();

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
  const actor = await requirePageUser();
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
  const actor = await requirePageUser();
  const userId = String(formData.get('userId') ?? '');
  const canAdminister = formData.get('canAdminister') === 'true';

  await setCompanyAdmin(actor, userId, canAdminister);
  revalidatePath('/settings/users');
}

export interface PasswordState {
  error?: string;
  ok?: string;
}

/**
 * Setting a password on somebody's behalf.
 *
 * The password arrives in the POST body and leaves in nothing: it is not put
 * in the returned message, not revalidated into a URL, not written to the
 * audit trail. The confirmation names the person, never the secret — an admin
 * who needs to read it back has it on screen in the field he just typed.
 */
export async function resetPasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const actor = await requirePageUser();

  const parsed = passwordResetSchema.safeParse({
    userId: formData.get('userId'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the password' };
  }

  try {
    const target = await resetUserPassword(actor, parsed.data);
    revalidatePath('/settings/users');
    return {
      ok: `Password set for ${target.fullName}. Give it to them in person and ask them to change it.`,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

/** The better option whenever the person is reachable: they set their own. */
export async function sendResetLinkAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const actor = await requirePageUser();
  const userId = formData.get('userId');
  if (typeof userId !== 'string' || userId === '') return { error: 'No user' };

  try {
    const target = await sendPasswordResetLink(actor, userId);
    return { ok: `Reset link sent to ${target.email}.` };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
