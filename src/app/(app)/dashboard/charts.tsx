'use client';

import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

/**
 * Charts read data the services already computed. Nothing is summed here — if a
 * figure is wrong it is wrong in one place, server-side, where it is tested.
 *
 * The risk chart is the only one that colours by value, and it uses the same
 * RAG scale as every chip in the app so the two always agree. Every other
 * chart is the brand gradient, which is why `<defs>` below is not decoration:
 * a flat fill on frosted glass looks like a hole cut in the panel, whereas a
 * gradient reads as a solid object lying on it.
 *
 * ── The grid is deliberately absent ───────────────────────────────────────
 * No cartesian grid, no axis lines. Over a photographic ground every extra
 * hairline is another thing competing with the data, and a bar chart with
 * labelled axes does not need a ruled background to be read.
 */

const RISK_COLOURS: Record<string, string> = {
  green: 'var(--risk-green)',
  amber: 'var(--risk-amber)',
  red: 'var(--risk-red)',
};

const RISK_LABELS: Record<string, string> = { green: 'Low', amber: 'Warning', red: 'Critical' };

export function CountBarChart({
  title,
  data,
  colourByRisk = false,
}: {
  title: string;
  data: { label: string; count: number }[];
  colourByRisk?: boolean;
}) {
  const rows = colourByRisk
    ? data.map((row) => ({ ...row, label: RISK_LABELS[row.label] ?? row.label, key: row.label }))
    : data.map((row) => ({ ...row, key: row.label }));

  // Scoped to the chart so two of these on one page cannot share a gradient id.
  const gradientId = `bar-brand-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-2)" />
                    <stop offset="100%" stopColor="var(--brand)" />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={rows.length > 4 ? -25 : 0}
                  textAnchor={rows.length > 4 ? 'end' : 'middle'}
                  height={rows.length > 4 ? 60 : 30}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                />
                <Tooltip
                  cursor={{ fill: 'var(--accent)', radius: 8 }}
                  contentStyle={{
                    background: 'var(--popover)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid var(--glass-edge)',
                    borderRadius: 12,
                    boxShadow: 'var(--glass-shadow)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--popover-foreground)',
                  }}
                  labelStyle={{ color: 'var(--muted-foreground)', fontWeight: 600 }}
                />
                <Bar dataKey="count" radius={[6, 6, 2, 2]} maxBarSize={56}>
                  {rows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={
                        colourByRisk
                          ? (RISK_COLOURS[row.key] ?? `url(#${gradientId})`)
                          : `url(#${gradientId})`
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
