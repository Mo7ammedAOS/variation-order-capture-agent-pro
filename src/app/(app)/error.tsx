'use client';

import { ErrorState } from '@/components/error-state';

/** Covers every application page. The shell around it stays usable. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
