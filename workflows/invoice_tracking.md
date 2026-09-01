# Invoice Tracking

> **Status:** specified and built, 2026-09-01.

## Workflow Name

Invoice Tracking

## Business Objective

Apply for the money on a variation the client has agreed, and know at any
moment what has been applied for, what is still owed, and what is late.

## Trigger

A person, after the client agrees a VO. A task is raised on the finance seat
the moment the agreement is recorded, so the step has an owner rather than
waiting to be remembered.

## Inputs

Osman's decision, 2026-09-01: fit-out is billed as **monthly progress
applications**, not one invoice per VO. So the only figure a person types is:

| Input | Why this one |
|---|---|
| Period ending | The valuation date the application covers up to |
| Cumulative % complete | What a valuation actually states: "we are 75% done" |

Everything else — previously applied, gross this period, retention, VAT, the
total — is computed. Asking a person to type the total means the day they
mistype it, the system agrees with them.

## User Roles

Finance Manager, Finance Officer, Commercial Manager, Contract Administrator.

## Permissions Required

`invoice.manage`. Deliberately separate from `variationOrder.manage`: the
person who agrees a figure with a client should not be the only control on
what is invoiced against it.

## Custom App Services Used

`src/services/invoice.service.ts` — `draftApplication`, `issueInvoice`,
`cancelInvoice`, `getCommercialPosition`, `listInvoices`.
Arithmetic in `src/lib/money.ts`.

## n8n Workflow Used

None — internal only.

## AI Use

None, and never. No model touches a figure on an invoice.

## Human Approval Gates

None beyond the `final_variation` gate upstream and the client's own agreement.
An application claims a percentage of a value two directors and the client have
both already agreed; a third gate would only delay money.

## Step-by-Step Logic

1. Refuse unless the VO is `approved` or `part_approved`. There is nothing
   agreed to invoice against otherwise.
2. Sum the gross of every application on the VO, **excluding cancelled ones** —
   a cancelled application was never certified, and leaving it in would suppress
   every later application by that amount, silently.
3. Refuse a percentage lower than one already certified. Completion does not go
   backwards on an application; that is a credit note, a different document.
4. Compute, in the order it appears on the paper:
   `cumulative % of the agreed value` − `previously applied` = **gross**;
   less **retention** (per project, 5% or 10% are both ordinary) = **net**;
   plus **VAT** on the rounded net = **total due**.
5. Freeze all of it onto the row, including `basisValue` and
   `previouslyApplied`, so the arithmetic is reproducible even if the VO is
   later revised or an earlier application cancelled.
6. On issue: set `dueAt` = issue date + the payment terms **as they stand
   today**, frozen. This invoice fell due when it fell due; a term changed next
   year must not make an old invoice retrospectively late.

## Database Changes

`invoices` row. `projects.invoice_sequence` incremented.

## Notifications

None from here. `invoice_overdue` reaches people through the bottleneck sweep.

## Error Handling

All refusals are validation errors carrying a sentence a person can act on.
`lib/money.ts` throws rather than clamping: a silently clamped figure is a
wrong invoice nobody notices.

## Retry Logic

None. Each draft is a deliberate act with its own number.

## Audit Events

`invoice / created` carrying the full computed breakdown, `/ issued` carrying
the total, the due date and the terms used, `/ updated` on cancellation with
the reason.

## Edge Cases

- **Cancelling an invoice with payments against it** — refused. Raise a credit;
  cancelling would leave cash with nothing to attach it to.
- **The final application** — 100% clears the balance to the fils, tested.
- **Zero-rated VAT, zero retention** — supported, both settings.
- **An invoice dated in the future** — refused.

## Definition of Done

A person enters one percentage and gets a correct application; the sum of every
application on a VO equals the agreed value to the fils; and
`getCommercialPosition` can state approved-but-unbilled, outstanding and
overdue from rows that cannot go stale.
