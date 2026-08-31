'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { dismissTriagedEvent, fileTriagedEvent } from '@/services/capture.service';
import { isAppError } from '@/lib/errors';

export interface TriageState {
  error?: string;
  ok?: string;
}

/** Puts a captured message on a project a person has chosen. */
export async function fileMessage(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  const user = await requirePageUser();
  const eventId = String(formData.get('eventId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');

  if (!projectId) return { error: 'Choose which project this belongs to' };

  try {
    const { pcNumber } = await fileTriagedEvent(user, { eventId, projectId });
    revalidatePath('/inbox');
    revalidatePath('/variations');
    revalidatePath('/dashboard');
    return { ok: `Filed as ${pcNumber}` };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}

/** Discards one. The row stays, carrying who decided and why. */
export async function dismissMessage(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  const user = await requirePageUser();

  try {
    await dismissTriagedEvent(user, {
      eventId: String(formData.get('eventId') ?? ''),
      reason: String(formData.get('reason') ?? ''),
    });
    revalidatePath('/inbox');
    return { ok: 'Dismissed' };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
