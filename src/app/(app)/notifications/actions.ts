'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
  revalidatePath('/dashboard');
}

/**
 * Opening a notification is what reads it.
 *
 * One click, not two. Making somebody click "open" and then "mark as read" is
 * asking him to do the system's bookkeeping — so the link marks it read on the
 * way past and the item leaves the list, which is the only way the list can
 * mean "these still need you".
 *
 * `redirect` throws by design in Next, so it is outside the try: catching it
 * would swallow the navigation and leave the user on a page that did nothing.
 */
export async function openNotificationAction(formData: FormData): Promise<void> {
  const user = await requirePageUser();
  const id = formData.get('id');
  const href = formData.get('href');
  if (typeof id !== 'string' || id === '') return;

  await markRead(user, id);
  revalidatePath('/notifications');
  revalidatePath('/dashboard');

  // Only ever an in-app path. An href arriving from the form is user input,
  // and following an absolute one would turn the notification list into an
  // open redirect.
  const target =
    typeof href === 'string' && /^\/[^/\\]/.test(href) ? href : '/notifications';
  redirect(target);
}
