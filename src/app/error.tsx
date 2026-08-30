'use client';

import { ErrorState } from '@/components/error-state';

/**
 * Catches failures in any layout below the root — including `(app)/layout.tsx`,
 * which the `(app)` boundary cannot catch, because a segment's error boundary
 * never covers its own layout.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
