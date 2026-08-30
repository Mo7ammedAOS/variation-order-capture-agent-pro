'use client';

import { ErrorState } from '@/components/error-state';
import './globals.css';

/**
 * The last boundary: a failure in the ROOT layout, where no other boundary is
 * mounted and React has no tree to fall back into. It has to supply its own
 * <html> and <body>, and it cannot rely on anything the root layout sets up —
 * which is why the stylesheet is imported here directly.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ErrorState error={error} reset={reset} />
      </body>
    </html>
  );
}
