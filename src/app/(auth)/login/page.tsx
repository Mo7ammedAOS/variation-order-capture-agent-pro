import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * `/login` became `/signin` on 2026-09-05. This stays because the old address
 * is already in the wild — in sent invitation emails, in browser bookmarks, in
 * TEST-PLAN.md, and in whatever anybody wrote down. A dead front door is a
 * support call, and the cost of keeping it alive is this file.
 */
export default async function LoginRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const suffix = query.toString();
  redirect(suffix ? `/signin?${suffix}` : '/signin');
}
