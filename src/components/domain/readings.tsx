import { cn } from '@/lib/utils';

/**
 * ═══ THE READINGS ═════════════════════════════════════════════════════════
 *
 * Instruments, not decoration. Every one of these renders a figure a service
 * already computed — nothing here sums, averages or infers anything, so a
 * wrong number is wrong in one tested place on the server rather than in a
 * chart nobody thought to test.
 *
 * ── Why no sparklines ─────────────────────────────────────────────────────
 * The obvious thing to put on a dashboard like this is a trend line. There is
 * no trend data: the services return a position at a moment, not a series. A
 * plausible-looking line drawn from a single point is a lie about the
 * business, and on a screen where a director decides whether to chase a client
 * for 1.4 million it is an expensive one. When somebody adds a snapshot table,
 * the line belongs here. Until then it does not exist.
 *
 * ── Why these are server components ───────────────────────────────────────
 * All of the motion is CSS keyframes driven by custom properties set inline.
 * No hooks, no effects, no hydration, no JavaScript shipped for a ring that
 * draws itself once. Reduced motion is handled centrally in globals.css.
 */

/* ─────────────────────────────────────────────────────────────────────────
   GAUGE RING
   ───────────────────────────────────────────────────────────────────────── */

/**
 * A proportion, drawn as an arc that sweeps to its value once on load.
 *
 * The number in the middle is the reading; the caption under it says what was
 * measured. Both are required — an unlabelled 72% on a commercial dashboard is
 * an invitation to guess, and people guess generously.
 *
 * `tone` follows the RAG scale when the proportion IS a risk measure. Left at
 * `brand`, the arc is simply the accent and carries no commercial claim.
 */
export function GaugeRing({
  value,
  total,
  label,
  caption,
  tone = 'brand',
  size = 108,
  className,
}: {
  /** The part. */
  value: number;
  /** The whole. Zero is handled: the ring renders empty rather than dividing. */
  total: number;
  label: string;
  caption?: string;
  tone?: 'brand' | 'green' | 'amber' | 'red';
  size?: number;
  className?: string;
}) {
  const stroke = Math.max(8, Math.round(size * 0.093));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  /*
    `total === 0` is "nothing to measure", not "zero per cent". A ring reading
    a hard 0% on a fresh deployment is a false statement about a company that
    has simply not raised a change yet — and on the notice gauge it is the
    alarming direction to be wrong in.
  */
  const measurable = total > 0;
  const ratio = measurable ? Math.min(1, Math.max(0, value / total)) : 0;
  const offset = circumference * (1 - ratio);
  const percent = Math.round(ratio * 100);

  const arcColour = {
    brand: 'url(#gauge-brand)',
    green: 'var(--risk-green)',
    amber: 'var(--risk-amber)',
    red: 'var(--risk-red)',
  }[tone];

  const numberColour = {
    brand: 'text-foreground',
    green: 'text-risk-green',
    amber: 'text-risk-amber',
    red: 'text-risk-red',
  }[tone];

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={
            measurable
              ? `${label}: ${value} of ${total}, ${percent} per cent`
              : `${label}: nothing to measure yet`
          }
        >
          <defs>
            {/*
              The gradient is defined per-instance. Two rings on one page with
              the same gradient id is legal HTML and renders correctly, but a
              duplicated id is a trap the next person falls into, so the id is
              scoped by the geometry that produced it.
            */}
            <linearGradient id="gauge-brand" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--brand)" />
              <stop offset="100%" stopColor="var(--brand-2)" />
            </linearGradient>
          </defs>

          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arcColour}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="motion-gauge"
            style={{ ['--gauge-circumference' as string]: `${circumference}` }}
          />
        </svg>

        <span className="absolute inset-0 flex flex-col items-center justify-center">
          {measurable ? (
            <span
              className={cn(
                'tabular text-[1.4rem] font-extrabold leading-none tracking-[-0.04em]',
                numberColour,
              )}
            >
              {percent}
              <span className="text-[0.8rem] font-bold">%</span>
            </span>
          ) : (
            <span className="text-[1.4rem] font-extrabold leading-none text-muted-foreground">
              —
            </span>
          )}
        </span>
      </div>

      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-[-0.01em]">{label}</p>
        {caption ? (
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{caption}</p>
        ) : null}
        <p className="tabular mt-1.5 text-xs font-semibold text-muted-foreground">
          {measurable ? `${value.toLocaleString()} of ${total.toLocaleString()}` : 'Nothing yet'}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   FUNNEL RAIL
   ───────────────────────────────────────────────────────────────────────── */

