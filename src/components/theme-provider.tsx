'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Light and dark, as two different photographs.
 *
 * ── Why `class` and not a data attribute ──────────────────────────────────
 * `globals.css` declares `@custom-variant dark (&:is(.dark *))`, so every
 * `dark:` utility Tailwind emits is scoped to a `.dark` ancestor. Switching
 * this to `data-theme` would silently kill every one of them — they would
 * compile, ship, and simply never match.
 *
 * ── Why `system` is the default ───────────────────────────────────────────
 * Nobody on a site opens Settings to pick a theme. A phone that is already in
 * dark mode at seven in the evening should hand them the dark plate without
 * being asked; a laptop in a bright office should not. The toggle exists for
 * the minority who disagree with their own operating system, and once they
 * touch it their choice is remembered and `system` stops applying.
 *
 * ── Why transitions are disabled during the swap ──────────────────────────
 * Without `disableTransitionOnChange`, every element carrying a colour
 * transition animates independently when the class flips, and the interface
 * spends 200ms as a smear of half-inverted panels. The backdrop image still
 * cross-fades — that transition lives on `body::before` and is deliberate.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
