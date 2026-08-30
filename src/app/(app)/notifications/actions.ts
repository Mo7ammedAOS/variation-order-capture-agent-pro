'use server';

import { revalidatePath } from 'next/cache';
import { requirePageUser } from '@/lib/auth/session';
import { markAllRead, markRead } from '@/services/notification.service';

export async function markAllReadAction(): Promise<void> {
  const user = await requirePageUser();
  await markAllRead(user);
  revalidatePath('/notifications');
  revalidatePath('/dashboard');
}

export async function markReadAction(formData: FormData): Promise<void> {
  const user = await requirePageUser();
  const id = formData.get('id');
  if (typeof id !== 'string' || id === '') return;

  // The service scopes the update by user id, so a forged id changes nothing
  // that does not belong to the caller.
  await markRead(user, id);
  revalidatePath('/notifications');
}
