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
 * without being told. The third position is how they get back.
 *
 * ── The mount guard ───────────────────────────────────────────────────────
 * The server has no idea what the device prefers, so the first client render
 * must match the server's markup or React tears the tree down with a
 * hydration error. Rendering a same-sized inert placeholder until mounted
 * keeps the layout from jumping, which a `null` return would not.
 */

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        aria-hidden
        className={cn('h-9 w-[7.5rem] rounded-full border border-border', className)}
      />
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border p-0.5',
        'bg-[var(--glass-soft)]',
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
              'relative flex size-8 items-center justify-center rounded-full',
              'transition-all duration-200 ease-[var(--ease-out-quint)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'brand-fill shadow-[var(--brand-glow)]'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
