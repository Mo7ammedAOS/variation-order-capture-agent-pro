import type { Metadata } from 'next';
import { SignInScreen } from '../sign-in-screen';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/** The door everybody in the company uses. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return <SignInScreen variant="staff" next={next} reason={reason} />;
}
