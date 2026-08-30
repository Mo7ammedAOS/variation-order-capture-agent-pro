'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import { resetPermissionsToDefaults, setPermission } from '@/services/permissions.service';

export interface PermissionState {
  error?: string;
  ok?: string;
}

export async function togglePermissionAction(
  _prev: PermissionState,
  formData: FormData,
): Promise<PermissionState> {
  const actor = await requireUser();

  const scope = String(formData.get('scope') ?? '');
  const role = String(formData.get('role') ?? '');
  const capability = String(formData.get('capability') ?? '');
  // The checkbox's own value is what it WAS, so the action is unambiguous even
  // if two admins have the page open at once.
  const granted = formData.get('granted') !== 'true';

  try {
    await setPermission(actor, {
      scope: scope as 'system' | 'project',
      role,
      capability: capability as Parameters<typeof setPermission>[1]['capability'],
      granted,
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath('/settings/permissions');
  return { ok: `${role} · ${capability} ${granted ? 'granted' : 'revoked'}` };
}

export async function resetPermissionsAction(
  _prev: PermissionState,
  _formData: FormData,
): Promise<PermissionState> {
  const actor = await requireUser();

  try {
    const { restored } = await resetPermissionsToDefaults(actor);
    revalidatePath('/settings/permissions');
    return { ok: `Restored the shipped defaults — ${restored} grants` };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
