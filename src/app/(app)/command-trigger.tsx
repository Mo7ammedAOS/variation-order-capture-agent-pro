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
      className="mb-2 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="flex-1 text-start">Search</span>
      <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
    </button>
  );
}
