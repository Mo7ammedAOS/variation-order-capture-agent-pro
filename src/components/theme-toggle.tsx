'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Three states, not two: light, dark, and "whatever this device is doing".
 *
 * A two-way toggle cannot express "follow the system", so the moment someone
 * touches it they are opted out of their phone's own evening switch forever
 * without being told. The third position is how they get back — and it is why
 * the middle label reads "Auto" rather than being dropped to match the two-way
 * switch this was modelled on.
 *
 * ── The mount guard ───────────────────────────────────────────────────────
 * The server has no idea what the device prefers, so the first client render
 * must match the server's markup or React tears the tree down with a
 * hydration error. Rendering a same-sized inert placeholder until mounted
 * keeps the layout from jumping, which a `null` return would not.
 */

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'Auto', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

export function ThemeToggle({
  className,
  /** `labelled` prints the word beside the icon — for the top bar, where there
   *  is room and the control should be readable at a glance rather than
   *  decoded. `compact` is icon-only, for tight chrome. */
  variant = 'compact',
}: {
  className?: string;
  variant?: 'compact' | 'labelled';
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const labelled = variant === 'labelled';

  if (!mounted) {
    return (
      <div
        aria-hidden
        className={cn(
          'glass-control h-10 rounded-full',
          labelled ? 'w-[13.5rem]' : 'w-[7.5rem]',
          className,
        )}
      />
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        // The same floating-control surface as the search pill and the bell,
        // so the top bar reads as one set of objects rather than three styles.
        'glass-control inline-flex shrink-0 items-center gap-0.5 rounded-full p-1',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = (theme ?? 'system') === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'relative flex items-center justify-center gap-1.5 rounded-full',
              'text-xs font-bold tracking-[-0.01em]',
              'transition-all duration-200 ease-[var(--ease-out-quint)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              labelled ? 'h-10 px-3.5' : 'size-10',
              active
                ? 'glass-lens text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {labelled ? <span>{label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
