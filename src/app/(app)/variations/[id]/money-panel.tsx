'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  HandCoins,
  Send,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { formatMoney } from '@/components/domain/money';
import {
  draftApplicationAction,
  issueInvoiceAction,
  raiseVoAction,
  recordClientResponseAction,
  recordPaymentAction,
  recordSubmissionAction,
  type MoneyState,
} from './money-actions';

/**
 * From "we agreed it internally" to "the money arrived".
 *
 * ── Only one thing is ever asked for ───────────────────────────────────────
 * The panel shows the ONE action that is actually next, and the history of
 * what has already happened. A form for every possible step would make the
 * commonest mistake easy: applying for money against a variation the client
 * has not agreed.
 *
 * ── Every figure shown here was computed on the server ─────────────────────
 * Nothing on this page adds anything up. If a number is wrong it is wrong in
 * one place, in `lib/money.ts`, where there is a test for it.
 */

export interface PaymentView {
  id: string;
  amount: string;
  receivedAt: string;
  reference: string | null;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  status: 'draft' | 'issued' | 'part_paid' | 'paid' | 'cancelled';
  periodEnd: string;
  cumulativePercent: string;
  grossThisPeriod: string;
  retentionAmount: string;
  netValue: string;
  vatAmount: string;
  totalDue: string;
  issuedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  paidTotal: string;
  outstanding: string;
  payments: PaymentView[];
}

export interface VoView {
  id: string;
  voNumber: string;
  status: 'draft' | 'submitted' | 'approved' | 'part_approved' | 'rejected' | 'withdrawn';
  clientResponse: string;
  submittedValue: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  approvedValue: string | null;
  shortfall: string | null;
  clientResponseAt: string | null;
  clientReference: string | null;
  clientResponseNotes: string | null;
  unbilled: string | null;
  invoices: InvoiceView[];
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

function Result({ state }: { state: MoneyState }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-center gap-2 text-sm text-risk-red">
        <AlertCircle aria-hidden className="size-4" />
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="flex items-center gap-2 text-sm text-risk-green">
        <CheckCircle2 aria-hidden className="size-4" />
        {state.ok}
      </p>
    );
  }
  return null;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/* ─── Nothing raised yet ─────────────────────────────────────────────────── */

function RaisePanel({
  potentialChangeId,
  currency,
  approvedValue,
}: {
  potentialChangeId: string;
  currency: string;
  approvedValue: string | null;
}) {
  const [state, action] = useActionState<MoneyState, FormData>(raiseVoAction, {});

  return (
    <Card tone="work">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Put it to the client</CardTitle>
        <p className="text-sm text-muted-foreground">
          Both seats approved {approvedValue ? formatMoney(Number(approvedValue), currency) : 'this change'}.
          Nothing has gone to the client yet.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
          <Submit label="Raise the variation order" />
          <Result state={state} />
        </form>
      </CardContent>
    </Card>
  );
}

/* ─── The panel ──────────────────────────────────────────────────────────── */

