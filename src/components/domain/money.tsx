/**
 * Currency, rendered with tabular figures so columns of money line up.
 *
 * Large values are abbreviated (1.2M) only in dashboard tiles, never in a
 * register or on a detail page — a rounded commercial figure next to a decision
 * is how the wrong number gets quoted.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency = 'AED',
  options: { abbreviate?: boolean } = {},
): string {
  if (value === null || value === undefined) return '—';
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return '—';

  if (options.abbreviate && Math.abs(amount) >= 1_000_000) {
    return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (options.abbreviate && Math.abs(amount) >= 10_000) {
    return `${currency} ${Math.round(amount / 1000)}k`;
  }

  return `${currency} ${amount.toLocaleString('en-AE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function Money({
  value,
  currency = 'AED',
  abbreviate = false,
}: {
  value: number | string | null | undefined;
  currency?: string;
  abbreviate?: boolean;
}) {
  return <span className="tabular">{formatMoney(value, currency, { abbreviate })}</span>;
}
