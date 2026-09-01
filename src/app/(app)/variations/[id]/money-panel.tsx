'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  HandCoins,
  RotateCcw,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { formatMoney } from '@/components/domain/money';
import {
  cancelCreditNoteAction,
  draftApplicationAction,
  draftCreditNoteAction,
  draftRetentionReleaseAction,
  issueCreditNoteAction,
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

export interface CreditNoteView {
  id: string;
  creditNoteNumber: string;
  status: 'draft' | 'issued' | 'cancelled';
  reason: string;
  narrative: string;
  grossAmount: string;
  totalCredited: string;
  issuedAt: string | null;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  status: 'draft' | 'issued' | 'part_paid' | 'paid' | 'cancelled';
  /** An application, or retention coming back. They read very differently. */
  kind: 'application' | 'retention_release';
  retentionStage: 'practical_completion' | 'defects_liability_end' | null;
  retentionReleased: string;
  /** Issued credits only, already netted off `outstanding` on the server. */
  creditedTotal: string;
  /** How much of this application is still creditable. */
  creditableGross: string;
  creditNotes: CreditNoteView[];
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
  /** Days, and the basis for them. Recorded, never valued. */
  timeImpactDaysClaimed: number | null;
  timeImpactBasis: string | null;
  approvedTimeImpactDays: number | null;
  /** Retention withheld on this variation and not yet asked back. */
  retentionHeld: string;
  /** Which moieties have already been released. */
  releasedStages: ('practical_completion' | 'defects_liability_end')[];
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="timeImpactBasis">
                If you are claiming days, what was delayed?
              </Label>
              <Textarea
                id="timeImpactBasis"
                name="timeImpactBasis"
                rows={2}
                placeholder="Ceiling grid could not start until the revised layout was issued, and the fit-out follows it."
              />
              <p className="text-xs text-muted-foreground">
                Which activity moved, and why it is on the critical path. Days with no basis
                get rejected, and a rejected claim makes the next one harder.
              </p>
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

        {/* Step 4 — retention comes back. */}
        {agreed && canInvoice && Number(vo.retentionHeld) > 0 ? (
          <RetentionRelease vo={vo} currency={currency} potentialChangeId={potentialChangeId} />
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
          {invoice.kind === 'retention_release'
            ? `${invoice.invoiceNumber} · retention released · ${
                invoice.retentionStage === 'practical_completion'
                  ? 'practical completion'
                  : 'end of defects liability'
              }`
            : `${invoice.invoiceNumber} · to ${invoice.periodEnd} · ${invoice.cumulativePercent}%`}
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
        {invoice.kind === 'retention_release' ? (
          // No gross and no percentage, because no new work was done. The
          // money was earned months ago and paid for less this amount.
          <Line
            label="Retention released"
            value={formatMoney(Number(invoice.retentionReleased), currency)}
          />
        ) : (
          <>
            <Line
              label="Gross this period"
              value={formatMoney(Number(invoice.grossThisPeriod), currency)}
            />
            <Line
              label="Retention"
              value={`(${formatMoney(Number(invoice.retentionAmount), currency)})`}
            />
          </>
        )}
        <Line label="Net" value={formatMoney(Number(invoice.netValue), currency)} />
        <Line label="VAT" value={formatMoney(Number(invoice.vatAmount), currency)} />
        <Line label="Total due" value={formatMoney(Number(invoice.totalDue), currency)} strong />
        {Number(invoice.creditedTotal) > 0 ? (
          <Line
            label="Credited"
            value={`(${formatMoney(Number(invoice.creditedTotal), currency)})`}
          />
        ) : null}
        {invoice.status !== 'draft' &&
        (Number(invoice.paidTotal) > 0 || Number(invoice.creditedTotal) > 0) ? (
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

      <CreditNotes
        invoice={invoice}
        currency={currency}
        potentialChangeId={potentialChangeId}
        canInvoice={canInvoice}
      />
    </li>
  );
}

/**
 * Retention coming back.
 *
 * Deliberately shown as two named milestones rather than a free amount box.
 * Retention is released because a contractual event happened — practical
 * completion, or the end of the defects liability period — not because
 * somebody decided to ask. Naming the event is what makes the release
 * defensible when the client queries it, and the stage is what stops the same
 * moiety being released twice.
 */
function RetentionRelease({
  vo,
  currency,
  potentialChangeId,
}: {
  vo: VoView;
  currency: string;
  potentialChangeId: string;
}) {
  const [state, action] = useActionState<MoneyState, FormData>(draftRetentionReleaseAction, {});
  const [open, setOpen] = useState(false);

  const pcDone = vo.releasedStages.includes('practical_completion');
  const dlpDone = vo.releasedStages.includes('defects_liability_end');

  if (pcDone && dlpDone) return null;

  if (!open) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Undo2 aria-hidden className="size-4" />
          Release retention
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {formatMoney(Number(vo.retentionHeld), currency)} withheld and not yet asked back
          {pcDone ? ', first moiety already released' : ''}.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-4">
      <input type="hidden" name="variationOrderId" value={vo.id} />
      <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
      <p className="text-sm text-muted-foreground">
        {formatMoney(Number(vo.retentionHeld), currency)} is held on {vo.voNumber}. Releasing it
        raises an invoice for it, with VAT, falling due on the usual terms.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`stage-${vo.id}`}>Which milestone</Label>
          <Select id={`stage-${vo.id}`} name="stage" defaultValue={pcDone ? 'defects_liability_end' : 'practical_completion'}>
            {pcDone ? null : (
              <option value="practical_completion">Practical completion</option>
            )}
            <option value="defects_liability_end">End of defects liability</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`releasePeriodEnd-${vo.id}`}>Dated</Label>
          <Input id={`releasePeriodEnd-${vo.id}`} name="periodEnd" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`releaseAmount-${vo.id}`}>Amount</Label>
          <Input
            id={`releaseAmount-${vo.id}`}
            name="amount"
            inputMode="decimal"
            placeholder="Leave blank for the contractual share"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Draft the release" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Cancel
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/**
 * Putting a wrong figure right.
 *
 * Only ever offered on an invoice the client already has. A draft is cancelled
 * rather than credited, and the service refuses anyway — two pieces of paper
 * explaining one non-event helps nobody.
 *
 * Draft and issue are separate steps for the same reason they are separate on
 * an application: the gap between them is where somebody checks it. A draft
 * moves no figure anywhere.
 */
function CreditNotes({
  invoice,
  currency,
  potentialChangeId,
  canInvoice,
}: {
  invoice: InvoiceView;
  currency: string;
  potentialChangeId: string;
  canInvoice: boolean;
}) {
  const [draftState, draft] = useActionState<MoneyState, FormData>(draftCreditNoteAction, {});
  const [issueState, issueIt] = useActionState<MoneyState, FormData>(issueCreditNoteAction, {});
  const [cancelState, cancelIt] = useActionState<MoneyState, FormData>(cancelCreditNoteAction, {});
  const [open, setOpen] = useState(false);

  const live = invoice.creditNotes.filter((note) => note.status !== 'cancelled');
  const creditable = Number(invoice.creditableGross);
  const offerable =
    canInvoice &&
    creditable > 0 &&
    (invoice.status === 'issued' || invoice.status === 'part_paid' || invoice.status === 'paid');

  if (live.length === 0 && !offerable) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
      {live.map((note) => (
        <div key={note.id} className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {note.creditNoteNumber} · ({formatMoney(Number(note.totalCredited), currency)})
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                note.status === 'issued'
                  ? 'bg-risk-amber-bg text-risk-amber'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {note.status === 'issued' ? `Credited ${note.issuedAt}` : 'Draft, nothing moved yet'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {note.reason.replace(/_/g, ' ')} · {note.narrative}
          </p>

          {note.status === 'draft' && canInvoice ? (
            <div className="flex flex-wrap items-end gap-3">
              <form action={issueIt} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="creditNoteId" value={note.id} />
                <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`cnIssuedOn-${note.id}`}>Date issued</Label>
                  <Input id={`cnIssuedOn-${note.id}`} name="issuedOn" type="date" required />
                </div>
                <Submit label="Issue the credit" />
              </form>
              <form action={cancelIt} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="creditNoteId" value={note.id} />
                <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
                <input type="hidden" name="reason" value="Raised in error" />
                <Button type="submit" variant="outline" size="sm">
                  Discard it
                </Button>
              </form>
              <Result state={issueState} />
              <Result state={cancelState} />
            </div>
          ) : null}
        </div>
      ))}

      {offerable ? (
        open ? (
          <form action={draft} className="flex flex-col gap-3 rounded-lg bg-card p-3">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="potentialChangeId" value={potentialChangeId} />
            <p className="text-xs text-muted-foreground">
              Up to {formatMoney(creditable, currency)} of this application can be credited. The
              retention withheld on whatever you credit comes back too.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`cnAmount-${invoice.id}`}>Gross being credited</Label>
                <Input
                  id={`cnAmount-${invoice.id}`}
                  name="grossAmount"
                  inputMode="decimal"
                  defaultValue={invoice.creditableGross}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`cnReason-${invoice.id}`}>Why</Label>
                <Select id={`cnReason-${invoice.id}`} name="reason" defaultValue="over_certification">
                  <option value="over_certification">We applied for too much</option>
                  <option value="client_deduction">The client certified less</option>
                  <option value="wrong_invoice">Billed against the wrong one</option>
                  <option value="duplicate">Billed twice</option>
                  <option value="other">Something else</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`cnNarrative-${invoice.id}`}>What happened</Label>
              <Textarea
                id={`cnNarrative-${invoice.id}`}
                name="narrative"
                rows={2}
                required
                placeholder="September application certified 75% against a measure that was later agreed at 60%."
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Submit label="Draft the credit" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Cancel
              </button>
              <Result state={draftState} />
            </div>
          </form>
        ) : (
          <div>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <RotateCcw aria-hidden className="size-4" />
              Credit some of this back
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
