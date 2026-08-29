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
 * RAG scale as every chip in the app so the two always agree.
 */

const NEUTRAL = 'var(--chart-1)';
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={rows.length > 4 ? -25 : 0}
                  textAnchor={rows.length > 4 ? 'end' : 'middle'}
                  height={rows.length > 4 ? 60 : 30}
                  stroke="var(--muted-foreground)"
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} stroke="var(--muted-foreground)" />
                <Tooltip
                  cursor={{ fill: 'var(--accent)' }}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--popover-foreground)',
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {rows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={colourByRisk ? (RISK_COLOURS[row.key] ?? NEUTRAL) : NEUTRAL}
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
