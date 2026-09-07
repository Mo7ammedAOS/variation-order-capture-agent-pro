'use client';

import { Search } from 'lucide-react';

/**
 * The discoverable half of Cmd+K.
 *
 * A keyboard shortcut nobody is told about is a shortcut for the person who
 * built it. This sits at the top of the sidebar looking like a search box,
 * because that is what people reach for, and it teaches the shortcut by
 * printing it next to itself.
 *
 * It dispatches the same keystroke rather than lifting the palette's state up:
 * one way in, so the click path and the keyboard path cannot drift.
 */
export function CommandTrigger() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
        )
      }
      className={[
        'mb-3 flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5',
        'bg-[var(--glass-soft)] text-sm text-muted-foreground backdrop-blur-md',
        'transition-all duration-200 ease-[var(--ease-out-quint)]',
        'hover:border-[oklch(from_var(--brand)_l_c_h/0.4)] hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      ].join(' ')}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="flex-1 text-start font-medium">Search</span>
      <kbd className="rounded-md border border-border bg-[var(--glass-soft)] px-1.5 py-0.5 text-[10px] font-semibold">
        ⌘K
      </kbd>
    </button>
  );
}
