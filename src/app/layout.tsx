import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { startScheduler } from '@/lib/scheduler';

/**
 * Started here, at module scope, rather than from `instrumentation.ts`.
 *
 * Next compiles instrumentation for the edge runtime as well, because this app
 * has middleware — and the reminder sweep reaches Prisma and `node:crypto`,
 * neither of which exists there. The build failed outright rather than
 * degrading, which is the better of the two outcomes but still a build.
 *
 * The root layout is server-only and Node-only, and this module is evaluated
 * once per server process. The container's own healthcheck requests /login
 * every thirty seconds, so the timer is running within half a minute of a
 * deploy without anyone visiting the site.
 *
 * `startScheduler` is a no-op unless ENABLE_SCHEDULER=true, so a build, a test
 * run and a second replica all decline to start one.
 */
startScheduler();

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
  // Numbers sit in tables of money and dates, where a wandering column edge
  // reads as a mistake in the figures.
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  title: {
    default: 'VO Capture & Control',
    template: '%s · VO Capture & Control',
  },
  description:
    'Variation notice capture, approval and bottleneck control for fit-out contracting.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1e40af',
};

/*
  `dir` is set from the locale so the whole tree flips for Arabic. Everything
  below uses logical properties (ms-/me-/ps-/pe-, start/end) rather than
  left/right, so RTL is a structural property of the app and not a retrofit.
*/
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = 'en';
  const dir = locale === 'en' ? 'ltr' : 'rtl';

  return (
    <html lang={locale} dir={dir} className={jakarta.variable} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
