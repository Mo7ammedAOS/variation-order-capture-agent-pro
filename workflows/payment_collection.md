# Payment Collection

> **Status:** specified and built, 2026-09-01.

## Workflow Name

Payment Collection

## Business Objective

Record money actually received, so the register and the bank agree, and so
"outstanding" and "overdue" mean something.

## Trigger

A person, when a receipt lands.

## Inputs

Amount, date received, reference (cheque number, transfer reference,
certificate number), method, notes.

## User Roles

Finance Manager, Finance Officer. Directors by system role.

## Permissions Required

`payment.record`. Held apart from `invoice.manage` on purpose: the person who
says what was invoiced should not be the only person who says it was paid.

## Custom App Services Used

`src/services/payment.service.ts` — `recordPayment`, `removePayment`,
`listPayments`.

## n8n Workflow Used

None — internal only. No bank feed, and no plan for one: a system that marks
invoices paid from a feed will eventually mark the wrong one.

## AI Use

None, and never.

## Human Approval Gates

None. Recording a fact is not a decision. Removing one is audited instead.

## Step-by-Step Logic

1. Refuse against a `draft` application — nothing can have been paid against
   something never issued — and against a cancelled one.
2. Refuse a receipt larger than what is outstanding. It belongs to another
   invoice, or this one was wrong; absorbing it would hide both.
3. Refuse a date in the future.
4. Write the payment.
5. Recompute the invoice status from the SUM OF ITS PAYMENTS:
   nothing → `issued`, some → `part_paid`, all → `paid`.

Step 5 is the whole point. Nobody ticks "paid" by hand, so the register can
never say paid while the bank says otherwise.

## Database Changes

`payments` row. `invoices.status` recomputed.

## Notifications

None. `invoice_overdue` bottlenecks resolve on their own once the money lands.

## Error Handling

Validation errors with actionable sentences. No external call.

## Retry Logic

None. Two receipts of the same amount on the same day are a real thing — a
part payment paid twice — so there is deliberately no dedupe that would swallow
the second.

## Audit Events

`payment / created` with the amount, date, reference and the resulting invoice
status. `payment / deleted` with everything that was removed.

## Edge Cases

- **Part payment** — ordinary, not an exception. Many payments per invoice.
- **A receipt against the wrong invoice** — `removePayment` deletes the row and
  recomputes the status. This is the ONE deletion the system allows, because a
  negative payment would make every sum on the page mean something else. The
  audit event holds what was removed, so nothing is lost.
- **Retention** — never appears here. It was withheld at application, so it was
  never invoiced and is not outstanding. It is released by a separate
  application at practical completion. Not yet built.

## Definition of Done

Every receipt has a date, an amount and a reference; invoice status is derived
and never typed; and the outstanding and overdue figures on the dashboard can
be reconciled to the payments table.
