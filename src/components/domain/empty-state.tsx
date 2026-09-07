import type { LucideIcon } from 'lucide-react';

/**
 * Nothing here — said in a way that distinguishes "nothing yet" from "broken".
 *
 * The dashed edge is deliberate and is the one place dashes appear in the
 * product: a solid-edged empty panel looks like a component that failed to
 * load, whereas a dashed outline reads as a space waiting to be filled. On a
 * register that is empty because a filter matched nothing, that difference is
 * the whole message.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--panel-radius)] border border-dashed border-border bg-[var(--glass-soft)] px-6 py-14 text-center backdrop-blur-sm">
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-[var(--glass-soft)] text-muted-foreground">
          <Icon aria-hidden className="size-5" />
        </span>
      ) : null}
      <p className="font-semibold tracking-[-0.01em]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
