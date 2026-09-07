/**
 * What the shell shows while a page is being built on the server.
 *
 * ── Why this file has to exist ────────────────────────────────────────────
 * Every page in this group is `force-dynamic` and most of them make several
 * round trips to a hosted Postgres before they can render a single row. Until
 * now there was no `loading.tsx` anywhere in the application, which means Next
 * had no boundary to suspend at: the browser sat on the PREVIOUS page, with
 * nothing moving, for as long as the query took. On site wifi that is regularly
 * a second or more of an interface that appears to have ignored the tap — and
 * the documented reason the capture button exists is that people give up on
 * things that feel slow.
 *
 * Adding the file is the whole fix. Next now streams the shell immediately and
 * swaps this out when the page resolves.
 *
 * ── Why bars and not a spinner ────────────────────────────────────────────
 * A spinner says "something is happening". A skeleton in the shape of the page
 * says "your figures are coming, and here is where they will be", which stops
 * the layout jumping when they land. It is also honest about the wait: three
 * shapes at 60% opacity read as unfinished, where a polished spinner can read
 * as a finished state that is broken.
 *
 * There is deliberately NO looping animation here. The product has exactly one
 * — a breached notice deadline — and spending a second on a loading state
 * would devalue the only one that costs money when it is missed. These fade in
 * once, using the same 240ms rise as real content, and then hold still.
 */
function Bar({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-[var(--muted)] ${className ?? ''}`}
      style={{ opacity: 0.65 }}
    />
  );
}

function Tile() {
  return (
    <div className="panel panel-flat flex h-full flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <Bar className="h-3 w-24" />
        <Bar className="size-8 rounded-xl" />
      </div>
      <Bar className="h-8 w-16" />
      <Bar className="h-2.5 w-28" />
    </div>
  );
}

export default function Loading() {
  return (
    /*
      `aria-busy` plus a polite live region, so this is announced once rather
      than being a silent screenful of empty boxes to a screen reader. The
      visible shapes are hidden from the accessibility tree — they carry no
      information, and reading out eleven "blank" nodes is worse than nothing.
    */
    <div className="motion-rise mx-auto flex max-w-7xl flex-col gap-5" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>

      <div aria-hidden className="flex flex-col gap-5">
        <div className="pt-1">
          <Bar className="h-7 w-64" />
          <Bar className="mt-3 h-3 w-full max-w-md" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="panel h-56 p-5" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="panel h-24 p-5" />
            <div className="panel h-24 p-5" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Tile key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