export function MoneyPanel({
  potentialChangeId,
  currency,
  vo,
  canManageVo,
  canInvoice,
  canRecordPayment,
  changeIsApproved,
  approvedInternalValue,
}: {
  potentialChangeId: string;
  currency: string;
  vo: VoView | null;
  canManageVo: boolean;
  canInvoice: boolean;
  canRecordPayment: boolean;
  changeIsApproved: boolean;
  approvedInternalValue: string | null;
}) {
  const [state, submitAction] = useActionState<MoneyState, FormData>(recordSubmissionAction, {});
  const [responseState, responseAction] = useActionState<MoneyState, FormData>(
    recordClientResponseAction,
    {},
  );
  const [applyState, applyAction] = useActionState<MoneyState, FormData>(
    draftApplicationAction,
    {},
  );
  const [response, setResponse] = useState('approved');
  const [applying, setApplying] = useState(false);

  if (!vo) {
    if (!changeIsApproved || !canManageVo) return null;
    return (
      <RaisePanel
        potentialChangeId={potentialChangeId}
        currency={currency}
        approvedValue={approvedInternalValue}
      />
    );
  }

  const agreed = vo.status === 'approved' || vo.status === 'part_approved';

  return (
    <Card tone={agreed ? 'plain' : 'work'}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{vo.voNumber}</CardTitle>
          <StatusChip vo={vo} />
        </div>
        <div className="mt-2 flex flex-col gap-1 text-sm sm:max-w-sm">
          <Line
            label="Submitted"
            value={vo.submittedValue ? formatMoney(Number(vo.submittedValue), currency) : '—'}
          />
          {vo.approvedValue ? (
            <Line label="Client agreed" value={formatMoney(Number(vo.approvedValue), currency)} />
          ) : null}
          {vo.shortfall && Number(vo.shortfall) > 0 ? (
            <div className="flex justify-between gap-4 text-risk-amber">
              <span>Conceded</span>
              <span className="tabular-nums">{formatMoney(Number(vo.shortfall), currency)}</span>
            </div>
          ) : null}
          {agreed && vo.unbilled && Number(vo.unbilled) > 0 ? (
            <Line
              label="Agreed, not yet applied for"
              value={formatMoney(Number(vo.unbilled), currency)}
              strong
            />
          ) : null}
        </div>
        {vo.clientReference ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Client reference {vo.clientReference}
          </p>
        ) : null}
        {vo.clientResponseNotes ? (
          <p className="mt-2 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
            {vo.clientResponseNotes}
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Step 1 — record that it went out. */}
        {vo.status === 'draft' && canManageVo ? (
          <form action={submitAction} className="flex flex-col gap-3">
            <input type="hidden" name="variationOrderId" value={vo.id} />
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
            <p className="text-sm text-muted-foreground">
              Send it to the client, then record the date here. The response clock runs from
              that date, not from today.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="submittedOn">Date submitted</Label>
                <Input id="submittedOn" name="submittedOn" type="date" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="timeImpactDaysClaimed">Days claimed</Label>
                <Input
                  id="timeImpactDaysClaimed"
                  name="timeImpactDaysClaimed"
                  type="number"
                  min={0}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="voClientReference">Our reference</Label>
                <Input id="voClientReference" name="clientReference" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Submit label="Record the submission" />
              <Result state={state} />
            </div>
          </form>
        ) : null}

        {/* Step 2 — what the client said. */}
        {vo.status === 'submitted' && canManageVo ? (
          <form action={responseAction} className="flex flex-col gap-3">
            <input type="hidden" name="variationOrderId" value={vo.id} />
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
            <p className="text-sm text-muted-foreground">
              Submitted {vo.submittedAt}
              {vo.submittedByName ? ` by ${vo.submittedByName}` : ''}. Record their answer when
              it comes.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="response">What did they say?</Label>
                <Select
                  id="response"
                  name="response"
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                >
                  <option value="approved">Agreed in full</option>
                  <option value="approved_with_adjustment">Agreed at a lower figure</option>
                  <option value="rejected">Rejected</option>
                  <option value="more_information_requested">Asked for more information</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="respondedOn">Date of their answer</Label>
                <Input id="respondedOn" name="respondedOn" type="date" required />
              </div>
            </div>

            {response === 'approved_with_adjustment' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="approvedValue">The figure they agreed</Label>
                  <Input
                    id="approvedValue"
                    name="approvedValue"
                    inputMode="decimal"
                    placeholder="0.00"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The difference stays on the file as conceded. It is not written off.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="approvedTimeImpactDays">Days they agreed</Label>
                  <Input
                    id="approvedTimeImpactDays"
                    name="approvedTimeImpactDays"
                    type="number"
                    min={0}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="responseReference">Their reference</Label>
                <Input
                  id="responseReference"
                  name="clientReference"
                  placeholder="Letter or certificate number"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="responseNotes">
                What they said{response === 'rejected' ? '' : ' (optional)'}
              </Label>
              <Textarea
                id="responseNotes"
                name="notes"
                rows={2}
                required={response === 'rejected'}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Submit label="Record the response" />
              <Result state={responseState} />
            </div>
          </form>
        ) : null}

        {/* The applications. */}
        {vo.invoices.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {vo.invoices.map((invoice) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                currency={currency}
                potentialChangeId={potentialChangeId}
                canInvoice={canInvoice}
                canRecordPayment={canRecordPayment}
              />
            ))}
          </ul>
        ) : null}

        {/* Step 3 — apply for the money. */}
        {agreed && canInvoice && Number(vo.unbilled ?? 0) > 0 ? (
          applying ? (
            <form action={applyAction} className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4">
              <input type="hidden" name="variationOrderId" value={vo.id} />
              <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
              <p className="text-sm text-muted-foreground">
                Enter how complete the variation is at the end of the period. Everything else —
                what was applied for before, retention, VAT, the total — is worked out from that.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="periodEnd">Period ending</Label>
                  <Input id="periodEnd" name="periodEnd" type="date" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cumulativePercent">Complete, cumulative %</Label>
                  <Input
                    id="cumulativePercent"
                    name="cumulativePercent"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Submit label="Draft the application" />
                <button
                  type="button"
                  onClick={() => setApplying(false)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Cancel
                </button>
                <Result state={applyState} />
              </div>
            </form>
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setApplying(true)}>
                <HandCoins aria-hidden className="size-4" />
                Apply for payment
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formatMoney(Number(vo.unbilled), currency)} agreed and not yet applied for.
              </p>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusChip({ vo }: { vo: VoView }) {
  if (vo.status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-risk-green-bg px-2 py-0.5 text-xs font-semibold text-risk-green">
        <BadgeCheck aria-hidden className="size-3" />
        Agreed in full
      </span>
    );
  }
  if (vo.status === 'part_approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-risk-amber-bg px-2 py-0.5 text-xs font-semibold text-risk-amber">
        <BadgeCheck aria-hidden className="size-3" />
        Agreed at a lower figure
      </span>
    );
  }
  if (vo.status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-risk-red-bg px-2 py-0.5 text-xs font-semibold text-risk-red">
        <X aria-hidden className="size-3" />
        Rejected
      </span>
    );
  }
  if (vo.status === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-risk-amber-bg px-2 py-0.5 text-xs font-semibold text-risk-amber">
        <Clock aria-hidden className="size-3" />
        With the client
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
      <Send aria-hidden className="size-3" />
      Not yet sent
    </span>
  );
}