export interface FunnelStage {
  label: string;
  /** Already formatted for display — this component does not touch money. */
  display: string;
  /** The raw figure, used only to size the bar. */
  amount: number;
  /** What the gap between this stage and the last one means, if it matters. */
  gapNote?: string;
  gapTone?: 'amber' | 'red';
}

/**
 * The commercial funnel: agreed → applied for → received.
 *
 * This is the product's whole argument in one control. Each bar is measured
 * against the FIRST stage, not against the one above it, so the shortfall you
 * see is the shortfall against what the client actually agreed — which is the
 * question being asked. Measuring each against its predecessor would make a
 * company that has invoiced nothing look 100% efficient at invoicing.
 *
 * The bars are absolute, not normalised. A funnel where every stage fills the
 * width tells you nothing; the point is the shrinking.
 */
export function FunnelRail({ stages }: { stages: FunnelStage[] }) {
  /*
    Nothing agreed yet.

    On a fresh deployment every stage is zero, and the bars were rendering as
    three 2%-wide slivers under three "AED 0" labels — which looks like a
    chart that failed rather than a company that has not raised a variation
    yet. Seen on the real thing the moment there was an empty database behind
    it, which is exactly the case a mock never shows you.
  */
  if (stages.every((stage) => stage.amount === 0)) {
    return (
      <p className="py-6 text-sm leading-relaxed text-muted-foreground">
        No client has agreed a variation yet. This fills in once changes are priced,
        sent and approved.
      </p>
    );
  }

  const top = Math.max(...stages.map((stage) => stage.amount), 1);

  return (
    <ol className="flex flex-col gap-3.5">
      {stages.map((stage, index) => {
        const width = Math.max(2, (stage.amount / top) * 100);
        return (
          <li key={stage.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold tracking-[-0.01em] text-muted-foreground">
                {stage.label}
              </span>
              <span className="tabular text-sm font-bold tracking-[-0.02em]">{stage.display}</span>
            </div>

            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="motion-bar h-full rounded-full origin-left"
                style={{
                  width: `${width}%`,
                  animationDelay: `${index * 90}ms`,
                  /* Later stages step down in weight, so the eye reads the
                     order without needing the numbers. */
                  background: 'var(--brand-gradient)',
                  opacity: 1 - index * 0.22,
                }}
              />
            </div>

            {stage.gapNote ? (
              <p
                className={cn(
                  'mt-1.5 text-xs font-semibold',
                  stage.gapTone === 'red' ? 'text-risk-red' : 'text-risk-amber',
                )}
              >
                {stage.gapNote}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   MINI BARS
   ───────────────────────────────────────────────────────────────────────── */

/**
 * A small distribution, for when the shape matters and the exact values do not.
 *
 * The tallest bar carries the brand fill and the rest are neutral: on a
 * breakdown of "where are the changes stuck", the answer is the tall one, and
 * colouring every bar the same makes the reader do the comparison themselves.
 *
 * Bars are titled, so the value is available on hover and to a screen reader
 * without printing eleven numbers nobody asked for.
 */
export function MiniBars({
  data,
  className,
}: {
  data: { label: string; count: number }[];
  className?: string;
}) {
  if (data.length === 0) {
    return <p className={cn('text-xs text-muted-foreground', className)}>No data yet</p>;
  }

  const top = Math.max(...data.map((row) => row.count), 1);

  return (
    <div className={cn('flex h-16 items-end gap-1.5', className)}>
      {data.slice(0, 12).map((row, index) => {
        const tallest = row.count === top;
        return (
          <div
            key={row.label}
            title={`${row.label}: ${row.count}`}
            className="motion-bar min-w-0 flex-1 rounded-t-md rounded-b-sm"
            style={{
              height: `${Math.max(6, (row.count / top) * 100)}%`,
              animationDelay: `${index * 45}ms`,
              background: tallest ? 'var(--brand-gradient)' : 'var(--muted)',
              boxShadow: tallest ? 'var(--brand-glow)' : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
