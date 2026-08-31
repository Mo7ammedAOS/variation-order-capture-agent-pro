'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, FileX2, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import {
  addLineItemAction,
  notAVariationAction,
  removeLineItemAction,
  setRatesAction,
  submitPricingAction,
  type PricingState,
} from './pricing-actions';

/**
 * The quantity surveyor's desk.
 *
 * Two outcomes sit side by side on purpose, and the second is not a failure: a
 * QS reading a change against the contract either finds work the client owes
 * for, or finds work already sold. Hiding "not a variation" behind the pricing
 * form would make the honest answer the harder one to give, and a contractor
 * that claims for work it already sold loses credibility on the claims that
 * matter.
 *
 * Every figure shown here was computed on the server. Nothing on this page
 * adds anything up.
 */

const RATE_SOURCES = [
  ['contract_boq', 'Contract BOQ rate', 'A rate already in the priced bill. Hardest to dispute.'],
  ['pro_rata', 'Pro-rata from BOQ', 'Derived from a bill rate for similar work.'],
  ['star_rate', 'Star rate (new)', 'No comparable rate. Has to be agreed with the client.'],
  ['quotation', 'Quotation', 'A price from a subcontractor or supplier.'],
  ['daywork', 'Daywork', 'Time and materials, recorded on sheets.'],
] as const;

const CATEGORIES = [
  ['labour', 'Labour'],
  ['material', 'Material'],
  ['plant', 'Plant'],
  ['subcontractor', 'Subcontractor'],
  ['other', 'Other'],
] as const;

export interface PricingLine {
  id: string;
  sequence: number;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  amount: string;
  rateSource: string;
  category: string;
  boqReference: string | null;
}

export interface PricingPanelProps {
  potentialChangeId: string;
  currency: string;
  canPrice: boolean;
  pricingStatus: 'not_started' | 'draft' | 'submitted' | 'approved';
  submittedValue: string | null;
  submittedAt: string | null;
  prelimsPercent: string;
  overheadProfitPercent: string;
  pricingNotes: string;
  items: PricingLine[];
  totals: {
    net: string;
    prelims: string;
    overheadProfit: string;
    total: string;
    starRateCount: number;
  };
}

function Money({ value, currency }: { value: string; currency: string }) {
  const n = Number(value);
  return (
    <span className="tabular-nums">
      {currency} {Number.isFinite(n) ? n.toLocaleString('en-AE', { minimumFractionDigits: 2 }) : value}
    </span>
  );
}

function Submit({ label, busy, variant }: { label: string; busy: string; variant?: 'default' | 'outline' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function Note({ state }: { state: PricingState }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-risk-red">
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="flex items-start gap-2 text-sm text-risk-green">
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
        {state.ok}
      </p>
    );
  }
  return null;
}

