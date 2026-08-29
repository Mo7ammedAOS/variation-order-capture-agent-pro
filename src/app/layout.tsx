import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