function InvoiceRow({
  invoice,
  currency,
  potentialChangeId,
  canInvoice,
  canRecordPayment,
}: {
  invoice: InvoiceView;
  currency: string;
  potentialChangeId: string;
  canInvoice: boolean;
  canRecordPayment: boolean;
}) {
  const [issueState, issue] = useActionState<MoneyState, FormData>(issueInvoiceAction, {});
  const [payState, pay] = useActionState<MoneyState, FormData>(recordPaymentAction, {});
  const [paying, setPaying] = useState(false);

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {invoice.invoiceNumber} · to {invoice.periodEnd} · {invoice.cumulativePercent}%
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            invoice.status === 'paid'
              ? 'bg-risk-green-bg text-risk-green'
              : invoice.overdue
                ? 'bg-risk-red-bg text-risk-red'
                : invoice.status === 'draft'
                  ? 'bg-secondary text-muted-foreground'
                  : 'bg-risk-amber-bg text-risk-amber'
          }`}
        >
          {invoice.status === 'draft'
            ? 'Draft'
            : invoice.status === 'cancelled'
              ? 'Cancelled'
              : invoice.status === 'paid'
                ? 'Paid'
                : invoice.overdue
                  ? `Overdue since ${invoice.dueAt}`
                  : invoice.status === 'part_paid'
                    ? 'Part paid'
                    : `Due ${invoice.dueAt}`}
        </span>
      </div>

      {/* The arithmetic, in the order it appears on the paper. */}
      <div className="flex flex-col gap-1 text-sm sm:max-w-xs">
        <Line label="Gross this period" value={formatMoney(Number(invoice.grossThisPeriod), currency)} />
        <Line label="Retention" value={`(${formatMoney(Number(invoice.retentionAmount), currency)})`} />
        <Line label="Net" value={formatMoney(Number(invoice.netValue), currency)} />
        <Line label="VAT" value={formatMoney(Number(invoice.vatAmount), currency)} />
        <Line label="Total due" value={formatMoney(Number(invoice.totalDue), currency)} strong />
        {invoice.status !== 'draft' && Number(invoice.paidTotal) > 0 ? (
          <>
            <Line label="Received" value={formatMoney(Number(invoice.paidTotal), currency)} />
            <Line
              label="Outstanding"
              value={formatMoney(Number(invoice.outstanding), currency)}
              strong
            />
          </>
        ) : null}
      </div>

      {invoice.payments.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {invoice.payments.map((payment) => (
            <li key={payment.id}>
              {payment.receivedAt} · {formatMoney(Number(payment.amount), currency)}
              {payment.reference ? ` · ${payment.reference}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {invoice.status === 'draft' && canInvoice ? (
        <form action={issue} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`issuedOn-${invoice.id}`}>Date issued</Label>
            <Input id={`issuedOn-${invoice.id}`} name="issuedOn" type="date" required />
          </div>
          <Submit label="Issue it" />
          <Result state={issueState} />
        </form>
      ) : null}

      {canRecordPayment &&
      (invoice.status === 'issued' || invoice.status === 'part_paid') ? (
        paying ? (
          <form action={pay} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`amount-${invoice.id}`}>Amount received</Label>
              <Input
                id={`amount-${invoice.id}`}
                name="amount"
                inputMode="decimal"
                defaultValue={invoice.outstanding}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`receivedOn-${invoice.id}`}>Date received</Label>
              <Input id={`receivedOn-${invoice.id}`} name="receivedOn" type="date" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`reference-${invoice.id}`}>Reference</Label>
              <Input id={`reference-${invoice.id}`} name="reference" />
            </div>
            <Submit label="Record it" />
            <button
              type="button"
              onClick={() => setPaying(false)}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Cancel
            </button>
            <Result state={payState} />
          </form>
        ) : (
          <div>
            <Button variant="outline" size="sm" onClick={() => setPaying(true)}>
              Record a payment
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}
