# Approved But Unbilled

> **Status:** specified and built, 2026-09-01.

## Workflow Name

Approved But Unbilled

## Business Objective

Produce the number that justifies this product: **work the client has agreed to
pay for, that nobody has asked them for**.

It is the most expensive gap in a fit-out contractor's commercial process
because everything about it feels finished. The change was captured, the notice
was served, the price was argued and won, the client said yes — and then the
commercial team moved on and nobody in finance knew it was theirs. Nothing is
overdue, nothing is disputed, nothing looks wrong. The money simply never gets
asked for.

## Trigger

Two, deliberately:

1. **On read.** Computed live wherever it is shown — dashboard cards, the
   project view, the change page.
2. **On a schedule.** `bottleneck_sweep`, from n8n lane S, raises
   `approved_not_invoiced` once an agreed VO has been unbilled for 14 days.

The first makes it visible. The second makes it somebody's.

## Inputs

None from a person. Every figure is derived from `variation_orders`,
`invoices` and `payments`.

## User Roles

Everyone sees it, scoped to their projects. Directors see the company figure by
system role.

## Permissions Required

None beyond project access. This is a read.

## Custom App Services Used

`src/services/invoice.service.ts` → `getCommercialPosition`.
`src/services/bottleneck.service.ts` → `runDetectionSweep`.

## n8n Workflow Used

`master.json`, lane S, job `bottleneck_sweep`. n8n holds the clock; the app
decides what is a bottleneck.

## AI Use

None.

## Human Approval Gates

None. It reports; it changes nothing.

## Step-by-Step Logic

For every VO the client has agreed (`approved` or `part_approved`):

```
approved value
  less gross applied for, cancelled applications excluded
  = unbilled
```

Summed across the caller's projects. Four figures are produced alongside it,
because the first question after "how much" is always "compared to what":

| Figure | Meaning |
|---|---|
| Approved, not invoiced | Agreed and never asked for. The headline |
| Invoiced, unpaid | Asked for and not received |
| Overdue payment | Asked for, past terms, not received |
| Conceded on variations | Submitted less agreed, across part-approved VOs |

The last one is the only figure here about the company's own performance rather
than the client's. It exists because a contractor who cannot say what it
conceded cannot learn to concede less.

**Nothing is cached.** A stored total needs a job to maintain it, and the day
that job fails the number is both wrong and confident — and a director will act
on it.

## Database Changes

None. Reads only. The sweep writes `bottlenecks` rows, which are idempotent by
type and change.

## Notifications

Through the bottleneck, not from here. A daily "you have unbilled work" message
that never changes gets muted in a week.

## Error Handling

A missing contract rule falls back to documented defaults (5% retention, 30 day
terms, 14 day VO response). A project with no agreed VOs contributes zero, not
an error.

## Retry Logic

The sweep is idempotent: an open bottleneck of the same type on the same change
is refreshed, never duplicated. Running it twice inflates nothing.

## Audit Events

None for the read. The sweep's writes are visible as bottleneck rows with their
own timestamps.

## Edge Cases

- **A fils of rounding** is not an unbilled variation. The threshold is 0.01.
- **A cancelled application** does not count as applied for.
- **A draft application** counts against unbilled (the work has been claimed
  internally) but not toward invoiced (the client has not been asked yet).
- **Retention** is not unbilled. It was deliberately withheld, and it is
  released by a separate application at practical completion.

## Definition of Done

A director opens the dashboard and sees, in one number, how much agreed work
has never been invoiced — and can click through to the variations it is sitting
in.