export function PricingPanel(props: PricingPanelProps) {
  const { potentialChangeId, currency, canPrice, pricingStatus, items, totals } = props;

  const [addState, addAction] = useActionState<PricingState, FormData>(addLineItemAction, {});
  const [ratesState, ratesAction] = useActionState<PricingState, FormData>(setRatesAction, {});
  const [submitState, submitAction] = useActionState<PricingState, FormData>(
    submitPricingAction,
    {},
  );
  const [noneState, noneAction] = useActionState<PricingState, FormData>(notAVariationAction, {});

  const [declaring, setDeclaring] = useState(false);
  const frozen = pricingStatus === 'submitted' || pricingStatus === 'approved';
  const editable = canPrice && !frozen;

  return (
    <Card tone={frozen ? 'plain' : 'insight'}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {pricingStatus === 'approved'
            ? 'Approved price'
            : frozen
              ? 'Price submitted for approval'
              : 'Pricing'}
        </CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {pricingStatus === 'approved'
            ? 'Agreed and fixed.'
            : frozen
              ? `Submitted${props.submittedAt ? ` on ${props.submittedAt}` : ''} and now with the project manager and the managing director. The figure cannot change while they are deciding on it.`
              : 'Build it up line by line. Every rate says where it came from, because that is the line that gets argued.'}
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {items.length > 0 ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-1 py-2 text-start font-medium">Description</th>
                  <th className="px-1 py-2 text-end font-medium">Qty</th>
                  <th className="px-1 py-2 text-start font-medium">Unit</th>
                  <th className="px-1 py-2 text-end font-medium">Rate</th>
                  <th className="px-1 py-2 text-end font-medium">Amount</th>
                  {editable ? <th className="px-1 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-border/50 align-top">
                    <td className="px-1 py-2">
                      <span className="font-medium">{item.description}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className={
                            item.rateSource === 'star_rate'
                              ? 'rounded-full bg-risk-amber-bg px-1.5 py-0.5 font-medium text-risk-amber'
                              : 'rounded-full bg-secondary px-1.5 py-0.5'
                          }
                        >
                          {RATE_SOURCES.find(([v]) => v === item.rateSource)?.[1] ?? item.rateSource}
                        </span>
                        <span>{CATEGORIES.find(([v]) => v === item.category)?.[1]}</span>
                        {item.boqReference ? <span>BOQ {item.boqReference}</span> : null}
                      </span>
                    </td>
                    <td className="px-1 py-2 text-end tabular-nums">{item.quantity}</td>
                    <td className="px-1 py-2">{item.unit}</td>
                    <td className="px-1 py-2 text-end tabular-nums">{item.rate}</td>
                    <td className="px-1 py-2 text-end font-medium tabular-nums">{item.amount}</td>
                    {editable ? (
                      <td className="px-1 py-2 text-end">
                        <form action={removeLineItemAction}>
                          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                          <input type="hidden" name="lineItemId" value={item.id} />
                          <button
                            type="submit"
                            aria-label={`Remove ${item.description}`}
                            className="text-muted-foreground transition-colors hover:text-risk-red"
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No lines yet.</p>
        )}

        {items.length > 0 ? (
          <dl className="flex flex-col gap-1.5 rounded-xl bg-secondary/50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <dt>Net</dt>
              <dd><Money value={totals.net} currency={currency} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">
                Preliminaries {props.prelimsPercent ? `${props.prelimsPercent}%` : ''}
              </dt>
              <dd><Money value={totals.prelims} currency={currency} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">
                Overhead and profit {props.overheadProfitPercent ? `${props.overheadProfitPercent}%` : ''}
              </dt>
              <dd><Money value={totals.overheadProfit} currency={currency} /></dd>
            </div>
            <div className="mt-1 flex items-center justify-between border-t pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd><Money value={frozen && props.submittedValue ? props.submittedValue : totals.total} currency={currency} /></dd>
            </div>
            {totals.starRateCount > 0 ? (
              <p className="mt-1.5 flex items-start gap-2 text-xs text-risk-amber">
                <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {totals.starRateCount} {totals.starRateCount === 1 ? 'line rests' : 'lines rest'} on a
                new rate that still has to be agreed with the client.
              </p>
            ) : null}
          </dl>
        ) : null}

        {editable ? (
          <>
            <form action={addAction} className="flex flex-col gap-3 border-t border-border/60 pt-4">
              <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
              <p className="text-sm font-semibold">Add a line</p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" required placeholder="Remove blockwork to grid C-4 and make good" />
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input id="quantity" name="quantity" type="number" step="0.001" min="0.001" required inputMode="decimal" />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="unit">Unit</Label>
                  <Input id="unit" name="unit" defaultValue="m2" placeholder="m2" />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="rate">Rate</Label>
                  <Input id="rate" name="rate" type="number" step="0.01" min="0" required inputMode="decimal" />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="category">Category</Label>
                  <Select id="category" name="category" defaultValue="material">
                    {CATEGORIES.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="rateSource">Where does the rate come from?</Label>
                  <Select id="rateSource" name="rateSource" defaultValue="contract_boq">
                    {RATE_SOURCES.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A star rate is new work with no comparable rate, and it is the line the
                    client will question first.
                  </p>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="boqReference">BOQ reference</Label>
                  <Input id="boqReference" name="boqReference" placeholder="e.g. 2.14.3" />
                </div>
              </div>

              <Note state={addState} />
              <div>
                <Submit label="Add line" busy="Adding…" variant="outline" />
              </div>
            </form>

            <form action={ratesAction} className="flex flex-col gap-3 border-t border-border/60 pt-4">
              <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="prelimsPercent">Preliminaries %</Label>
                  <Input id="prelimsPercent" name="prelimsPercent" type="number" step="0.001" min="0" max="100" defaultValue={props.prelimsPercent} inputMode="decimal" />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="overheadProfitPercent">Overhead and profit %</Label>
                  <Input id="overheadProfitPercent" name="overheadProfitPercent" type="number" step="0.001" min="0" max="100" defaultValue={props.overheadProfitPercent} inputMode="decimal" />
                  <p className="text-xs text-muted-foreground">Taken on the net plus preliminaries.</p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pricingNotes">Notes on the price</Label>
                <Textarea id="pricingNotes" name="pricingNotes" rows={2} defaultValue={props.pricingNotes} placeholder="Assumptions, exclusions, what the client still has to confirm." />
              </div>
              <Note state={ratesState} />
              <div>
                <Submit label="Save percentages and notes" busy="Saving…" variant="outline" />
              </div>
            </form>

            <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
              <form action={submitAction} className="flex flex-col gap-2">
                <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                <div className="flex flex-wrap items-center gap-3">
                  <Submit label="Submit this price for approval" busy="Submitting…" />
                  <span className="text-sm text-muted-foreground">
                    Goes to the project manager and the managing director. The figure is fixed
                    once it does.
                  </span>
                </div>
                <Note state={submitState} />
              </form>

              {declaring ? (
                <form action={noneAction} className="flex flex-col gap-2.5 rounded-xl bg-secondary/50 p-4">
                  <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                  <Label htmlFor="reason">Which part of the contract already covers this?</Label>
                  <Textarea id="reason" name="reason" rows={2} required placeholder="e.g. Covered by BOQ item 2.14 — blockwork to all internal partitions, measured as provisional." />
                  <p className="text-xs text-muted-foreground">
                    The engineer who raised it will see this. So, in all likelihood, will the
                    client, if they ever ask why it was not claimed.
                  </p>
                  <Note state={noneState} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Submit label="Record as not a variation" busy="Saving…" variant="outline" />
                    <button type="button" onClick={() => setDeclaring(false)} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setDeclaring(true)}>
                    <FileX2 aria-hidden className="size-4" />
                    This is not a variation
                  </Button>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    The work is already covered by the contract, so there is nothing to claim.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : null}

        {!canPrice && !frozen ? (
          <p className="border-t border-border/60 pt-4 text-sm text-muted-foreground">
            Waiting on the quantity surveyor to price this.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
