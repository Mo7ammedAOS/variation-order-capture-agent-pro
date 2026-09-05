import type { Metadata } from 'next';
import { SignInScreen } from '../sign-in-screen';

export const metadata: Metadata = { title: 'Administrator sign in' };
export const dynamic = 'force-dynamic';

/**
 * The same door with the set-up button beside it, shown only while the company
 * has no users at all. It grants nothing `/signin` does not.
 */
export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return <SignInScreen variant="admin" next={next} reason={reason} />;
}
